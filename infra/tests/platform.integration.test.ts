import { existsSync, readdirSync, readFileSync } from "node:fs";
import { URL } from "node:url";

import { Account, Import, PostingPage, UploadResult } from "@repo/contracts/finance";
import * as Alchemy from "alchemy";
import * as Test from "alchemy/Test/Vitest";
import { Effect, Schedule, Schema } from "effect";
import { HttpBody, HttpClient } from "effect/unstable/http";
import { expect } from "vitest";

import { providers } from "../src/providers.ts";
import { workerGraph } from "../src/workers.ts";
import Driver from "./fixtures/api-driver.ts";
import { waitForWorker } from "./support/worker-readiness.ts";

const platformProviders = providers();
const Stack = Alchemy.Stack(
  "RecordsPlatformTest",
  { providers: platformProviders, state: Alchemy.localState() },
  Effect.gen(function* () {
    const { api } = yield* workerGraph;
    const driver = yield* Driver;
    return { url: driver.url.as<string>(), apiUrl: api.url.as<string>() };
  }),
);
const { test, beforeAll, afterAll, deploy, destroy } = Test.make({
  providers: platformProviders,
  stage: `test-${crypto.randomUUID().slice(0, 8)}`,
  dev: true,
});
const stack = beforeAll(deploy(Stack), { timeout: 600_000 });
afterAll(destroy(Stack), { timeout: 600_000 });

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
      commandId: crypto.randomUUID(),
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
    const completed = yield* HttpClient.get(`${url}/imports`).pipe(
      Effect.flatMap((response) => response.json),
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Import))),
      Effect.map((imports) => imports.find((item) => item.id === upload.importId)),
      Effect.repeat({
        schedule: Schedule.spaced("300 millis"),
        while: (item) => item?.status === "processing",
      }),
      Effect.timeout("30 seconds"),
    );
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
test.skipIf(!existsSync(corpusDirectory))(
  "every private CSV imports independently with the source row count",
  Effect.gen(function* () {
    const { url, apiUrl } = yield* stack;
    const files = readdirSync(corpusDirectory).filter((name) => name.endsWith(".csv"));
    let observations = 0;
    for (const [index, file] of files.entries()) {
      const account = yield* HttpClient.post(`${url}/accounts`, {
        body: HttpBody.jsonUnsafe({
          commandId: crypto.randomUUID(),
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
      const completed = yield* HttpClient.get(`${url}/imports`).pipe(
        Effect.flatMap((response) => response.json),
        Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Import))),
        Effect.map((imports) => imports.find((item) => item.id === upload.importId)),
        Effect.repeat({
          schedule: Schedule.spaced("100 millis"),
          while: (item) => item?.status === "processing",
        }),
        Effect.timeout("30 seconds"),
      );
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

test.skipIf(!existsSync(corpusDirectory))(
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
      const completed = yield* HttpClient.get(`${url}/imports`).pipe(
        Effect.flatMap((response) => response.json),
        Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Import))),
        Effect.map((imports) => imports.find((item) => item.id === upload.importId)),
        Effect.repeat({
          schedule: Schedule.spaced("100 millis"),
          while: (item) => item?.status === "processing",
        }),
        Effect.timeout("30 seconds"),
      );
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
    for (const name of ["deposit", "card", "loan"]) {
      const bytes = new Uint8Array(
        readFileSync(
          new URL(`../../workers/processor/tests/fixtures/${name}.pdf`, import.meta.url),
        ),
      );
      const body = new FormData();
      body.set("file", new Blob([bytes], { type: "application/pdf" }), `${name}.pdf`);
      const upload = yield* HttpClient.post(`${apiUrl}/uploads`, {
        body: HttpBody.formData(body),
      }).pipe(
        Effect.flatMap((response) => response.json),
        Effect.flatMap(Schema.decodeUnknownEffect(UploadResult)),
      );
      const completed = yield* HttpClient.get(`${url}/imports`).pipe(
        Effect.flatMap((response) => response.json),
        Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Import))),
        Effect.map((imports) => imports.find((item) => item.id === upload.importId)),
        Effect.repeat({
          schedule: Schedule.spaced("100 millis"),
          while: (item) => item?.status === "processing",
        }),
        Effect.timeout("30 seconds"),
      );
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

test.skipIf(!existsSync(corpusDirectory))(
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
    const completed = yield* HttpClient.get(`${url}/imports`).pipe(
      Effect.flatMap((response) => response.json),
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Import))),
      Effect.map((imports) => imports.find((item) => item.id === upload.importId)),
      Effect.repeat({
        schedule: Schedule.spaced("100 millis"),
        while: (item) => item?.status === "processing",
      }),
      Effect.timeout("60 seconds"),
    );
    expect(completed?.status).toBe("complete");
    expect(completed?.summary?.observations).toBe(867);
    expect(
      (completed?.summary?.newPostings ?? 0) + (completed?.summary?.matchedPostings ?? 0),
    ).toBe(867);
    expect(completed?.summary?.pages?.needingReview).toEqual([]);
  }),
  { timeout: 120_000 },
);
