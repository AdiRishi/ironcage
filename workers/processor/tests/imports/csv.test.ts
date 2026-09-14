import { expect, it } from "@effect/vitest";
import { reconcile } from "@repo/finance";
import { Effect } from "effect";

import { parseCsv } from "../../src/imports/csv.ts";

it.effect("keeps identical bank rows separate and preserves literal source fields", () =>
  Effect.gen(function* () {
    const parsed = yield* parseCsv(
      new TextEncoder().encode(
        "02/09/2026,-5.00,Coffee Value Date: 01/09/2026,90.00\n02/09/2026,-5.00,Coffee Value Date: 01/09/2026,95.00\n01/09/2026,100.00,Deposit,100.00",
      ),
      "AUD",
    );
    expect(parsed.observations).toHaveLength(3);
    expect(parsed.observations[0]?.candidate).toMatchObject({
      postedOn: "2026-09-02",
      valueOn: "2026-09-01",
      description: "Coffee",
      amount: { currency: "AUD", minor: -500n },
    });
    expect(parsed.observations[0]?.raw.description).toBe("Coffee Value Date: 01/09/2026");
    expect(reconcile(parsed)).toMatchObject({
      reconciled: true,
      opening: { money: { minor: 0n } },
      closing: { money: { minor: 9000n } },
      issues: [],
    });
  }),
);
it.effect("rejects the entire structured file when a required row value is invalid", () =>
  Effect.gen(function* () {
    expect(
      (yield* Effect.flip(
        parseCsv(new TextEncoder().encode("31/02/2026,-5.00,Coffee,95.00"), "AUD"),
      )).kind,
    ).toBe("invalid");
  }),
);
it.effect("does not invent balances for a card export", () =>
  Effect.gen(function* () {
    const parsed = yield* parseCsv(new TextEncoder().encode("02/09/2026,-5.00,Coffee,"), "AUD");
    expect(reconcile(parsed)).toMatchObject({ reconciled: false, opening: null, closing: null });
  }),
);
