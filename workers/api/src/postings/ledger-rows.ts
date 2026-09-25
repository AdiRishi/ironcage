import type { CountedFilter } from "@repo/contracts/finance";
import type { SqlClient, Statement } from "effect/unstable/sql";

import { postingFields } from "../database/columns.ts";

export const pageSize = 50;

// A ledger row's columns, from `postings p JOIN accounts a` followed by `ledgerMeaning`.
export const ledgerRowColumns = (
  sql: SqlClient.SqlClient,
) => sql`${postingFields(sql)}, x."eventId", x.role, x."counterpartyId", x."counterpartyName", x."categoryId",
  x."categoryName", x."categorySlug", COALESCE(x.split, false) AS split,
  CASE
    WHEN x."eventId" IS NULL THEN 'none'
    WHEN x.split OR x."roleSource" = 'user' OR x."categorySource" = 'user' THEN 'you'
    WHEN x."roleSource" = 'rule' OR x."categorySource" = 'rule' THEN 'rule'
    WHEN (x."roleSource" = 'counterparty' OR x."categorySource" = 'counterparty') AND x."counterpartySource" = 'model' THEN 'model'
    WHEN x."roleSource" = 'counterparty' OR x."categorySource" = 'counterparty' THEN 'you'
    WHEN x."roleSource" = 'bank' THEN 'bank'
    ELSE 'none'
  END AS "assignedBy",
  COALESCE(x.question, false) AS question`;

// What posting `p` means: its active event, the event's counterparty, and its first
// allocation's category.
export const ledgerMeaning = (sql: SqlClient.SqlClient) => sql`LEFT JOIN LATERAL (
    SELECT e.id AS "eventId", e.kind AS role, e.role_source AS "roleSource", c.id AS "counterpartyId",
      c.name AS "counterpartyName", c.source AS "counterpartySource", al.category_id AS "categoryId",
      k.name AS "categoryName", COALESCE(k.slug, parent.slug) AS "categorySlug", al.category_source AS "categorySource",
      (SELECT count(*) FROM allocations x WHERE x.event_id = e.id) > 1 AS split,
      (e.kind = 'unresolved' OR c.status = 'proposed' OR (c.kind = 'person' AND c.default_role IS NULL)) AS question
    FROM event_postings ep JOIN events e ON e.id = ep.event_id AND e.active
    LEFT JOIN counterparties c ON c.id = e.counterparty_id
    LEFT JOIN LATERAL (SELECT * FROM allocations WHERE event_id = e.id ORDER BY id LIMIT 1) al ON true
    LEFT JOIN categories k ON k.id = al.category_id
    LEFT JOIN categories parent ON parent.id = k.parent_id
    WHERE ep.posting_id = p.id AND ep.active LIMIT 1
  ) x ON true`;

// Filters on posting `p` itself, shared by the posting ledger and the counted ledger.
export const postingPredicates = (
  sql: SqlClient.SqlClient,
  filter: Omit<typeof CountedFilter.Type, "tagId" | "personalEventId">,
) => {
  const predicates: Statement.Fragment[] = [];
  if (filter.role)
    predicates.push(
      sql`EXISTS (SELECT 1 FROM events e JOIN event_postings ep ON ep.event_id = e.id WHERE ep.posting_id = p.id AND ep.active AND e.kind = ${filter.role})`,
    );
  if (filter.interpretationReview !== undefined)
    predicates.push(
      sql`EXISTS (SELECT 1 FROM event_postings ep JOIN events e ON e.id = ep.event_id LEFT JOIN counterparties c ON c.id = e.counterparty_id WHERE ep.posting_id = p.id AND ep.active AND (e.kind = 'unresolved' OR c.status = 'proposed' OR (c.kind = 'person' AND c.default_role IS NULL))) = ${filter.interpretationReview}`,
    );
  if (filter.accountId) predicates.push(sql`p.account_id = ${filter.accountId}`);
  if (filter.minimum) predicates.push(sql`p.amount_minor >= ${filter.minimum}::bigint`);
  if (filter.maximum) predicates.push(sql`p.amount_minor <= ${filter.maximum}::bigint`);
  if (filter.description)
    predicates.push(
      sql`(strpos(lower(p.description), lower(${filter.description})) > 0 OR EXISTS (SELECT 1 FROM event_postings ep JOIN events e ON e.id = ep.event_id JOIN counterparties c ON c.id = e.counterparty_id WHERE ep.posting_id = p.id AND ep.active AND strpos(lower(c.name), lower(${filter.description})) > 0))`,
    );
  if (filter.importId)
    predicates.push(
      sql`EXISTS (SELECT 1 FROM observations o WHERE o.posting_id = p.id AND o.import_id = ${filter.importId})`,
    );
  if (filter.needsReview !== undefined)
    predicates.push(
      sql`EXISTS (SELECT 1 FROM review_items r WHERE r.resolved_at IS NULL AND (r.candidates ? p.id::text OR EXISTS (SELECT 1 FROM observations o WHERE o.id = ANY(r.observation_ids) AND o.posting_id = p.id))) = ${filter.needsReview}`,
    );
  return predicates;
};

// Tag and personal-event filters on one allocation. A split matches only through the
// part that carries the tag or the event.
export const allocationPredicates = (
  sql: SqlClient.SqlClient,
  allocationId: Statement.Fragment,
  filter: Pick<typeof CountedFilter.Type, "tagId" | "personalEventId">,
) => {
  const predicates: Statement.Fragment[] = [];
  if (filter.tagId)
    predicates.push(
      sql`EXISTS (SELECT 1 FROM allocation_tags t WHERE t.allocation_id = ${allocationId} AND t.tag_id = ${filter.tagId})`,
    );
  if (filter.personalEventId)
    predicates.push(
      sql`EXISTS (SELECT 1 FROM allocation_personal_events t WHERE t.allocation_id = ${allocationId} AND t.personal_event_id = ${filter.personalEventId})`,
    );
  return predicates;
};
