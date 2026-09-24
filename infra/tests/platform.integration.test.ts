import { existsSync, readdirSync, readFileSync } from "node:fs";
import { URL } from "node:url";

import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import {
  SourceFile,
  ExportRecord,
  ExportManifest,
  Account,
  ImportPage,
  type ImportId,
  PostingPage,
  UploadResult,
} from "@repo/contracts/finance";
import * as Alchemy from "alchemy";
import * as Output from "alchemy/Output";
import * as Test from "alchemy/Test/Vitest";
import { Crypto, type Duration, Effect, Schedule, Schema } from "effect";
import { FetchHttpClient, HttpBody, HttpClient } from "effect/unstable/http";
import { unzipSync } from "fflate";
import { expect, inject } from "vitest";

import { deploymentConfig } from "../src/deployment-config.ts";
import { providers } from "../src/providers.ts";
import { webApplication } from "../src/web-application.ts";
import { workerGraph } from "../src/workers.ts";
import { localPlatformProviders } from "./support/ai-gateway.ts";
import Driver from "./support/api-driver.ts";
import { waitForWorker } from "./support/worker-readiness.ts";

const randomUUID = Crypto.Crypto.use((crypto) => crypto.randomUUIDv4).pipe(
  Effect.provide(NodeCrypto.layer),
);
const live = inject("live");
const platformProviders = live ? providers : localPlatformProviders;
const Stack = Alchemy.Stack(
  "RecordsPlatformTest",
  { providers: platformProviders, state: Alchemy.localState() },
  Effect.gen(function* () {
    const workers = yield* workerGraph;
    const driver = yield* Driver;
    const web = live ? yield* webApplication(yield* deploymentConfig(), workers) : undefined;
    return {
      url: driver.url.as<string>(),
      apiUrl: Output.map(driver.url, (url) => `${url}/http`),
      webUrl: web?.url,
    };
  }),
);
const { test, beforeAll, afterAll, deploy, destroy } = Test.make({
  providers: platformProviders,
  stage: `test-${crypto.randomUUID().slice(0, 8)}`,
  dev: !live,
});
const stack = beforeAll(deploy(Stack), { timeout: 600_000 });
afterAll(destroy(Stack), { timeout: 600_000 });

const waitForImport = (
  url: string,
  importId: typeof ImportId.Type,
  timeout: Duration.Input = "30 seconds",
) =>
  HttpClient.get(`${url}/imports`).pipe(
    Effect.flatMap((response) => response.json),
    Effect.flatMap(Schema.decodeUnknownEffect(ImportPage)),
    Effect.map((page) => page.rows.find((item) => item.id === importId)),
    Effect.repeat({
      schedule: Schedule.spaced("100 millis"),
      while: (item) => item?.status === "processing",
    }),
    Effect.timeout(timeout),
  );

const importSyntheticCsv = Effect.fn("importSyntheticCsv")(function* (
  url: string,
  apiUrl: string,
  name: string,
) {
  yield* waitForWorker(url);
  const account = yield* HttpClient.post(`${url}/accounts`, {
    body: HttpBody.jsonUnsafe({
      commandId: yield* randomUUID,
      label: name,
      kind: "deposit",
      currency: "AUD",
    }),
  }).pipe(
    Effect.flatMap((response) => response.json),
    Effect.flatMap(Schema.decodeUnknownEffect(Account)),
  );
  const csv = `02/09/2026,-4.50,${name} coffee,100.00\n02/09/2026,-4.50,${name} coffee,104.50\n01/09/2026,+109.00,${name} deposit,109.00\n`;
  const body = new FormData();
  body.set("accountId", account.id);
  body.set("file", new Blob([csv], { type: "text/csv" }), `${name}.csv`);
  const upload = yield* HttpClient.post(`${apiUrl}/uploads`, {
    body: HttpBody.formData(body),
  }).pipe(
    Effect.flatMap((response) => response.json),
    Effect.flatMap(Schema.decodeUnknownEffect(UploadResult)),
  );
  const completed = yield* waitForImport(url, upload.importId);
  expect(completed?.status).toBe("complete");
  return { account, upload, csv };
});

test.skipIf(!live)(
  "Access rejects unauthenticated application, source, and export requests",
  Effect.gen(function* () {
    const { webUrl } = yield* stack;
    if (!webUrl) return yield* Effect.die("Missing hosted application URL");
    for (const path of ["/", `/sources/${yield* randomUUID}`, `/exports/${yield* randomUUID}`]) {
      const response = yield* HttpClient.get(`${webUrl}${path}`);
      yield* response.text;
      expect(response.status).toBe(302);
      expect(new URL(response.headers.location ?? "").hostname).toBe("arishi.cloudflareaccess.com");
    }
  }).pipe(Effect.provideService(FetchHttpClient.RequestInit, { redirect: "manual" })),
);

test(
  "the private API reads the migrated accounts table through Hyperdrive",
  Effect.gen(function* () {
    const { url } = yield* stack;
    yield* waitForWorker(url);
    const response = yield* HttpClient.get(url);
    expect(response.status).toBe(200);
    expect(yield* response.json).toEqual([]);
  }),
);

test(
  "a CSV upload publishes exact amounts once and retains its original bytes",
  Effect.gen(function* () {
    const { url, apiUrl } = yield* stack;
    yield* waitForWorker(url);
    const command = {
      commandId: yield* randomUUID,
      label: "Daily account",
      kind: "deposit",
      currency: "AUD",
    };
    const account = yield* HttpClient.post(`${url}/accounts`, {
      body: HttpBody.jsonUnsafe(command),
    }).pipe(
      Effect.flatMap((response) => response.json),
      Effect.flatMap(Schema.decodeUnknownEffect(Account)),
    );
    const repeated = yield* HttpClient.post(`${url}/accounts`, {
      body: HttpBody.jsonUnsafe(command),
    }).pipe(Effect.flatMap((response) => response.json));
    expect(repeated).toEqual(account);
    const csv =
      "02/09/2026,-4.50,Coffee,100.00\n02/09/2026,-4.50,Coffee,104.50\n01/09/2026,+109.00,Deposit,109.00\n";
    const body = new FormData();
    body.set("accountId", account.id);
    body.set("file", new Blob([csv], { type: "text/csv" }), "transactions.csv");
    const upload = yield* HttpClient.post(`${apiUrl}/uploads`, {
      body: HttpBody.formData(body),
    }).pipe(
      Effect.flatMap((response) => response.json),
      Effect.flatMap(Schema.decodeUnknownEffect(UploadResult)),
    );
    const completed = yield* waitForImport(url, upload.importId);
    expect(completed?.status).toBe("complete");
    expect(completed?.summary).toEqual({
      observations: 3,
      newPostings: 3,
      matchedPostings: 0,
      reviewItems: 0,
    });
    const duplicate = yield* HttpClient.post(`${apiUrl}/uploads`, {
      body: HttpBody.formData(body),
    }).pipe(
      Effect.flatMap((response) => response.json),
      Effect.flatMap(Schema.decodeUnknownEffect(UploadResult)),
    );
    expect(duplicate).toEqual({ ...upload, existing: true });
    const postings = yield* HttpClient.post(`${url}/transactions`, {
      body: HttpBody.jsonUnsafe({ filter: { accountId: account.id } }),
    }).pipe(
      Effect.flatMap((response) => response.json),
      Effect.flatMap(Schema.decodeUnknownEffect(PostingPage)),
    );
    expect(
      postings.rows.map((row) => row.amount.minor).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    ).toEqual([-450n, -450n, 10900n]);
    const source = yield* HttpClient.get(`${apiUrl}/sources/${upload.sourceFileId}`).pipe(
      Effect.flatMap((response) => response.text),
    );
    expect(source).toBe(csv);
  }),
  { timeout: 60_000 },
);

const corpusDirectory = new URL("../../fixtures/commbank/", import.meta.url);
test.skipIf(live || !existsSync(corpusDirectory))(
  "every private CSV imports independently with the source row count",
  Effect.gen(function* () {
    const { url, apiUrl } = yield* stack;
    const files = readdirSync(corpusDirectory).filter((name) => name.endsWith(".csv"));
    let observations = 0;
    for (const [index, file] of files.entries()) {
      const account = yield* HttpClient.post(`${url}/accounts`, {
        body: HttpBody.jsonUnsafe({
          commandId: yield* randomUUID,
          label: `CSV verification ${index + 1}`,
          kind: "deposit",
          currency: "AUD",
        }),
      }).pipe(
        Effect.flatMap((response) => response.json),
        Effect.flatMap(Schema.decodeUnknownEffect(Account)),
      );
      const bytes = new Uint8Array(readFileSync(new URL(file, corpusDirectory)));
      const expectedRows = new TextDecoder().decode(bytes).trimEnd().split("\n").length;
      const body = new FormData();
      body.set("accountId", account.id);
      body.set("file", new Blob([bytes], { type: "text/csv" }), `corpus-${index + 1}.csv`);
      const upload = yield* HttpClient.post(`${apiUrl}/uploads`, {
        body: HttpBody.formData(body),
      }).pipe(
        Effect.flatMap((response) => response.json),
        Effect.flatMap(Schema.decodeUnknownEffect(UploadResult)),
      );
      const completed = yield* waitForImport(url, upload.importId);
      expect(completed?.status).toBe("complete");
      expect(completed?.summary?.observations).toBe(expectedRows);
      expect(completed?.summary?.newPostings).toBe(expectedRows);
      observations += completed?.summary?.observations ?? 0;
    }
    expect(files).toHaveLength(26);
    expect(observations).toBe(3031);
  }),
  { timeout: 180_000 },
);

test.skipIf(live || !existsSync(corpusDirectory))(
  "overlapping private OFX exports identify four accounts without duplicate postings",
  Effect.gen(function* () {
    const { url, apiUrl } = yield* stack;
    const files = readdirSync(corpusDirectory).filter((name) => name.endsWith(".ofx"));
    let observations = 0;
    for (const [index, file] of files.entries()) {
      const bytes = new Uint8Array(readFileSync(new URL(file, corpusDirectory)));
      const expectedRows =
        new TextDecoder("windows-1252").decode(bytes).split("<STMTTRN>").length - 1;
      const body = new FormData();
      body.set("file", new Blob([bytes], { type: "application/x-ofx" }), `corpus-${index + 1}.ofx`);
      const upload = yield* HttpClient.post(`${apiUrl}/uploads`, {
        body: HttpBody.formData(body),
      }).pipe(
        Effect.flatMap((response) => response.json),
        Effect.flatMap(Schema.decodeUnknownEffect(UploadResult)),
      );
      const completed = yield* waitForImport(url, upload.importId);
      expect(completed?.status).toBe("complete");
      expect(completed?.summary?.observations).toBe(expectedRows);
      expect(
        (completed?.summary?.newPostings ?? 0) + (completed?.summary?.matchedPostings ?? 0),
      ).toBe(expectedRows);
      observations += completed?.summary?.observations ?? 0;
    }
    const accounts = yield* HttpClient.get(url).pipe(
      Effect.flatMap((response) => response.json),
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Account))),
    );
    expect(accounts.filter((account) => account.accountNumber !== null).length).toBe(4);
    expect(files).toHaveLength(26);
    expect(observations).toBe(3031);
  }),
  { timeout: 180_000 },
);

test(
  "PDF uploads publish through the native Workflow and open as original statement pages",
  Effect.gen(function* () {
    const { url, apiUrl } = yield* stack;
    for (const [name, mediaType] of Object.entries({
      deposit: "application/pdf",
      card: "application/octet-stream",
      loan: "",
    })) {
      const bytes = new Uint8Array(
        readFileSync(
          new URL(`../../workers/processor/tests/fixtures/${name}.pdf`, import.meta.url),
        ),
      );
      const body = new FormData();
      body.set("file", new Blob([bytes], { type: mediaType }), `${name}.pdf`);
      const upload = yield* HttpClient.post(`${apiUrl}/uploads`, {
        body: HttpBody.formData(body),
      }).pipe(
        Effect.flatMap((response) => response.json),
        Effect.flatMap(Schema.decodeUnknownEffect(UploadResult)),
      );
      const completed = yield* waitForImport(url, upload.importId);
      expect(completed?.status).toBe("complete");
      expect(completed?.summary?.newPostings).toBe(2);
      expect(completed?.summary?.pages?.needingReview).toEqual([]);
      const original = yield* HttpClient.get(`${apiUrl}/sources/${upload.sourceFileId}`);
      expect(original.headers["content-type"]).toBe("application/pdf");
      expect(original.headers["content-disposition"]?.startsWith("inline;")).toBe(true);
      const downloaded = yield* original.arrayBuffer;
      expect(new Uint8Array(downloaded)).toEqual(bytes);
    }
  }),
  { timeout: 120_000 },
);

test.skipIf(live || !existsSync(corpusDirectory))(
  "a PDF larger than the Workflow checkpoint limit publishes all 867 transactions",
  Effect.gen(function* () {
    const { url, apiUrl } = yield* stack;
    const name = readdirSync(corpusDirectory)
      .filter((name) => name.endsWith(".pdf"))
      .sort()[11];
    if (!name) return yield* Effect.die("Expected the large corpus statement.");
    const bytes = new Uint8Array(readFileSync(new URL(name, corpusDirectory)));
    const body = new FormData();
    body.set("file", new Blob([bytes], { type: "application/pdf" }), "large-statement.pdf");
    const upload = yield* HttpClient.post(`${apiUrl}/uploads`, {
      body: HttpBody.formData(body),
    }).pipe(
      Effect.flatMap((response) => response.json),
      Effect.flatMap(Schema.decodeUnknownEffect(UploadResult)),
    );
    const completed = yield* waitForImport(url, upload.importId, "60 seconds");
    expect(completed?.status).toBe("complete");
    expect(completed?.summary?.observations).toBe(867);
    expect(
      (completed?.summary?.newPostings ?? 0) + (completed?.summary?.matchedPostings ?? 0),
    ).toBe(867);
    expect(completed?.summary?.pages?.needingReview).toEqual([]);
  }),
  { timeout: 120_000 },
);

test(
  "a repeated export request produces one complete ZIP with a counted manifest and original files",
  Effect.gen(function* () {
    const { url, apiUrl } = yield* stack;
    yield* waitForWorker(url);
    const fixture = yield* importSyntheticCsv(url, apiUrl, "export");
    const input = {
      commandId: yield* randomUUID,
      includeSources: true,
    };
    const requested = yield* HttpClient.post(`${url}/exports`, {
      body: HttpBody.jsonUnsafe(input),
    }).pipe(
      Effect.flatMap((response) => response.json),
      Effect.flatMap(Schema.decodeUnknownEffect(ExportRecord)),
    );
    const repeated = yield* HttpClient.post(`${url}/exports`, {
      body: HttpBody.jsonUnsafe(input),
    }).pipe(
      Effect.flatMap((response) => response.json),
      Effect.flatMap(Schema.decodeUnknownEffect(ExportRecord)),
    );
    expect(repeated.id).toBe(requested.id);
    const completed = yield* HttpClient.get(`${url}/exports/${requested.id}`).pipe(
      Effect.flatMap((response) => response.json),
      Effect.flatMap(Schema.decodeUnknownEffect(ExportRecord)),
      Effect.repeat({
        schedule: Schedule.spaced("300 millis"),
        while: (record) => record.status === "processing",
      }),
      Effect.timeout("60 seconds"),
    );
    expect(completed.status).toBe("ready");
    const response = yield* HttpClient.get(`${apiUrl}/exports/${requested.id}`);
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe("application/zip");
    const archive = unzipSync(new Uint8Array(yield* response.arrayBuffer));
    const manifest = yield* Schema.decodeEffect(Schema.fromJsonString(ExportManifest))(
      new TextDecoder().decode(archive["manifest.json"]),
    );
    expect(manifest).toEqual(completed.manifest);
    expect(manifest.tables.map((table) => table.name)).toEqual([
      "__alchemy_migrations",
      "account_periods",
      "accounts",
      "allocation_personal_events",
      "allocation_tags",
      "allocations",
      "categories",
      "category_proposals",
      "command_receipts",
      "corrections",
      "counterparties",
      "counterparty_aliases",
      "credit_links",
      "enrichment_items",
      "enrichment_runs",
      "enrichment_settings",
      "event_postings",
      "events",
      "exports",
      "fee_associations",
      "imports",
      "model_usage",
      "movement_links",
      "observations",
      "offset_relationships",
      "personal_events",
      "posting_descriptors",
      "postings",
      "review_items",
      "rule_applications",
      "rule_exceptions",
      "rules",
      "saved_analyses",
      "settings",
      "source_coverage",
      "source_files",
      "tags",
    ]);
    for (const table of manifest.tables) {
      const rows = yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Array(Schema.Unknown)))(
        new TextDecoder().decode(archive[table.path]),
      );
      expect(rows.length).toBe(table.count);
    }
    for (const source of manifest.sources) {
      expect(source.path !== null).toBe(source.bytesAvailable);
      if (source.path) expect(archive[source.path]?.length).toBeGreaterThan(0);
    }
    expect(Object.keys(archive).length).toBe(
      1 + manifest.tables.length + manifest.sources.filter((source) => source.path).length,
    );
    const source = manifest.sources.find((item) => item.id === fixture.upload.sourceFileId);
    expect(source?.path && new TextDecoder().decode(archive[source.path])).toBe(fixture.csv);
    const postings = yield* Schema.decodeEffect(
      Schema.fromJsonString(
        Schema.Array(
          Schema.Struct({
            id: Schema.String,
            account_id: Schema.String,
            posted_on: Schema.String,
            amount_minor: Schema.String,
          }),
        ),
      ),
    )(new TextDecoder().decode(archive["tables/postings.json"]));
    const recorded = postings.filter((posting) => posting.account_id === fixture.account.id);
    expect(
      recorded
        .map((posting) => ({ on: posting.posted_on, minor: posting.amount_minor }))
        .sort((left, right) => left.on.localeCompare(right.on)),
    ).toEqual([
      { on: "2026-09-01", minor: "10900" },
      { on: "2026-09-02", minor: "-450" },
      { on: "2026-09-02", minor: "-450" },
    ]);
    const observations = yield* Schema.decodeEffect(
      Schema.fromJsonString(
        Schema.Array(
          Schema.Struct({
            import_id: Schema.String,
            source_file_id: Schema.String,
            posting_id: Schema.NullOr(Schema.String),
          }),
        ),
      ),
    )(new TextDecoder().decode(archive["tables/observations.json"]));
    const evidence = observations.filter((row) => row.import_id === fixture.upload.importId);
    expect(evidence).toHaveLength(3);
    expect(evidence.map((row) => row.posting_id)).toEqual(
      expect.arrayContaining(recorded.map((row) => row.id)),
    );
    expect(evidence.every((row) => row.source_file_id === fixture.upload.sourceFileId)).toBe(true);
  }),
  { timeout: 120_000 },
);

test(
  "removing and reuploading original bytes preserves postings and old commands cannot remove the replacement",
  Effect.gen(function* () {
    const { url, apiUrl } = yield* stack;
    const { account, upload, csv } = yield* importSyntheticCsv(url, apiUrl, "removal");
    const files = yield* HttpClient.get(`${url}/source-files`).pipe(
      Effect.flatMap((response) => response.json),
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(SourceFile))),
    );
    const file = files.find((source) => source.id === upload.sourceFileId);
    if (!file) return yield* Effect.die("Missing synthetic CSV");
    const input = {
      commandId: yield* randomUUID,
      sourceFileId: file.id,
      expectedVersion: file.version,
    };
    const before = yield* HttpClient.post(`${url}/transactions`, {
      body: HttpBody.jsonUnsafe({ filter: { importId: file.importId } }),
    }).pipe(
      Effect.flatMap((response) => response.json),
      Effect.flatMap(Schema.decodeUnknownEffect(PostingPage)),
    );
    const removed = yield* HttpClient.post(`${url}/remove-source`, {
      body: HttpBody.jsonUnsafe(input),
    }).pipe(Effect.flatMap((response) => response.json));
    expect(removed).toEqual({ sourceFileId: file.id, affectedPostingCount: 3 });
    expect((yield* HttpClient.get(`${apiUrl}/sources/${file.id}`)).status).toBe(404);
    const body = new FormData();
    body.set("accountId", account.id);
    body.set("file", new Blob([csv], { type: "text/csv" }), "restored.csv");
    const restored = yield* HttpClient.post(`${apiUrl}/uploads`, {
      body: HttpBody.formData(body),
    }).pipe(
      Effect.flatMap((response) => response.json),
      Effect.flatMap(Schema.decodeUnknownEffect(UploadResult)),
    );
    expect(restored).toEqual({ sourceFileId: file.id, importId: file.importId, existing: true });
    expect(
      yield* HttpClient.get(`${apiUrl}/sources/${file.id}`).pipe(
        Effect.flatMap((response) => response.text),
      ),
    ).toBe(csv);
    expect(
      yield* HttpClient.post(`${url}/remove-source`, { body: HttpBody.jsonUnsafe(input) }).pipe(
        Effect.flatMap((response) => response.json),
      ),
    ).toEqual(removed);
    const stale = yield* HttpClient.post(`${url}/remove-source`, {
      body: HttpBody.jsonUnsafe({
        ...input,
        commandId: yield* randomUUID,
      }),
    });
    expect(stale.status).toBe(409);
    expect(yield* stale.json).toMatchObject({ kind: "stale" });
    expect(
      yield* HttpClient.get(`${apiUrl}/sources/${file.id}`).pipe(
        Effect.flatMap((response) => response.text),
      ),
    ).toBe(csv);
    const after = yield* HttpClient.post(`${url}/transactions`, {
      body: HttpBody.jsonUnsafe({ filter: { importId: file.importId } }),
    }).pipe(
      Effect.flatMap((response) => response.json),
      Effect.flatMap(Schema.decodeUnknownEffect(PostingPage)),
    );
    expect(after).toEqual(before);
  }),
);
