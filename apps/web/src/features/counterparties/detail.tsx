import {
  CalendarDate,
  type CounterpartyDetail,
  type LedgerPage,
  type ReferenceData,
} from "@repo/contracts/finance";
import { Link } from "@tanstack/react-router";

import { ProvenanceMark } from "@/components/provenance";
import { AskAbout } from "@/features/analyst/ask-about";
import { LedgerList } from "@/features/ledger/list";
import { categoryColor } from "@/lib/category-colors";

import { Activity } from "./activity";
import { counterpartyKinds } from "./choices";
import { Defaults } from "./defaults";
import { Descriptors } from "./descriptors";
import { CounterpartyHistory } from "./history";
import { ReferenceDefaults } from "./references";

export function CounterpartyPage({
  detail,
  references,
  recent,
  timeZone,
}: {
  detail: typeof CounterpartyDetail.Type;
  references: typeof ReferenceData.Type;
  recent: typeof LedgerPage.Type;
  timeZone: string;
}) {
  const { counterparty, months } = detail;
  const [first] = months;
  const category = references.categories.find((item) => item.id === counterparty.defaultCategoryId);
  return (
    <div className="max-w-4xl space-y-10">
      <header className="space-y-3">
        <Link to="/counterparties" className="type-small text-slate hover:text-intaglio">
          Counterparties
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="type-title">{counterparty.name}</h1>
          <ProvenanceMark
            assignedBy={counterparty.source === "user" ? "you" : "model"}
            question={counterparty.status === "proposed"}
          />
        </div>
        <p className="type-small text-slate">
          {counterpartyKinds.find((kind) => kind.value === counterparty.kind)?.label}
          {counterparty.brand ? `, part of ${counterparty.brand}` : ""}.{" "}
          {category ? `Usually ${category.name}.` : "No default category."}
        </p>
        {counterparty.source === "model" && counterparty.reason && (
          <p className="type-small text-slate">
            The model: {counterparty.reason}
            {counterparty.confidence !== null &&
              ` ${Math.round(counterparty.confidence * 100)}% sure.`}
          </p>
        )}
        <AskAbout about={{ kind: "counterparty", counterpartyId: counterparty.id }} />
      </header>

      <Activity detail={detail} color={categoryColor(category?.slug ?? null)} />

      <Defaults counterparty={counterparty} references={references} />

      <ReferenceDefaults
        counterparty={counterparty}
        rows={detail.references}
        references={references}
      />

      <section aria-labelledby="recent-heading" className="space-y-4 border-t border-rule pt-8">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="recent-heading" className="type-heading">
            Recent transactions
          </h2>
          {first && (
            <Link
              to="/ledger"
              search={{
                counterpartyId: counterparty.id,
                from: CalendarDate.make(`${first.month}-01`),
              }}
              className="type-small underline underline-offset-4"
            >
              All {counterparty.eventCount} in the ledger
            </Link>
          )}
        </div>
        <LedgerList rows={recent.rows.slice(0, 12)} />
      </section>

      <Descriptors detail={detail} references={references} />

      <CounterpartyHistory
        counterparty={counterparty}
        references={references}
        timeZone={timeZone}
      />
    </div>
  );
}
