import type { Basis, Limit, UnbuiltCapability } from "@repo/contracts/analyst";
import type { DateBasis, Period } from "@repo/contracts/finance";
import { periodLabel } from "@repo/finance";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { Amount } from "@/components/amount";
import { RecordsNote } from "@/components/comparison-coverage";
import { settingsQueryOptions } from "@/features/settings/queries";
import { instantLabel } from "@/lib/time";

import type { Citations } from "./answer-text";
import { FigureLink } from "./figure-link";
import { recordLink } from "./record-link";

const list = new Intl.ListFormat("en-AU", { type: "conjunction" });

const dateBases = {
  spending: "spending date",
  posted: "posted date",
} satisfies Record<typeof DateBasis.Type, string>;

// What every figure in an answer rests on: the periods and what they were compared with,
// the date basis, the currency, the accounts, and when it was calculated.
export function BasisLine({ basis }: { basis: Basis }) {
  const { data: settings } = useSuspenseQuery(settingsQueryOptions());
  const periods = basis.periods.map(({ period, comparison }) =>
    comparison
      ? `${periodLabel(period)} compared with ${periodLabel(comparison)}`
      : periodLabel(period),
  );
  const accounts = basis.accounts.map(({ account }) => account.label);
  const others = basis.otherCurrencyAccounts.map(
    (account) => `${account.label} in ${account.currency}`,
  );
  return (
    <p className="type-small text-slate">
      Based on {list.format(periods)}, by {dateBases[basis.basis]}, in {basis.currency}
      {accounts.length > 0 && `, from ${list.format(accounts)}`}.
      {others.length > 0 &&
        ` ${list.format(others)} ${others.length === 1 ? "is" : "are"} left out.`}{" "}
      Calculated {instantLabel(basis.calculatedAt, settings.timezone)}.
    </p>
  );
}

const unbuilt = {
  recurring: "Ironcage does not detect recurring payments yet.",
  forecast: "Ironcage does not forecast yet.",
  investments: "Ironcage does not track investments yet.",
  otherBanks: "Ironcage does not read accounts at other banks yet.",
} satisfies Record<UnbuiltCapability, string>;

type Gap = Extract<Limit, { kind: "missingRecords" }>;

// Days without records, by account, in the order the answer's basis lists them.
function gapsByAccount(gaps: ReadonlyArray<Gap>) {
  const accounts = new Map<Gap["account"]["id"], { account: Gap["account"]; periods: Period[] }>();
  for (const { account, period } of gaps) {
    const entry = accounts.get(account.id) ?? { account, periods: [] };
    entry.periods.push(period);
    accounts.set(account.id, entry);
  }
  return [...accounts.values()];
}

// Why an answer may fall short, as code found it: days without records, money not yet
// understood or resting on the model, a list read only in part, figures waiting to be
// recalculated, and what Ironcage cannot do yet.
export function Limits({ limits, cited }: { limits: ReadonlyArray<Limit>; cited: Citations }) {
  if (limits.length === 0) return null;
  const gaps = gapsByAccount(limits.filter((limit) => limit.kind === "missingRecords"));
  const others = limits.filter((limit) => limit.kind !== "missingRecords");
  return (
    <div className="space-y-1">
      {gaps.map(({ account, periods }) => (
        <RecordsNote key={account.id}>
          {account.label} has no records for {list.format(periods.map(periodLabel))}, so the figures
          leave those days out.
        </RecordsNote>
      ))}
      {gaps.length > 0 && (
        <p className="type-small">
          <Link to="/sources" className="underline underline-offset-4">
            Upload the missing records in Sources
          </Link>
        </p>
      )}
      {others.length > 0 && (
        <ul className="space-y-1 type-small text-slate">
          {others.map((limit, index) => (
            <li key={index}>
              <LimitText limit={limit} cited={cited} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// A turn keeps every figure its limits name.
function LimitText({ limit, cited }: { limit: Exclude<Limit, Gap>; cited: Citations }) {
  switch (limit.kind) {
    case "notUnderstood": {
      const figure = cited.figures.get(limit.figureId);
      return (
        figure && (
          <>
            <FigureLink figure={figure} /> is not yet understood, so totals that include it may
            change once you answer its questions.
          </>
        )
      );
    }
    case "modelShare": {
      const figure = cited.figures.get(limit.figureId);
      return (
        figure?.modelAmount && (
          <>
            <Amount value={figure.modelAmount} /> of <FigureLink figure={figure} /> is
            model-assigned.
          </>
        )
      );
    }
    case "partialList":
      return (
        <>
          The analyst read only the first {limit.shown} rows of a longer list.{" "}
          <Link {...recordLink(limit.records)} className="underline underline-offset-4">
            Open the whole list
          </Link>
        </>
      );
    case "recalculating":
      return `Ironcage is recalculating ${limit.outdated} ${limit.outdated === 1 ? "transaction" : "transactions"}, so these figures may change.`;
    case "notBuilt":
      return unbuilt[limit.capability];
  }
}
