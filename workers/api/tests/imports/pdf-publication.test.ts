import { readFileSync } from "node:fs";
import { URL } from "node:url";

import { parsePdf } from "@repo/processor/imports";
import { Effect } from "effect";
import { expect } from "vitest";

import { Accounts } from "../../src/accounts/service.ts";
import { Publication } from "../../src/imports/publication.ts";
import { Postings } from "../../src/postings/service.ts";
import { Reviews } from "../../src/review/service.ts";
import { applicationTest } from "../support/application.ts";
import { reset, source } from "../support/fixtures.ts";

const { test, services } = applicationTest();
const fixture = (name: string) =>
  new Uint8Array(
    readFileSync(new URL(`../../../processor/tests/fixtures/${name}.pdf`, import.meta.url)),
  );
test(
  "a loan statement without a BSB and its structured bank identity resolve to one account in either order",
  Effect.gen(function* () {
    const pdf = yield* parsePdf(fixture("loan"));
    if (!pdf.account) return yield* Effect.die("Missing synthetic loan identity.");
    const structured = {
      ...pdf,
      parserVersion: "synthetic-ofx",
      account: { ...pdf.account, bankId: "123456" },
      observations: pdf.observations.map((row, index) => ({
        ...row,
        locatorKey: `ofxTransaction:1:${index + 1}`,
        locator: { kind: "ofxTransaction" as const, statement: 1, ordinal: index + 1 },
      })),
    };
    const publication = yield* Publication;
    const accounts = yield* Accounts;
    const postings = yield* Postings;
    for (const files of [
      [pdf, structured],
      [structured, pdf],
    ]) {
      yield* reset;
      for (const file of files) {
        const input = yield* source(null, file === pdf ? "pdf" : "ofx");
        const summary = yield* publication.publish({ ...file, importId: input.importId });
        expect(summary.reviewItems).toBe(0);
      }
      const owners = yield* accounts.list;
      expect(owners).toHaveLength(1);
      expect(owners[0]).toMatchObject({
        bankId: "123456",
        accountNumber: "222222222",
        kind: "loan",
      });
      expect((yield* postings.list({ filter: {} })).rows).toHaveLength(2);
    }
  }).pipe(Effect.provide(services)),
);

test(
  "an unreadable PDF page creates a page review while readable pages publish",
  Effect.gen(function* () {
    yield* reset;
    const file = yield* parsePdf(fixture("card-unreadable"));
    const input = yield* source(null, "pdf");
    const publication = yield* Publication;
    const summary = yield* publication.publish({ ...file, importId: input.importId });
    expect(summary.newPostings).toBe(2);
    expect(summary.reviewItems).toBe(1);
    const reviews = yield* Reviews;
    const questions = (yield* reviews.list()).rows;
    expect(questions[0]).toMatchObject({
      kind: "value",
      sourceFileId: input.sourceFileId,
      observations: [{ locator: { kind: "pdfRow", page: 3, row: 1 } }],
    });
  }).pipe(Effect.provide(services)),
);
