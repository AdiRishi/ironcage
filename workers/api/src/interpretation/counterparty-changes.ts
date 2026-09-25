import { PgClient } from "@effect/sql-pg";
import {
  AliasRecord,
  type CategoryId,
  type CommandId,
  type CounterpartyChange,
  CounterpartyChangeId,
  type CounterpartyChangeKind,
  CounterpartyId,
  CounterpartyImages,
  CounterpartyRecord,
  EventAssignment,
  EventId,
  type ExpectedEventVersion,
  FinanceError,
  ReferenceRecord,
  RuleId,
  Version,
} from "@repo/contracts/finance";
import { Array as Arr, Crypto, Effect, Predicate, Schema, Struct } from "effect";
import type { Statement } from "effect/unstable/sql";

import { readNotedEvents } from "../analysis/facts.ts";
import { counterpartyRecordColumns } from "../database/columns.ts";
import { reinterpret } from "./engine.ts";

// The single writer of counterparties, their aliases, and their reference defaults. A
// change is planned as row images, the records it writes as they are and as it leaves
// them, so history can show it and undo can write it back.

type Image<A> = { readonly before: A | null; readonly after: A | null };

const records = <A>(images: readonly Image<A>[]) =>
  images.flatMap((image) => [image.before, image.after].filter(Predicate.isNotNull));
const unique = <A>(values: readonly A[]) => [...new Set(values)];
const referenceKey = (record: { counterpartyId: string; referenceKey: string }) =>
  `${record.counterpartyId}:${record.referenceKey}`;

// Records compare without their version: undoing a later change bumps the version of a
// record it returns to the values an earlier change left.
const sameCounterparty = Schema.toEquivalence(
  Schema.NullOr(CounterpartyRecord.mapFields(Struct.omit(["version"]))),
);
const sameAlias = Schema.toEquivalence(
  Schema.NullOr(AliasRecord.mapFields(Struct.omit(["version"]))),
);
const sameReference = Schema.toEquivalence(
  Schema.NullOr(ReferenceRecord.mapFields(Struct.omit(["version"]))),
);
const sameAssignment = Schema.toEquivalence(EventAssignment);

export const readCounterpartyRecords = Effect.fn("readCounterpartyRecords")(function* (
  where: Statement.Fragment,
) {
  const sql = yield* PgClient.PgClient;
  return yield* sql`SELECT ${counterpartyRecordColumns(sql)} FROM counterparties c WHERE ${where}`.pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(CounterpartyRecord))),
  );
});

const readCounterpartyRecord = Effect.fn("readCounterpartyRecord")(function* (
  id: typeof CounterpartyId.Type,
) {
  const sql = yield* PgClient.PgClient;
  const [record] = yield* readCounterpartyRecords(sql`id = ${id}`);
  if (!record)
    return yield* new FinanceError({ kind: "notFound", message: "Counterparty not found." });
  return record;
});

const readAliases = Effect.fn("readAliases")(function* (where: Statement.Fragment) {
  const sql = yield* PgClient.PgClient;
  return yield* sql`SELECT alias_key AS "aliasKey", counterparty_id AS "counterpartyId", source, status,
      confidence::float8 AS confidence, reason, version
    FROM counterparty_aliases WHERE ${where}`.pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(AliasRecord))),
  );
});

const readReferences = Effect.fn("readReferences")(function* (where: Statement.Fragment) {
  const sql = yield* PgClient.PgClient;
  return yield* sql`SELECT counterparty_id AS "counterpartyId", reference_key AS "referenceKey",
      default_role AS "defaultRole", default_category_id AS "defaultCategoryId", version
    FROM counterparty_references WHERE ${where}`.pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(ReferenceRecord))),
  );
});

// Every record the changes' images describe, as it is now.
export const readCurrent = Effect.fn("readCurrent")(function* (
  changes: readonly CounterpartyImages[],
) {
  const sql = yield* PgClient.PgClient;
  const counterparties = yield* readCounterpartyRecords(
    sql.in(
      "id",
      unique(changes.flatMap((images) => records(images.counterparties).map((row) => row.id))),
    ),
  );
  const aliases = yield* readAliases(
    sql.in(
      "alias_key",
      unique(changes.flatMap((images) => records(images.aliases).map((row) => row.aliasKey))),
    ),
  );
  const references = yield* readReferences(
    sql`(counterparty_id, reference_key) IN (SELECT k."counterpartyId", k."referenceKey" FROM jsonb_to_recordset(${sql.json(
      changes.flatMap((images) =>
        records(images.references).map(Struct.pick(["counterpartyId", "referenceKey"])),
      ),
    )}) AS k("counterpartyId" uuid, "referenceKey" text))`,
  );
  const events =
    yield* sql`SELECT id AS "eventId", counterparty_id AS "counterpartyId", counterparty_source AS "counterpartySource"
      FROM events WHERE ${sql.in(
        "id",
        unique(changes.flatMap((images) => images.events.map((row) => row.eventId))),
      )}`.pipe(
      Effect.flatMap(
        Schema.decodeUnknownEffect(
          Schema.Array(Schema.Struct({ eventId: EventId, ...EventAssignment.fields })),
        ),
      ),
    );
  const rules =
    yield* sql`SELECT id AS "ruleId", conditions->>'counterpartyId' AS "counterpartyId" FROM rules WHERE ${sql.in(
      "id",
      unique(changes.flatMap((images) => images.rules.map((row) => row.ruleId))),
    )}`.pipe(
      Effect.flatMap(
        Schema.decodeUnknownEffect(
          Schema.Array(
            Schema.Struct({ ruleId: RuleId, counterpartyId: Schema.NullOr(CounterpartyId) }),
          ),
        ),
      ),
    );
  const movements =
    yield* sql`SELECT event_id AS "eventId", original_event->>'counterpartyId' AS "counterpartyId" FROM movement_links WHERE ${sql.in(
      "event_id",
      unique(changes.flatMap((images) => images.movements.map((row) => row.eventId))),
    )}`.pipe(
      Effect.flatMap(
        Schema.decodeUnknownEffect(
          Schema.Array(
            Schema.Struct({ eventId: EventId, counterpartyId: Schema.NullOr(CounterpartyId) }),
          ),
        ),
      ),
    );
  return {
    counterparties: new Map(counterparties.map((row) => [row.id, row])),
    aliases: new Map(aliases.map((row) => [row.aliasKey, row])),
    references: new Map(references.map((row) => [referenceKey(row), row])),
    events: new Map(events.map(({ eventId, ...assignment }) => [eventId, assignment])),
    rules: new Map(rules.map((row) => [row.ruleId, row.counterpartyId])),
    movements: new Map(movements.map((row) => [row.eventId, row.counterpartyId])),
  };
});
export type CurrentRecords = Effect.Success<ReturnType<typeof readCurrent>>;

// A record as it is now, keyed by the record an image describes.
const now = <A>(image: Image<A>, key: (row: A) => string, rows: ReadonlyMap<string, A>) => {
  const row = image.after ?? image.before;
  return (row && rows.get(key(row))) ?? null;
};

// Whether every record a change wrote is still as the change left it.
export function isCurrent(images: CounterpartyImages, current: CurrentRecords) {
  return (
    images.counterparties.every((image) =>
      sameCounterparty(
        image.after,
        now(image, (row) => row.id, current.counterparties),
      ),
    ) &&
    images.aliases.every((image) =>
      sameAlias(
        image.after,
        now(image, (row) => row.aliasKey, current.aliases),
      ),
    ) &&
    images.references.every((image) =>
      sameReference(image.after, now(image, referenceKey, current.references)),
    ) &&
    images.events.every(({ eventId, after }) => {
      const assignment = current.events.get(eventId);
      return assignment !== undefined && sameAssignment(after, assignment);
    }) &&
    images.rules.every(({ ruleId, after }) => current.rules.get(ruleId) === after) &&
    images.movements.every(({ eventId, after }) => current.movements.get(eventId) === after)
  );
}

// The change that writes back what `images` replaced. Each restored record takes a
// version above the one it replaces, or above its old one when nothing replaces it.
export function invert(images: CounterpartyImages, current: CurrentRecords): CounterpartyImages {
  const restore = <A extends { readonly version: number }>(
    image: Image<A>,
    key: (row: A) => string,
    rows: ReadonlyMap<string, A>,
  ) => {
    const stored = now(image, key, rows);
    return {
      before: stored,
      after: image.before && {
        ...image.before,
        version: (stored?.version ?? image.before.version) + 1,
      },
    };
  };
  return {
    counterparties: images.counterparties.map((image) =>
      restore(image, (row) => row.id, current.counterparties),
    ),
    aliases: images.aliases.map((image) => restore(image, (row) => row.aliasKey, current.aliases)),
    references: images.references.map((image) => restore(image, referenceKey, current.references)),
    events: images.events.map(({ eventId, before, after }) => ({
      eventId,
      before: after,
      after: before,
    })),
    rules: images.rules.map(({ ruleId, before, after }) => ({
      ruleId,
      before: after,
      after: before,
    })),
    movements: images.movements.map(({ eventId, before, after }) => ({
      eventId,
      before: after,
      after: before,
    })),
  };
}

export function isEmpty(images: CounterpartyImages) {
  return Object.values(images).every((rows) => rows.length === 0);
}

// Keeps only the records a change alters.
function altered(images: CounterpartyImages): CounterpartyImages {
  return {
    counterparties: images.counterparties.filter(
      ({ before, after }) => !sameCounterparty(before, after),
    ),
    aliases: images.aliases.filter(({ before, after }) => !sameAlias(before, after)),
    references: images.references.filter(({ before, after }) => !sameReference(before, after)),
    events: images.events.filter(({ before, after }) => !sameAssignment(before, after)),
    rules: images.rules.filter(({ before, after }) => before !== after),
    movements: images.movements.filter(({ before, after }) => before !== after),
  };
}

export const noImages = {
  counterparties: [],
  aliases: [],
  references: [],
  events: [],
  rules: [],
  movements: [],
} satisfies CounterpartyImages;

const userAlias = (
  aliasKey: string,
  counterpartyId: typeof CounterpartyId.Type,
  before: typeof AliasRecord.Type | undefined,
) => ({
  aliasKey,
  counterpartyId,
  source: "user" as const,
  status: "applied" as const,
  confidence: null,
  reason: null,
  version: (before?.version ?? 0) + 1,
});

const checkAliasVersion = Effect.fn("checkAliasVersion")(function* (
  current: typeof AliasRecord.Type | undefined,
  expected: number | null,
) {
  if ((current?.version ?? null) !== expected)
    return yield* new FinanceError({
      kind: "stale",
      message: "This descriptor changed since you opened it. Review it and try again.",
    });
});

const checkReferenceVersion = Effect.fn("checkReferenceVersion")(function* (
  current: typeof ReferenceRecord.Type | undefined,
  expected: number | null,
) {
  if ((current?.version ?? null) !== expected)
    return yield* new FinanceError({
      kind: "stale",
      message: "These reference defaults changed. Review them and save again.",
    });
});

// A default category you choose must be active. A record can keep one archived since,
// which the engine ignores, so only a newly chosen category is checked, and merges and
// undos write back whatever the records held.
const checkChosenCategory = Effect.fn("checkChosenCategory")(function* (
  chosen: typeof CategoryId.Type | null,
  current: typeof CategoryId.Type | null,
) {
  if (chosen === null || chosen === current) return;
  const sql = yield* PgClient.PgClient;
  const active = yield* sql`SELECT id FROM categories WHERE id = ${chosen} AND NOT archived`;
  if (active.length === 0)
    return yield* new FinanceError({ kind: "invalid", message: "Choose an active category." });
});

// A descriptor move chosen from one transaction takes it along, even if you had moved it
// to another counterparty by hand. Its after image is the assignment the descriptor then
// gives it.
const followDescriptor = Effect.fn("followDescriptor")(function* (
  expected: typeof ExpectedEventVersion.Type,
  aliasKey: string,
  counterpartyId: typeof CounterpartyId.Type,
) {
  const sql = yield* PgClient.PgClient;
  const [event] =
    yield* sql`SELECT e.counterparty_id AS "counterpartyId", e.counterparty_source AS "counterpartySource",
        e.version, e.active, d.alias_key AS "aliasKey"
      FROM events e LEFT JOIN posting_descriptors d ON d.posting_id = e.primary_posting_id
      WHERE e.id = ${expected.eventId}`.pipe(
      Effect.flatMap(
        Schema.decodeUnknownEffect(
          Schema.Array(
            Schema.Struct({
              ...EventAssignment.fields,
              version: Version,
              active: Schema.Boolean,
              aliasKey: Schema.NullOr(Schema.String),
            }),
          ),
        ),
      ),
    );
  if (!event)
    return yield* new FinanceError({ kind: "notFound", message: "Transaction not found." });
  if (event.version !== expected.version)
    return yield* new FinanceError({
      kind: "stale",
      message: "This transaction changed since you opened it. Review it and try again.",
    });
  if (!event.active)
    return yield* new FinanceError({
      kind: "conflict",
      message: "This event was joined to another event. Open its active interpretation.",
    });
  if (event.aliasKey !== aliasKey)
    return yield* new FinanceError({
      kind: "invalid",
      message: `The bank does not write this transaction as ${aliasKey}.`,
    });
  if (event.counterpartySource !== "user") return [];
  return [
    {
      eventId: expected.eventId,
      before: Struct.pick(event, ["counterpartyId", "counterpartySource"]),
      after: { counterpartyId, counterpartySource: "alias" as const },
    },
  ];
});

// The records a change writes, and the counterparty it leaves you on.
export const planChange = Effect.fn("planChange")(function* (change: CounterpartyChange) {
  const sql = yield* PgClient.PgClient;
  const crypto = yield* Crypto.Crypto;
  switch (change.kind) {
    case "create": {
      yield* checkChosenCategory(change.fields.defaultCategoryId, null);
      const id = CounterpartyId.make(yield* crypto.randomUUIDv4);
      const claimed = [...new Map(change.aliases.map((alias) => [alias.aliasKey, alias])).values()];
      const current = yield* readAliases(
        sql.in(
          "alias_key",
          claimed.map((alias) => alias.aliasKey),
        ),
      );
      const aliases = yield* Effect.forEach(claimed, (alias) => {
        const before = current.find((row) => row.aliasKey === alias.aliasKey);
        return checkAliasVersion(before, alias.expectedVersion).pipe(
          Effect.as({ before: before ?? null, after: userAlias(alias.aliasKey, id, before) }),
        );
      });
      return {
        counterpartyId: id,
        images: altered({
          ...noImages,
          counterparties: [
            {
              before: null,
              after: {
                id,
                ...change.fields,
                source: "user",
                status: "applied",
                model: null,
                confidence: null,
                reason: null,
                version: 1,
              },
            },
          ],
          aliases,
        }),
      };
    }
    case "update": {
      const before = yield* readCounterpartyRecord(change.counterpartyId);
      if (before.version !== change.expectedVersion)
        return yield* new FinanceError({
          kind: "stale",
          message: "This counterparty changed. Review it and save again.",
        });
      yield* checkChosenCategory(change.fields.defaultCategoryId, before.defaultCategoryId);
      return {
        counterpartyId: before.id,
        images: altered({
          ...noImages,
          counterparties: [
            {
              before,
              after: {
                ...before,
                ...change.fields,
                source: "user",
                status: "applied",
                version: before.version + 1,
              },
            },
          ],
        }),
      };
    }
    case "merge": {
      const source = yield* readCounterpartyRecord(change.sourceId);
      const target = yield* readCounterpartyRecord(change.targetId);
      if (source.version !== change.sourceVersion || target.version !== change.targetVersion)
        return yield* new FinanceError({
          kind: "stale",
          message: "A counterparty changed. Review both and merge again.",
        });
      const aliases = yield* readAliases(sql`counterparty_id = ${source.id}`);
      const references = yield* readReferences(
        sql`counterparty_id IN (${source.id}, ${target.id})`,
      );
      const sourceReferences = references.filter((row) => row.counterpartyId === source.id);
      const events =
        yield* sql`SELECT id AS "eventId", counterparty_id AS "counterpartyId", counterparty_source AS "counterpartySource"
          FROM events WHERE counterparty_id = ${source.id} AND (counterparty_source = 'user' OR NOT active)`.pipe(
          Effect.flatMap(
            Schema.decodeUnknownEffect(
              Schema.Array(Schema.Struct({ eventId: EventId, ...EventAssignment.fields })),
            ),
          ),
        );
      const rules =
        yield* sql`SELECT id FROM rules WHERE conditions->>'counterpartyId' = ${source.id}::text`.pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ id: RuleId })))),
        );
      const movements =
        yield* sql`SELECT event_id AS id FROM movement_links WHERE original_event->>'counterpartyId' = ${source.id}::text`.pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ id: EventId })))),
        );
      return {
        counterpartyId: target.id,
        images: altered({
          counterparties: [
            { before: source, after: null },
            {
              before: target,
              after: { ...target, source: "user", status: "applied", version: target.version + 1 },
            },
          ],
          // A proposed alias moves still proposed, so its question names the target.
          aliases: aliases.map((before) => ({
            before,
            after:
              before.status === "applied"
                ? userAlias(before.aliasKey, target.id, before)
                : { ...before, counterpartyId: target.id, version: before.version + 1 },
          })),
          // Where both have defaults for a reference key, the target's stay.
          references: [
            ...sourceReferences.map((before) => ({ before, after: null })),
            ...sourceReferences
              .filter(
                (row) =>
                  !references.some(
                    (other) =>
                      other.counterpartyId === target.id && other.referenceKey === row.referenceKey,
                  ),
              )
              .map((row) => ({
                before: null,
                after: { ...row, counterpartyId: target.id, version: 1 },
              })),
          ],
          events: events.map(({ eventId, ...before }) => ({
            eventId,
            before,
            after: { counterpartyId: target.id, counterpartySource: before.counterpartySource },
          })),
          rules: rules.map((row) => ({ ruleId: row.id, before: source.id, after: target.id })),
          movements: movements.map((row) => ({
            eventId: row.id,
            before: source.id,
            after: target.id,
          })),
        }),
      };
    }
    case "moveAlias": {
      const target = yield* readCounterpartyRecord(change.counterpartyId);
      const [before] = yield* readAliases(sql`alias_key = ${change.aliasKey}`);
      yield* checkAliasVersion(before, change.expectedVersion);
      return {
        counterpartyId: target.id,
        images: altered({
          ...noImages,
          aliases: [
            { before: before ?? null, after: userAlias(change.aliasKey, target.id, before) },
          ],
          events: change.event
            ? yield* followDescriptor(change.event, change.aliasKey, target.id)
            : [],
        }),
      };
    }
    case "saveReference": {
      const counterparty = yield* readCounterpartyRecord(change.counterpartyId);
      const [before] = yield* readReferences(
        sql`counterparty_id = ${counterparty.id} AND reference_key = ${change.referenceKey}`,
      );
      yield* checkReferenceVersion(before, change.expectedVersion);
      yield* checkChosenCategory(change.defaultCategoryId, before?.defaultCategoryId ?? null);
      return {
        counterpartyId: counterparty.id,
        images: altered({
          ...noImages,
          references: [
            {
              before: before ?? null,
              after: {
                counterpartyId: counterparty.id,
                referenceKey: change.referenceKey,
                defaultRole: change.defaultRole,
                defaultCategoryId: change.defaultCategoryId,
                version: (before?.version ?? 0) + 1,
              },
            },
          ],
        }),
      };
    }
    case "deleteReference": {
      const counterparty = yield* readCounterpartyRecord(change.counterpartyId);
      const [before] = yield* readReferences(
        sql`counterparty_id = ${counterparty.id} AND reference_key = ${change.referenceKey}`,
      );
      yield* checkReferenceVersion(before, change.expectedVersion);
      return {
        counterpartyId: counterparty.id,
        images: altered({
          ...noImages,
          references: before ? [{ before, after: null }] : [],
        }),
      };
    }
  }
});

// Events whose counterparty follows from these counterparties or alias keys.
const affectedEvents = Effect.fn("affectedEvents")(function* ({
  counterpartyIds,
  aliasKeys,
}: {
  counterpartyIds: readonly (typeof CounterpartyId.Type)[];
  aliasKeys: readonly string[];
}) {
  const sql = yield* PgClient.PgClient;
  const rows =
    yield* sql`SELECT e.id FROM events e LEFT JOIN posting_descriptors d ON d.posting_id = e.primary_posting_id
      WHERE e.active AND (${sql.in("e.counterparty_id", counterpartyIds)} OR ${sql.in("d.alias_key", aliasKeys)})`.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ id: EventId })))),
    );
  return rows.map((row) => row.id);
});

// A counterparty is deleted only when nothing outside the change still names it.
const checkUnused = Effect.fn("checkUnused")(function* (
  counterparty: typeof CounterpartyRecord.Type,
) {
  const sql = yield* PgClient.PgClient;
  const [uses] = yield* sql`SELECT
      (SELECT count(*) FROM events WHERE counterparty_id = ${counterparty.id})::int AS events,
      (SELECT count(*) FROM counterparty_aliases WHERE counterparty_id = ${counterparty.id})::int AS aliases,
      (SELECT count(*) FROM counterparty_references WHERE counterparty_id = ${counterparty.id})::int AS "references",
      (SELECT count(*) FROM rules WHERE conditions->>'counterpartyId' = ${counterparty.id}::text)::int AS rules,
      (SELECT count(*) FROM movement_links WHERE original_event->>'counterpartyId' = ${counterparty.id}::text)::int AS movements`.pipe(
    Effect.flatMap(
      Schema.decodeUnknownEffect(
        Schema.Tuple([
          Schema.Struct({
            events: Schema.Int,
            aliases: Schema.Int,
            references: Schema.Int,
            rules: Schema.Int,
            movements: Schema.Int,
          }),
        ]),
      ),
    ),
  );
  const count = (n: number, one: string, many: string) =>
    n === 0 ? [] : [`${n} ${n === 1 ? one : many}`];
  const remaining = [
    ...count(uses.events, "transaction", "transactions"),
    ...count(uses.aliases, "descriptor", "descriptors"),
    ...count(uses.references, "reference default", "reference defaults"),
    ...count(uses.rules, "rule", "rules"),
    ...count(uses.movements, "linked movement", "linked movements"),
  ];
  if (remaining.length > 0)
    return yield* new FinanceError({
      kind: "conflict",
      message: `${counterparty.name} still has ${new Intl.ListFormat("en-AU").format(remaining)}. Move them to another counterparty first.`,
    });
});

// Writes the after image of every record in dependency order, with plain statements so
// the fact triggers see each change, then reinterprets the events that follow from
// them. A counterparty whose after image is null is deleted last, once nothing names it.
export const applyImages = Effect.fn("applyImages")(function* (images: CounterpartyImages) {
  const sql = yield* PgClient.PgClient;
  for (const { before, after } of images.counterparties) {
    if (!after) continue;
    if (before)
      yield* sql`UPDATE counterparties SET name = ${after.name}, kind = ${after.kind}, brand = ${after.brand},
        default_category_id = ${after.defaultCategoryId}, default_role = ${after.defaultRole}, source = ${after.source},
        status = ${after.status}, model = ${after.model}, confidence = ${after.confidence}, reason = ${after.reason},
        version = ${after.version}, updated_at = now() WHERE id = ${after.id}`;
    else
      yield* sql`INSERT INTO counterparties (id, name, kind, brand, default_category_id, default_role, source, status, model, confidence, reason, version)
        VALUES (${after.id}, ${after.name}, ${after.kind}, ${after.brand}, ${after.defaultCategoryId}, ${after.defaultRole},
          ${after.source}, ${after.status}, ${after.model}, ${after.confidence}, ${after.reason}, ${after.version})`;
  }
  for (const { before, after } of images.aliases) {
    if (!after) {
      if (before) yield* sql`DELETE FROM counterparty_aliases WHERE alias_key = ${before.aliasKey}`;
    } else if (before)
      yield* sql`UPDATE counterparty_aliases SET counterparty_id = ${after.counterpartyId}, source = ${after.source},
        status = ${after.status}, confidence = ${after.confidence}, reason = ${after.reason}, version = ${after.version}
        WHERE alias_key = ${after.aliasKey}`;
    else
      yield* sql`INSERT INTO counterparty_aliases (alias_key, counterparty_id, source, status, confidence, reason, version)
        VALUES (${after.aliasKey}, ${after.counterpartyId}, ${after.source}, ${after.status}, ${after.confidence}, ${after.reason}, ${after.version})`;
  }
  for (const { before, after } of images.references)
    if (before && !after)
      yield* sql`DELETE FROM counterparty_references WHERE counterparty_id = ${before.counterpartyId} AND reference_key = ${before.referenceKey}`;
  for (const { before, after } of images.references) {
    if (!after) continue;
    if (before)
      yield* sql`UPDATE counterparty_references SET default_role = ${after.defaultRole}, default_category_id = ${after.defaultCategoryId},
        version = ${after.version}, updated_at = now() WHERE counterparty_id = ${after.counterpartyId} AND reference_key = ${after.referenceKey}`;
    else
      yield* sql`INSERT INTO counterparty_references (counterparty_id, reference_key, default_role, default_category_id, version)
        VALUES (${after.counterpartyId}, ${after.referenceKey}, ${after.defaultRole}, ${after.defaultCategoryId}, ${after.version})`;
  }
  for (const batch of Arr.chunksOf(images.events, 500))
    yield* sql`UPDATE events e SET counterparty_id = x."counterpartyId", counterparty_source = x."counterpartySource", version = e.version + 1
      FROM jsonb_to_recordset(${sql.json(
        batch.map(({ eventId, after }) => ({ eventId, ...after })),
      )}) AS x("eventId" uuid, "counterpartyId" uuid, "counterpartySource" text) WHERE e.id = x."eventId"`;
  for (const { ruleId, after } of images.rules)
    yield* sql`UPDATE rules SET conditions = jsonb_set(conditions, '{counterpartyId}', to_jsonb(${after}::text)), version = version + 1 WHERE id = ${ruleId}`;
  for (const { eventId, after } of images.movements)
    yield* sql`UPDATE movement_links SET original_event = jsonb_set(original_event, '{counterpartyId}', to_jsonb(${after}::text)) WHERE event_id = ${eventId}`;
  const affected = yield* affectedEvents({
    counterpartyIds: unique([
      ...records(images.counterparties).map((row) => row.id),
      ...records(images.aliases).map((row) => row.counterpartyId),
      ...records(images.references).map((row) => row.counterpartyId),
    ]),
    aliasKeys: unique(records(images.aliases).map((row) => row.aliasKey)),
  });
  yield* reinterpret(unique([...affected, ...images.events.map((row) => row.eventId)]));
  const removed = images.counterparties.flatMap(({ before, after }) =>
    before && !after ? [before] : [],
  );
  for (const counterparty of removed) yield* checkUnused(counterparty);
  if (removed.length > 0)
    yield* sql`DELETE FROM counterparties WHERE ${sql.in(
      "id",
      removed.map((row) => row.id),
    )}`;
});

// Every counterparty a change's images name.
function counterpartiesOf(images: CounterpartyImages) {
  return unique([
    ...records(images.counterparties).map((row) => row.id),
    ...records(images.aliases).map((row) => row.counterpartyId),
    ...records(images.references).map((row) => row.counterpartyId),
    ...images.events.flatMap(({ before, after }) =>
      [before.counterpartyId, after.counterpartyId].filter(Predicate.isNotNull),
    ),
    ...images.rules.flatMap(({ before, after }) => [before, after]),
    ...images.movements.flatMap(({ before, after }) => [before, after]),
  ]);
}

// The counterparties a change wrote, named as the change left them, or as they were
// before it for one it deleted.
const subjectsOf = Effect.fn("subjectsOf")(function* (images: CounterpartyImages) {
  const sql = yield* PgClient.PgClient;
  const named = new Map(
    images.counterparties.flatMap(({ before, after }) => {
      const row = after ?? before;
      return row ? [[row.id, row.name] as const] : [];
    }),
  );
  const others = yield* readCounterpartyRecords(
    sql.in(
      "id",
      counterpartiesOf(images).filter((id) => !named.has(id)),
    ),
  );
  for (const row of others) named.set(row.id, row.name);
  return [...named].map(([id, name]) => ({ id, name }));
});

// Records a change with the counterparties it wrote and every transaction whose meaning
// it altered, which are the events this transaction has changed so far.
export const recordChange = Effect.fn("recordChange")(function* ({
  commandId,
  kind,
  undoes,
  images,
}: {
  commandId: typeof CommandId.Type;
  kind: typeof CounterpartyChangeKind.Type;
  undoes: typeof CounterpartyChangeId.Type | null;
  images: CounterpartyImages;
}) {
  const sql = yield* PgClient.PgClient;
  const crypto = yield* Crypto.Crypto;
  const id = CounterpartyChangeId.make(yield* crypto.randomUUIDv4);
  yield* sql`INSERT INTO counterparty_changes (id, command_id, kind, undoes, images)
    VALUES (${id}, ${commandId}, ${kind}, ${undoes}, ${sql.json(yield* Schema.encodeEffect(Schema.toCodecJson(CounterpartyImages))(images))})`;
  const subjects = yield* subjectsOf(images);
  if (subjects.length > 0)
    yield* sql`INSERT INTO counterparty_change_subjects ${sql.insert(
      subjects.map((subject) => ({
        change_id: id,
        counterparty_id: subject.id,
        name: subject.name,
      })),
    )}`;
  for (const events of Arr.chunksOf(yield* readNotedEvents, 1000))
    yield* sql`INSERT INTO counterparty_change_events ${sql.insert(
      events.map((eventId) => ({ change_id: id, event_id: eventId })),
    )}`;
  return id;
});
