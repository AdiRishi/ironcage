import type {
  CategoryId,
  Correction,
  CounterpartyChangeEntry,
  CounterpartyChangeKind,
  CounterpartyId,
  CounterpartyImages,
  CounterpartyRecord,
  CounterpartyRole,
  EventHistory,
  EventHistoryEntry,
  FinancialEvent,
  ReferenceData,
} from "@repo/contracts/finance";
import { financialRoleLabels } from "@repo/finance";

import { kindLabels } from "@/features/counterparties/choices";

type Categories = (typeof ReferenceData.Type)["categories"];
type Names = (typeof EventHistory.Type)["names"];
type Change = typeof CounterpartyChangeEntry.Type;
type Counterparty = typeof CounterpartyRecord.Type;

const list = (items: readonly string[]) =>
  new Intl.ListFormat("en-AU", { type: "conjunction" }).format([...new Set(items)]);

const named = (names: Names, id: typeof CounterpartyId.Type | null) =>
  id === null ? "none" : (names.find((row) => row.id === id)?.name ?? "a removed counterparty");

const categoryName = (categories: Categories, id: typeof CategoryId.Type | null) =>
  id === null ? "none" : (categories.find((row) => row.id === id)?.name ?? "a removed category");

const roleName = (role: typeof CounterpartyRole.Type | null) =>
  role === null ? "none" : financialRoleLabels[role];

// The counterparties a change wrote, as it left them or, for one it removed, as they were.
const counterpartiesIn = (images: CounterpartyImages) =>
  images.counterparties.flatMap(({ before, after }) => {
    const row = after ?? before;
    return row ? [row] : [];
  });

// A merge removes its source, and undoing it brings the source back.
const mergedAway = (images: CounterpartyImages) =>
  images.counterparties.flatMap(({ before, after }) => {
    const row = before === null ? after : after === null ? before : null;
    return row ? [row] : [];
  });

const aliasKeys = (images: CounterpartyImages) =>
  images.aliases.flatMap(({ before, after }) => {
    const row = after ?? before;
    return row ? [row.aliasKey] : [];
  });

const referenceKeys = (images: CounterpartyImages) =>
  images.references.flatMap(({ before, after }) => {
    const row = after ?? before;
    return row ? [row.referenceKey] : [];
  });

const nouns = {
  create: "creating a counterparty",
  update: "a change to a counterparty",
  merge: "a merge",
  moveAlias: "a descriptor move",
  saveReference: "a reference default",
  deleteReference: "clearing a reference default",
  acceptCategory: "an accepted subcategory",
  undo: "an undo",
} satisfies Record<typeof CounterpartyChangeKind.Type, string>;

function fieldLines(before: Counterparty, after: Counterparty, categories: Categories) {
  const lines: string[] = [];
  if (before.name !== after.name) lines.push(`Renamed from ${before.name} to ${after.name}`);
  if (before.kind !== after.kind)
    lines.push(`Kind changed from ${kindLabels[before.kind]} to ${kindLabels[after.kind]}`);
  if (before.brand !== after.brand)
    lines.push(after.brand ? `Now part of ${after.brand}` : "No longer part of a brand");
  if (before.defaultRole !== after.defaultRole)
    lines.push(
      `Default role changed from ${roleName(before.defaultRole)} to ${roleName(after.defaultRole)}`,
    );
  if (before.defaultCategoryId !== after.defaultCategoryId)
    lines.push(
      `Default category changed from ${categoryName(categories, before.defaultCategoryId)} to ${categoryName(categories, after.defaultCategoryId)}`,
    );
  return lines.length > 0 ? lines : [`Confirmed ${after.name}`];
}

// What a counterparty change did, one sentence per line. An undo names what it undid;
// its time and scope say where.
export function describeCounterpartyChange(change: Change, categories: Categories) {
  const { images, subjects } = change;
  switch (change.kind) {
    case "create": {
      const keys = aliasKeys(images);
      const names = list(counterpartiesIn(images).map((row) => row.name));
      return [keys.length > 0 ? `Created ${names} for ${list(keys)}` : `Created ${names}`];
    }
    case "update":
      return images.counterparties.flatMap(({ before, after }) =>
        before && after ? fieldLines(before, after, categories) : [],
      );
    case "merge": {
      const sources = mergedAway(images);
      const targets = subjects.filter((row) => !sources.some((source) => source.id === row.id));
      return [
        `Merged ${list(sources.map((row) => row.name))} into ${targets.length > 0 ? list(targets.map((row) => row.name)) : "another counterparty"}`,
      ];
    }
    case "moveAlias":
      return [
        ...images.aliases.flatMap(({ before, after }) => {
          if (!after) return [];
          const from = before?.status === "applied" ? named(subjects, before.counterpartyId) : null;
          const to = named(subjects, after.counterpartyId);
          return [
            from
              ? `Moved ${after.aliasKey} from ${from} to ${to}`
              : `${after.aliasKey} now resolves to ${to}`,
          ];
        }),
        // The transaction the move was chosen from, which you had moved by hand.
        ...images.events.map(
          ({ before }) =>
            `A transaction you had moved to ${named(subjects, before.counterpartyId)} follows the bank's description again`,
        ),
      ];
    case "saveReference":
    case "deleteReference":
      return images.references.flatMap(({ before, after }) => {
        const key = (after ?? before)?.referenceKey;
        if (!key) return [];
        if (!after) return [`Payments marked ${key} follow the defaults again`];
        return [
          after.defaultCategoryId
            ? `Payments marked ${key} set to ${roleName(after.defaultRole)}, ${categoryName(categories, after.defaultCategoryId)}`
            : `Payments marked ${key} set to ${roleName(after.defaultRole)}`,
        ];
      });
    case "acceptCategory": {
      const moved = counterpartiesIn(images);
      return [
        `Moved ${list(moved.map((row) => row.name))} to ${list(moved.map((row) => categoryName(categories, row.defaultCategoryId)))}`,
      ];
    }
    case "undo":
      return [`Undid ${change.undoes ? nouns[change.undoes.kind] : "an earlier change"}`];
  }
}

function counterpartyLine(prior: FinancialEvent, accepted: FinancialEvent, names: Names) {
  const to = named(names, accepted.counterpartyId);
  return accepted.counterpartySource === "user"
    ? `Counterparty changed from ${named(names, prior.counterpartyId)} to ${to}`
    : `Counterparty follows the bank's description again: ${to}`;
}

function allocationLines(prior: FinancialEvent, accepted: FinancialEvent, categories: Categories) {
  const lines: string[] = [];
  if (prior.kind !== accepted.kind)
    lines.push(
      `Role changed from ${financialRoleLabels[prior.kind]} to ${financialRoleLabels[accepted.kind]}`,
    );
  const [before] = prior.allocations;
  const [after] = accepted.allocations;
  const whole = prior.allocations.length === 1 && accepted.allocations.length === 1;
  if (whole && before.categoryId !== after.categoryId)
    lines.push(
      `Category changed from ${categoryName(categories, before.categoryId)} to ${categoryName(categories, after.categoryId)}`,
    );
  else if (
    whole &&
    (before.nonPersonal !== after.nonPersonal ||
      before.tagIds.join() !== after.tagIds.join() ||
      before.personalEventIds.join() !== after.personalEventIds.join())
  )
    lines.push("Labels changed");
  else if (!whole)
    lines.push(
      accepted.allocations.length === 1
        ? "Split removed"
        : prior.allocations.length === 1
          ? `Split into ${accepted.allocations.length} parts`
          : "Split changed",
    );
  if (prior.purchaseOn !== accepted.purchaseOn)
    lines.push(
      accepted.purchaseOn ? `Purchase date set to ${accepted.purchaseOn}` : "Purchase date removed",
    );
  return lines.length > 0 ? lines : ["Saved with nothing changed"];
}

// What a correction did to one transaction, one sentence per line.
export function describeCorrection(
  correction: typeof Correction.Type,
  names: Names,
  categories: Categories,
) {
  const { prior, accepted } = correction;
  const lines =
    correction.change === "counterparty"
      ? [counterpartyLine(prior, accepted, names)]
      : allocationLines(prior, accepted, categories);
  return correction.action === "undo" ? ["Undid an earlier change", ...lines] : lines;
}

// Which transactions a change reached.
export function scopeLabel(entry: typeof EventHistoryEntry.Type) {
  if (entry.kind === "correction") return "Only this transaction";
  const { images, subjects } = entry.change;
  const kind = entry.change.kind === "undo" ? entry.change.undoes?.kind : entry.change.kind;
  const keys = aliasKeys(images);
  if ((kind === "moveAlias" || kind === "create") && keys.length > 0)
    return `Every transaction the bank writes as ${list(keys)}`;
  if (kind === "moveAlias") return "One transaction";
  const names = list((kind === "merge" ? mergedAway(images) : subjects).map((row) => row.name));
  const references = referenceKeys(images);
  return (kind === "saveReference" || kind === "deleteReference") && references.length > 0
    ? `Every ${names} transaction marked ${list(references)}`
    : `Every ${names} transaction`;
}
