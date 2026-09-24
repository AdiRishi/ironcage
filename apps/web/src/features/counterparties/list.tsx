import type { CounterpartyList, ReferenceData } from "@repo/contracts/finance";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { Amount } from "@/components/amount";
import { ProvenanceMark } from "@/components/provenance";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { categoryColor } from "@/lib/category-colors";
import type { ResolvedPeriod } from "@/lib/period";

const kindLabels = {
  business: "Business",
  person: "Person",
  ownAccount: "Your account",
  institution: "Institution",
} as const;

export function CounterpartiesPage({
  counterparties,
  references,
  period,
  direction,
  search,
  onSearch,
  onDirection,
}: {
  counterparties: typeof CounterpartyList.Type;
  references: typeof ReferenceData.Type;
  period: ResolvedPeriod;
  direction: "out" | "in";
  search: string;
  onSearch: (search: string) => void;
  onDirection: (direction: "out" | "in") => void;
}) {
  const [text, setText] = useState(search);
  const amount = (row: (typeof counterparties)[number]) =>
    direction === "out" ? row.outflow : row.inflow;
  const rows = counterparties
    .filter((row) => amount(row).minor > 0n)
    .toSorted((left, right) => (amount(right).minor > amount(left).minor ? 1 : -1));
  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="type-title">Counterparties</h1>
          <p className="mt-1 type-small text-slate">
            Who you {direction === "out" ? "paid" : "received money from"} in {period.label}.
          </p>
        </div>
        <search className="w-full sm:w-auto">
          <form
            className="flex w-full gap-2 sm:w-auto"
            onSubmit={(event) => {
              event.preventDefault();
              onSearch(text.trim());
            }}
          >
            <Input
              aria-label="Search names and descriptors"
              placeholder="Search"
              value={text}
              onChange={(event) => setText(event.target.value)}
              className="sm:w-64"
            />
            <Button type="submit" variant="outline">
              Search
            </Button>
          </form>
        </search>
      </header>
      <fieldset className="flex gap-1">
        <legend className="sr-only">Direction</legend>
        {(["out", "in"] as const).map((value) => (
          <Button
            key={value}
            size="sm"
            variant={direction === value ? "default" : "ghost"}
            aria-pressed={direction === value}
            onClick={() => onDirection(value)}
          >
            {value === "out" ? "Money out" : "Money in"}
          </Button>
        ))}
      </fieldset>
      {rows.length === 0 ? (
        <p className="text-slate">
          {search
            ? `No counterparties match “${search}” in ${period.label}.`
            : `Nothing in ${period.label}.`}
        </p>
      ) : (
        <ul className="divide-y divide-rule border-y border-rule">
          {rows.map((row) => {
            const category = references.categories.find(
              (item) => item.id === row.defaultCategoryId,
            );
            return (
              <li key={row.id}>
                <Link
                  to="/counterparties/$counterpartyId"
                  params={{ counterpartyId: row.id }}
                  className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-0.5 px-1 py-3 hover:bg-sheet sm:grid-cols-[minmax(0,1fr)_14rem_6rem_8rem]"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-[520]">{row.name}</span>
                    <ProvenanceMark
                      assignedBy={row.source === "user" ? "you" : "model"}
                      question={
                        row.status === "proposed" || (row.kind === "person" && !row.defaultRole)
                      }
                    />
                  </span>
                  <span className="col-start-1 flex min-w-0 items-center gap-2 type-small text-slate sm:col-start-auto">
                    {category ? (
                      <>
                        <span
                          aria-hidden
                          className="size-2 shrink-0 rounded-[2px]"
                          style={{ background: categoryColor(category.slug) }}
                        />
                        <span className="truncate">{category.name}</span>
                      </>
                    ) : (
                      kindLabels[row.kind]
                    )}
                  </span>
                  <span className="hidden text-right type-small text-slate tabular sm:block">
                    {row.eventCount} {row.eventCount === 1 ? "time" : "times"}
                  </span>
                  <Amount
                    value={amount(row)}
                    cents={false}
                    className="row-span-2 row-start-1 text-right sm:row-span-1"
                  />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
