import {
  CalendarDate,
  CommandId,
  type CounterpartyDetail,
  type CounterpartyKind,
  type CounterpartyRole,
  type LedgerPage,
  type MergeCounterparties,
  type ReferenceData,
  type SaveCounterparty,
} from "@repo/contracts/finance";
import { formatCurrency, monthLabel } from "@repo/finance";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useId, useState } from "react";

import { Amount } from "@/components/amount";
import { CategorySelect } from "@/components/category-select";
import { ProvenanceMark } from "@/components/provenance";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LedgerList } from "@/features/ledger/list";
import { categoryColor } from "@/lib/category-colors";
import { useCommand } from "@/lib/use-command";

import { counterpartyKinds, counterpartyRoles } from "./choices";
import { mergeCounterparties, saveCounterparty } from "./functions";
import { ReferenceDefaults } from "./references";

export function CounterpartyPage({
  detail,
  references,
  recent,
}: {
  detail: typeof CounterpartyDetail.Type;
  references: typeof ReferenceData.Type;
  recent: typeof LedgerPage.Type;
}) {
  const { counterparty, aliases, months } = detail;
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
      </header>

      <History months={months} color={categoryColor(category?.slug ?? null)} />

      <Defaults detail={detail} references={references} />

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

      <section aria-labelledby="aliases-heading" className="space-y-3 border-t border-rule pt-8">
        <h2 id="aliases-heading" className="type-heading">
          How the bank writes it
        </h2>
        <ul className="space-y-2">
          {aliases.map((alias) => (
            <li
              key={alias.aliasKey}
              className="flex flex-wrap items-baseline justify-between gap-3"
            >
              <span className="min-w-0">
                <span className="block break-all">{alias.samples[0] ?? alias.aliasKey}</span>
                {alias.samples.length > 1 && (
                  <span className="block type-small break-all text-slate">
                    Also {alias.samples.slice(1).join(", ")}
                  </span>
                )}
              </span>
              <span className="type-small text-slate">
                {alias.eventCount} {alias.eventCount === 1 ? "transaction" : "transactions"}
              </span>
            </li>
          ))}
        </ul>
        <Merge detail={detail} references={references} />
      </section>
    </div>
  );
}

function History({
  months,
  color,
}: {
  months: (typeof CounterpartyDetail.Type)["months"];
  color: string;
}) {
  if (months.length === 0) return null;
  const largest = months.reduce(
    (max, row) =>
      row.outflow.minor + row.inflow.minor > max ? row.outflow.minor + row.inflow.minor : max,
    1n,
  );
  const total = months.reduce(
    (sum, row) => ({ out: sum.out + row.outflow.minor, in: sum.in + row.inflow.minor }),
    { out: 0n, in: 0n },
  );
  const currency = months[0]?.outflow.currency ?? "AUD";
  return (
    <section aria-labelledby="history-heading" className="space-y-3">
      <h2 id="history-heading" className="type-heading">
        Over time
      </h2>
      <p className="type-small text-slate">
        {total.out > 0n && (
          <>
            Paid <Amount value={{ currency, minor: total.out }} cents={false} /> in total.{" "}
          </>
        )}
        {total.in > 0n && (
          <>
            Received <Amount value={{ currency, minor: total.in }} cents={false} /> in total.
          </>
        )}
      </p>
      <ol className="relative flex gap-[3px] overflow-x-auto pb-1" aria-label="Amount by month">
        {months.map((row, index) => {
          const amount = row.outflow.minor + row.inflow.minor;
          const label = `${monthLabel(row.month)}: ${formatCurrency({ currency, minor: amount }, { cents: false })}`;
          return (
            <li key={row.month} className="flex w-3 shrink-0 flex-col gap-1" title={label}>
              <span className="flex h-24 items-end">
                <span
                  className="w-full rounded-t-[2px]"
                  style={{
                    height: `${Math.max(3, Number((amount * 100n) / largest))}%`,
                    background: row.inflow.minor > row.outflow.minor ? "var(--eucalypt)" : color,
                  }}
                />
              </span>
              <span
                aria-hidden
                className="h-4 overflow-visible type-small whitespace-nowrap text-slate"
              >
                {row.month.endsWith("-01") || (index === 0 && row.month.slice(5) <= "09")
                  ? row.month.slice(0, 4)
                  : ""}
              </span>
              <span className="sr-only">{label}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function Defaults({
  detail,
  references,
}: {
  detail: typeof CounterpartyDetail.Type;
  references: typeof ReferenceData.Type;
}) {
  const { counterparty } = detail;
  const id = useId();
  const client = useQueryClient();
  const [name, setName] = useState(counterparty.name);
  const [kind, setKind] = useState<CounterpartyKind>(counterparty.kind);
  const [categoryId, setCategoryId] = useState(counterparty.defaultCategoryId);
  const [role, setRole] = useState<typeof CounterpartyRole.Type | "">(
    counterparty.defaultRole ?? "",
  );
  const save = useCommand({
    mutationFn: (data: typeof SaveCounterparty.Type) => saveCounterparty({ data }),
    onSuccess: () => client.invalidateQueries(),
  });
  const confirmed = counterparty.source === "user";
  return (
    <section aria-labelledby="defaults-heading" className="space-y-4 border-t border-rule pt-8">
      <div>
        <h2 id="defaults-heading" className="type-heading">
          What it is
        </h2>
        <p className="mt-1 type-small text-slate">
          Every transaction with {counterparty.name} follows this, except ones you changed by hand.
        </p>
      </div>
      <form
        className="grid max-w-xl gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          save.submit({
            commandId: CommandId.make(crypto.randomUUID()),
            target: { kind: "update", id: counterparty.id, expectedVersion: counterparty.version },
            fields: {
              name: name.trim() || counterparty.name,
              kind,
              brand: counterparty.brand,
              defaultCategoryId: categoryId,
              defaultRole: kind === "person" || kind === "institution" ? role || null : null,
            },
          });
        }}
      >
        <label className="grid gap-1.5" htmlFor={`${id}-name`}>
          <span className="type-small text-slate">Name</span>
          <Input id={`${id}-name`} value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="grid gap-1.5" htmlFor={`${id}-kind`}>
          <span className="type-small text-slate">Who they are</span>
          <select
            id={`${id}-kind`}
            value={kind}
            onChange={(event) => {
              const next = counterpartyKinds.find((item) => item.value === event.target.value);
              if (next) setKind(next.value);
            }}
            className="h-9 rounded-md border border-input bg-sheet px-2.5"
          >
            {counterpartyKinds.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        {(kind === "person" || kind === "institution") && (
          <label className="grid gap-1.5" htmlFor={`${id}-role`}>
            <span className="type-small text-slate">Money to or from them is</span>
            <select
              id={`${id}-role`}
              value={role}
              onChange={(event) => {
                const next = counterpartyRoles.find((item) => item.value === event.target.value);
                setRole(next?.value ?? "");
              }}
              className="h-9 rounded-md border border-input bg-sheet px-2.5"
            >
              <option value="">Decide from each payment</option>
              {counterpartyRoles.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {kind !== "ownAccount" && (
          <label className="grid gap-1.5" htmlFor={`${id}-category`}>
            <span className="type-small text-slate">Usual category</span>
            <CategorySelect
              id={`${id}-category`}
              categories={references.categories}
              tree={role === "income" ? "income" : "spending"}
              value={categoryId}
              onChange={setCategoryId}
            />
          </label>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={save.mutation.isPending}>
            {confirmed ? "Save" : "Confirm"}
          </Button>
          {save.mutation.isSuccess && (
            <output className="type-small text-slate">Saved. Totals updated.</output>
          )}
          {save.mutation.error && (
            <p role="alert" className="type-small text-attention">
              {save.mutation.error.message}
            </p>
          )}
        </div>
      </form>
    </section>
  );
}

function Merge({
  detail,
  references,
}: {
  detail: typeof CounterpartyDetail.Type;
  references: typeof ReferenceData.Type;
}) {
  const { counterparty } = detail;
  const id = useId();
  const navigate = useNavigate();
  const client = useQueryClient();
  const [search, setSearch] = useState("");
  const merge = useCommand({
    mutationFn: (data: typeof MergeCounterparties.Type) => mergeCounterparties({ data }),
    onSuccess: async (result) => {
      await client.invalidateQueries();
      await navigate({
        to: "/counterparties/$counterpartyId",
        params: { counterpartyId: result.id },
      });
    },
  });
  const matches = search.trim()
    ? references.counterparties
        .filter(
          (item) =>
            item.id !== counterparty.id &&
            item.name.toLowerCase().includes(search.trim().toLowerCase()),
        )
        .slice(0, 6)
    : [];
  return (
    <details className="rounded-lg border border-rule bg-sheet">
      <summary className="cursor-pointer list-none px-4 py-3 text-slate hover:text-intaglio">
        This is the same as another counterparty
      </summary>
      <div className="space-y-3 border-t border-rule p-4">
        <label className="grid max-w-sm gap-1.5" htmlFor={`${id}-merge`}>
          <span className="type-small text-slate">Find the counterparty to merge into</span>
          <Input
            id={`${id}-merge`}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <ul className="space-y-1">
          {matches.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-3">
              <span>{item.name}</span>
              <Button
                size="sm"
                variant="outline"
                disabled={merge.mutation.isPending}
                onClick={() =>
                  merge.submit({
                    commandId: CommandId.make(crypto.randomUUID()),
                    sourceId: counterparty.id,
                    sourceVersion: counterparty.version,
                    targetId: item.id,
                    targetVersion: item.version,
                  })
                }
              >
                Merge into {item.name}
              </Button>
            </li>
          ))}
        </ul>
        {merge.mutation.error && (
          <p role="alert" className="type-small text-attention">
            {merge.mutation.error.message}
          </p>
        )}
      </div>
    </details>
  );
}
