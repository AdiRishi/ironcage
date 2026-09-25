import { PgClient } from "@effect/sql-pg";
import {
  AccountId,
  AccountKind,
  CalendarDate,
  CategoryId,
  CategorySource,
  CategoryTree,
  Channel,
  CounterpartyId,
  CounterpartyKind,
  CounterpartyRole,
  CounterpartySource,
  type Descriptor,
  EventId,
  FinanceError,
  FinancialRole,
  Institution,
  PostingId,
  Rule,
  RoleSource,
  Version,
} from "@repo/contracts/finance";
import {
  allocationRole,
  bankReading,
  type CounterpartyDefaults,
  deriveInterpretation,
  descriptorProfiles,
  conflictingRules,
  ruleActions,
  ruleMatches,
} from "@repo/finance";
import { Array as Arr, Crypto, Effect, Schema } from "effect";

import { proposeCredits, proposeMovements } from "../relationships/proposals.ts";

const Subject = Schema.Struct({
  id: EventId,
  kind: FinancialRole,
  roleSource: Schema.NullOr(RoleSource),
  counterpartyId: Schema.NullOr(CounterpartyId),
  counterpartySource: Schema.NullOr(CounterpartySource),
  version: Version,
  reportingAccountId: AccountId,
  postingId: PostingId,
  postedOn: CalendarDate,
  amountMinor: Schema.BigIntFromString,
  description: Schema.String,
  descriptions: Schema.Array(Schema.String),
  accountKind: AccountKind,
  aliasCounterpartyId: Schema.NullOr(CounterpartyId),
  roleProtected: Schema.Boolean,
  allocations: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      categoryId: Schema.NullOr(CategoryId),
      categorySource: Schema.NullOr(CategorySource),
    }),
  ),
  descriptor: Schema.NullOr(
    Schema.Struct({
      profileVersion: Schema.Int,
      channel: Channel,
      counterpartyText: Schema.NullOr(Schema.String),
      aliasKey: Schema.NullOr(Schema.String),
      cardSuffix: Schema.NullOr(Schema.String),
      ownAccountSuffix: Schema.NullOr(Schema.String),
      payId: Schema.NullOr(Schema.String),
      reference: Schema.NullOr(Schema.String),
      referenceKey: Schema.NullOr(Schema.String),
      foreign: Schema.NullOr(Schema.Struct({ currency: Schema.String, amount: Schema.String })),
    }),
  ),
  rules: Schema.Array(Rule),
});
export type Subject = typeof Subject.Type;

export type EventScope = "all" | readonly (typeof EventId.Type)[];

const loadSubjects = Effect.fn("loadSubjects")(function* (scope: EventScope) {
  const sql = yield* PgClient.PgClient;
  if (scope !== "all" && scope.length === 0) return [];
  const filter = scope === "all" ? sql`true` : sql`e.id = ANY(${scope}::uuid[])`;
  return yield* sql`SELECT e.id, e.kind, e.role_source AS "roleSource", e.counterparty_id AS "counterpartyId",
      e.counterparty_source AS "counterpartySource", e.version, e.reporting_account_id AS "reportingAccountId",
      p.id AS "postingId", p.posted_on::text AS "postedOn",
      p.amount_minor::text AS "amountMinor", p.description, a.kind AS "accountKind",
      ARRAY(SELECT q.description FROM event_postings ep JOIN postings q ON q.id = ep.posting_id WHERE ep.event_id = e.id AND ep.active) AS descriptions,
      ca.counterparty_id AS "aliasCounterpartyId",
      (e.role_source IS NOT DISTINCT FROM 'link'
        OR EXISTS (SELECT 1 FROM credit_links c JOIN allocations x ON x.id IN (c.credit_allocation_id, c.cost_allocation_id) WHERE x.event_id = e.id)
        OR EXISTS (SELECT 1 FROM fee_associations f WHERE e.id IN (f.fee_event_id, f.purchase_event_id))) AS "roleProtected",
      (SELECT jsonb_agg(jsonb_build_object('id', al.id, 'categoryId', al.category_id, 'categorySource', al.category_source) ORDER BY al.id) FROM allocations al WHERE al.event_id = e.id) AS allocations,
      CASE WHEN d.posting_id IS NULL THEN NULL ELSE jsonb_build_object(
        'profileVersion', d.profile_version, 'channel', d.channel, 'counterpartyText', d.counterparty_text,
        'aliasKey', d.alias_key, 'cardSuffix', d.card_suffix, 'ownAccountSuffix', d.own_account_suffix,
        'payId', d.pay_id, 'reference', d.reference, 'referenceKey', d.reference_key,
        'foreign', CASE WHEN d.foreign_currency IS NULL THEN NULL ELSE jsonb_build_object('currency', d.foreign_currency, 'amount', d.foreign_amount) END) END AS descriptor,
      COALESCE((SELECT r.applied_rules FROM rule_applications r WHERE r.event_id = e.id), '[]'::jsonb) AS rules
    FROM events e
    JOIN postings p ON p.id = e.primary_posting_id
    JOIN accounts a ON a.id = p.account_id
    LEFT JOIN posting_descriptors d ON d.posting_id = p.id
    LEFT JOIN counterparty_aliases ca ON ca.alias_key = d.alias_key AND ca.status = 'applied'
    WHERE e.active AND ${filter}`.pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Subject))),
  );
});

export const loadReference = Effect.gen(function* () {
  const sql = yield* PgClient.PgClient;
  const categories = yield* sql`SELECT id, slug, tree FROM categories WHERE NOT archived`.pipe(
    Effect.flatMap(
      Schema.decodeUnknownEffect(
        Schema.Array(
          Schema.Struct({ id: CategoryId, slug: Schema.NullOr(Schema.String), tree: CategoryTree }),
        ),
      ),
    ),
  );
  const counterparties =
    yield* sql`SELECT id, kind, default_role AS "defaultRole", default_category_id AS "defaultCategoryId", status = 'applied' AS applied FROM counterparties`.pipe(
      Effect.flatMap(
        Schema.decodeUnknownEffect(
          Schema.Array(
            Schema.Struct({
              id: CounterpartyId,
              kind: CounterpartyKind,
              defaultRole: Schema.NullOr(CounterpartyRole),
              defaultCategoryId: Schema.NullOr(CategoryId),
              applied: Schema.Boolean,
            }),
          ),
        ),
      ),
    );
  const ownedAccounts =
    yield* sql`SELECT id, kind, CASE WHEN length(account_number) >= 4 THEN right(regexp_replace(account_number, '\\D', '', 'g'), 4) END AS suffix FROM accounts`.pipe(
      Effect.flatMap(
        Schema.decodeUnknownEffect(
          Schema.Array(
            Schema.Struct({
              id: AccountId,
              kind: AccountKind,
              suffix: Schema.NullOr(Schema.String),
            }),
          ),
        ),
      ),
    );
  const byReference =
    yield* sql`SELECT counterparty_id AS "counterpartyId", reference_key AS "referenceKey", default_role AS "defaultRole", default_category_id AS "defaultCategoryId" FROM counterparty_references`.pipe(
      Effect.flatMap(
        Schema.decodeUnknownEffect(
          Schema.Array(
            Schema.Struct({
              counterpartyId: CounterpartyId,
              referenceKey: Schema.String,
              defaultRole: CounterpartyRole,
              defaultCategoryId: Schema.NullOr(CategoryId),
            }),
          ),
        ),
      ),
    );
  return {
    trees: new Map(categories.map((category) => [category.id, category.tree])),
    referenceDefaults: new Map(
      byReference.map((row) => [`${row.counterpartyId}:${row.referenceKey}`, row]),
    ),
    slugs: new Map(
      categories.flatMap((category) => (category.slug ? [[category.slug, category.id]] : [])),
    ),
    counterparties: new Map<string, CounterpartyDefaults>(
      counterparties.map((counterparty) => [counterparty.id, counterparty]),
    ),
    ownedAccounts,
  };
});

export type Reference = Effect.Success<typeof loadReference>;
export type DerivedChange = {
  eventId: typeof EventId.Type;
  kind: FinancialRole;
  roleSource: RoleSource | null;
  counterpartyId: typeof CounterpartyId.Type | null;
  counterpartySource: typeof CounterpartySource.Type | null;
  allocationId: string | null;
  role: ReturnType<typeof allocationRole>;
  categoryId: typeof CategoryId.Type | null;
  categorySource: CategorySource | null;
};

// A counterparty's defaults for one payment: its default for the payment's reference
// when you set one, otherwise its own. A reference default is always yours, so it
// applies even while the model's counterparty waits for your answer.
function counterpartyDefaults(
  reference: Reference,
  counterpartyId: typeof CounterpartyId.Type,
  referenceKey: string | null,
) {
  const counterparty = reference.counterparties.get(counterpartyId);
  if (!counterparty) return null;
  const byReference = referenceKey
    ? reference.referenceDefaults.get(`${counterpartyId}:${referenceKey}`)
    : undefined;
  return byReference
    ? {
        ...counterparty,
        defaultRole: byReference.defaultRole,
        defaultCategoryId: byReference.defaultCategoryId,
        applied: true,
      }
    : counterparty;
}

// The assignments each subject would get from its current inputs, for those that differ.
export function planDerivation(
  subjects: readonly Subject[],
  reference: Reference,
): DerivedChange[] {
  return subjects.flatMap((subject) => {
    const descriptor = subject.descriptor;
    const counterpartyId =
      subject.counterpartySource === "user" ? subject.counterpartyId : subject.aliasCounterpartyId;
    const derived = deriveInterpretation({
      event: subject,
      roleLocked: subject.roleProtected,
      amountMinor: subject.amountMinor,
      bank: descriptor
        ? bankReading({
            descriptor,
            description: subject.description,
            amountMinor: subject.amountMinor,
            accountKind: subject.accountKind,
            ownedAccounts: reference.ownedAccounts,
          })
        : { role: null, categorySlug: null },
      aliasCounterpartyId: subject.aliasCounterpartyId,
      counterparty: counterpartyId
        ? counterpartyDefaults(reference, counterpartyId, descriptor?.referenceKey ?? null)
        : null,
      rules: ruleActions(subject.rules),
      categoryTree: (id) => reference.trees.get(id) ?? null,
      categoryIdForSlug: (slug) => reference.slugs.get(slug) ?? null,
    });
    const [allocation, ...rest] = subject.allocations;
    const single = allocation && rest.length === 0;
    const changed =
      derived.kind !== subject.kind ||
      derived.roleSource !== subject.roleSource ||
      derived.counterpartyId !== subject.counterpartyId ||
      derived.counterpartySource !== subject.counterpartySource ||
      (single &&
        (derived.categoryId !== allocation.categoryId ||
          derived.categorySource !== allocation.categorySource));
    return changed
      ? [
          {
            eventId: subject.id,
            ...derived,
            allocationId: single ? allocation.id : null,
            role: allocationRole(derived.kind),
          },
        ]
      : [];
  });
}

export const writeDerivation = Effect.fn("writeDerivation")(function* (
  changes: readonly DerivedChange[],
) {
  const sql = yield* PgClient.PgClient;
  for (const batch of Arr.chunksOf(changes, 500)) {
    const records = sql`jsonb_to_recordset(${sql.json(batch)}) AS x("eventId" uuid, kind text, "roleSource" text, "counterpartyId" uuid, "counterpartySource" text, "allocationId" uuid, role text, "categoryId" uuid, "categorySource" text)`;
    yield* sql`UPDATE events e SET kind = x.kind, role_source = x."roleSource", counterparty_id = x."counterpartyId", counterparty_source = x."counterpartySource", purchase_on = CASE WHEN x.kind = 'purchase' THEN e.purchase_on END, version = e.version + 1 FROM ${records} WHERE e.id = x."eventId"`;
    yield* sql`UPDATE allocations a SET role = x.role, category_id = x."categoryId", category_source = x."categorySource" FROM ${records} WHERE a.id = x."allocationId"`;
  }
  return changes.map((change) => change.eventId);
});

// Recomputes every assignment that you did not set, for the events in scope.
export const reinterpret = Effect.fn("reinterpret")(function* (scope: EventScope) {
  const subjects = yield* loadSubjects(scope);
  return yield* writeDerivation(planDerivation(subjects, yield* loadReference));
});

// Rules claim events with a snapshot of themselves, so a later edit with future
// scope leaves earlier applications as they were.
export const claimRules = Effect.fn("claimRules")(function* ({
  scope,
  rules,
}: {
  scope: EventScope;
  rules: readonly Rule[];
}) {
  const sql = yield* PgClient.PgClient;
  if (rules.length === 0) return [];
  const subjects = yield* loadSubjects(scope);
  const exceptions =
    yield* sql`SELECT rule_id AS "ruleId", event_id AS "eventId" FROM rule_exceptions WHERE ${sql.in(
      "rule_id",
      rules.map((rule) => rule.id),
    )}`.pipe(
      Effect.flatMap(
        Schema.decodeUnknownEffect(
          Schema.Array(Schema.Struct({ ruleId: Schema.String, eventId: EventId })),
        ),
      ),
    );
  const claimed: (typeof EventId.Type)[] = [];
  for (const subject of subjects) {
    const matching = rules.filter(
      (rule) =>
        matchesSubject(rule, subject) &&
        !exceptions.some((row) => row.ruleId === rule.id && row.eventId === subject.id),
    );
    const kept = subject.rules.filter((rule) => !rules.some((item) => item.id === rule.id));
    const next = [...kept, ...matching];
    if (next.length === subject.rules.length && matching.length === 0) continue;
    claimed.push(subject.id);
    if (next.length === 0) yield* sql`DELETE FROM rule_applications WHERE event_id = ${subject.id}`;
    else
      yield* sql`INSERT INTO rule_applications (event_id, applied_rules) VALUES (${subject.id}, ${sql.json(next)}) ON CONFLICT (event_id) DO UPDATE SET applied_rules = EXCLUDED.applied_rules`;
  }
  return claimed;
});

export function subjectConflictingRules(subject: Subject) {
  const [allocation, ...rest] = subject.allocations;
  return conflictingRules({
    rules: subject.rules,
    roleLocked:
      subject.roleProtected || subject.roleSource === "user" || subject.roleSource === "link",
    categoryLocked: rest.length > 0 || allocation?.categorySource === "user",
  });
}

// What the rules claiming an event disagree about: its role, its category, or both.
export const disputedValues = Effect.fn("disputedValues")(function* (eventId: typeof EventId.Type) {
  const subjects = yield* loadSubjects([eventId]);
  return subjects.flatMap((subject) =>
    subjectConflictingRules(subject).map((rule) => rule.action.kind),
  );
});

export function matchesSubject(
  rule: Rule,
  subject: Pick<
    Subject,
    "reportingAccountId" | "kind" | "counterpartyId" | "descriptions" | "descriptor"
  >,
) {
  return ruleMatches(rule, subject, subject.descriptor);
}

export const loadEventSubjects = loadSubjects;

// Descriptors for postings that have none, or whose account's institution profile has
// a newer version than the one that read them.
export const writeDescriptors = Effect.gen(function* () {
  const sql = yield* PgClient.PgClient;
  const versions = Object.fromEntries(
    Object.entries(descriptorProfiles).map(([institution, profile]) => [
      institution,
      profile.version,
    ]),
  );
  const rows =
    yield* sql`SELECT p.id, p.description, p.amount_minor::text AS "amountMinor", a.kind AS "accountKind", a.institution
      FROM postings p JOIN accounts a ON a.id = p.account_id LEFT JOIN posting_descriptors d ON d.posting_id = p.id
      WHERE d.posting_id IS NULL OR d.profile <> a.institution
        OR d.profile_version < (${sql.json(versions)}::jsonb ->> a.institution)::int`.pipe(
      Effect.flatMap(
        Schema.decodeUnknownEffect(
          Schema.Array(
            Schema.Struct({
              id: Schema.String,
              description: Schema.String,
              amountMinor: Schema.BigIntFromString,
              accountKind: AccountKind,
              institution: Institution,
            }),
          ),
        ),
      ),
    );
  for (const batch of Arr.chunksOf(rows, 500)) {
    const records = batch.map((row) => ({
      ...descriptorRecord(row.id, descriptorProfiles[row.institution].describe(row)),
      profile: row.institution,
    }));
    yield* sql`INSERT INTO posting_descriptors ${sql.insert(records)} ON CONFLICT (posting_id) DO UPDATE SET profile = EXCLUDED.profile, profile_version = EXCLUDED.profile_version, channel = EXCLUDED.channel, counterparty_text = EXCLUDED.counterparty_text, alias_key = EXCLUDED.alias_key, card_suffix = EXCLUDED.card_suffix, own_account_suffix = EXCLUDED.own_account_suffix, pay_id = EXCLUDED.pay_id, reference = EXCLUDED.reference, reference_key = EXCLUDED.reference_key, foreign_currency = EXCLUDED.foreign_currency, foreign_amount = EXCLUDED.foreign_amount`;
  }
  return rows.map((row) => row.id);
});

function descriptorRecord(postingId: string, descriptor: Descriptor) {
  return {
    posting_id: postingId,
    profile_version: descriptor.profileVersion,
    channel: descriptor.channel,
    counterparty_text: descriptor.counterpartyText,
    alias_key: descriptor.aliasKey,
    card_suffix: descriptor.cardSuffix,
    own_account_suffix: descriptor.ownAccountSuffix,
    pay_id: descriptor.payId,
    reference: descriptor.reference,
    reference_key: descriptor.referenceKey,
    foreign_currency: descriptor.foreign?.currency ?? null,
    foreign_amount: descriptor.foreign?.amount ?? null,
  };
}

const createEvents = Effect.gen(function* () {
  const sql = yield* PgClient.PgClient;
  const crypto = yield* Crypto.Crypto;
  const postings =
    yield* sql`SELECT p.id, p.account_id AS "accountId", p.currency, abs(p.amount_minor)::text AS magnitude FROM postings p
      WHERE NOT EXISTS (SELECT 1 FROM event_postings ep WHERE ep.posting_id = p.id AND ep.active) ORDER BY p.id`.pipe(
      Effect.flatMap(
        Schema.decodeUnknownEffect(
          Schema.Array(
            Schema.Struct({
              id: Schema.String,
              accountId: Schema.String,
              currency: Schema.String,
              magnitude: Schema.String,
            }),
          ),
        ),
      ),
    );
  const created: (typeof EventId.Type)[] = [];
  for (const batch of Arr.chunksOf(postings, 500)) {
    const records = yield* Effect.forEach(batch, (posting) =>
      Effect.all({ id: crypto.randomUUIDv4, allocationId: crypto.randomUUIDv4 }).pipe(
        Effect.map((ids) => ({ ...ids, posting })),
      ),
    );
    yield* sql`INSERT INTO events ${sql.insert(records.map(({ id, posting }) => ({ id, kind: "unresolved", currency: posting.currency, magnitude_minor: posting.magnitude, primary_posting_id: posting.id, reporting_account_id: posting.accountId })))}`;
    yield* sql`INSERT INTO event_postings ${sql.insert(records.map(({ id, posting }) => ({ event_id: id, posting_id: posting.id })))}`;
    yield* sql`INSERT INTO allocations ${sql.insert(records.map(({ id, allocationId, posting }) => ({ id: allocationId, event_id: id, role: "unresolved", amount_minor: posting.magnitude })))}`;
    created.push(...records.map((record) => EventId.make(record.id)));
  }
  return created;
});

const readRules = Effect.gen(function* () {
  const sql = yield* PgClient.PgClient;
  return yield* sql`SELECT id, name, conditions, action, scope, version FROM rules`.pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Rule))),
  );
});

// A reviewed correction can change what the bank booked after the event was
// interpreted. An event with one posting and one allocation follows the new amount. An
// event whose amount is split, linked to a credit, or shared by a movement cannot be
// divided again without you, so the correction fails until you undo that first.
const syncEventAmounts = Effect.gen(function* () {
  const sql = yield* PgClient.PgClient;
  const changed = yield* sql`SELECT e.id, abs(p.amount_minor)::text AS "magnitudeMinor", p.currency,
        (SELECT count(*) FROM allocations a WHERE a.event_id = e.id)::int AS allocations,
        (SELECT count(*) FROM event_postings ep WHERE ep.event_id = e.id AND ep.active)::int AS postings,
        EXISTS (SELECT 1 FROM credit_links l JOIN allocations a ON a.id IN (l.credit_allocation_id, l.cost_allocation_id)
          WHERE a.event_id = e.id) AS linked
      FROM events e JOIN postings p ON p.id = e.primary_posting_id
      WHERE e.active AND (e.magnitude_minor <> abs(p.amount_minor) OR e.currency <> p.currency)`.pipe(
    Effect.flatMap(
      Schema.decodeUnknownEffect(
        Schema.Array(
          Schema.Struct({
            id: EventId,
            magnitudeMinor: Schema.String,
            currency: Schema.String,
            allocations: Schema.Int,
            postings: Schema.Int,
            linked: Schema.Boolean,
          }),
        ),
      ),
    ),
  );
  if (changed.some((row) => row.allocations !== 1 || row.postings !== 1 || row.linked))
    return yield* new FinanceError({
      kind: "conflict",
      message:
        "This correction changes the amount of a transaction that is split, linked to a refund, or part of a movement. Undo that first, then correct the amount.",
    });
  for (const batch of Arr.chunksOf(changed, 500)) {
    const records = sql`jsonb_to_recordset(${sql.json(batch)}) AS x(id uuid, "magnitudeMinor" bigint, currency text)`;
    yield* sql`UPDATE events e SET magnitude_minor = x."magnitudeMinor", currency = x.currency, version = e.version + 1 FROM ${records} WHERE e.id = x.id`;
    yield* sql`UPDATE allocations a SET amount_minor = x."magnitudeMinor" FROM ${records} WHERE a.event_id = x.id`;
  }
});

// Descriptors for new or outdated postings, events for postings without one, rule
// claims for new events, then derivation. Runs inside the caller's transaction.
export const interpretPending = Effect.gen(function* () {
  const sql = yield* PgClient.PgClient;
  yield* syncEventAmounts;
  const described = yield* writeDescriptors;
  const created = yield* createEvents;
  yield* reinterpret(created);
  yield* claimRules({
    scope: created,
    rules: (yield* readRules).filter((rule) => rule.scope !== "past"),
  });
  const redescribed =
    described.length === 0
      ? []
      : (yield* sql`SELECT DISTINCT ep.event_id AS id FROM event_postings ep WHERE ep.active AND ${sql.in("ep.posting_id", described)}`.pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ id: EventId })))),
        )).map((row) => row.id);
  const changed = yield* reinterpret([...new Set([...created, ...redescribed])]);
  if (created.length > 0) {
    yield* proposeMovements;
    yield* proposeCredits;
  }
  return { descriptors: described.length, created: created.length, changed: changed.length };
});
