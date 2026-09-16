import {
  CalendarDate,
  type AnalysisQuery,
  GroupBy,
  Measure,
  type Period,
  type ReferenceData,
} from "@repo/contracts/finance";
import { Schema, Struct } from "effect";

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { measureLabels, groupLabels } from "./labels";
import { Choice } from "./selection";
export function TrendsFilters({
  query,
  groupBy,
  references,
  onChange,
  previousPeriod,
}: {
  previousPeriod: Period;
  query: AnalysisQuery;
  groupBy: GroupBy;
  references: typeof ReferenceData.Type;
  onChange: (query: AnalysisQuery, groupBy: GroupBy) => Promise<void>;
}) {
  const apply = (next: AnalysisQuery, group = groupBy) => {
    onChange(next, group).catch(reportError);
  };
  return (
    <section aria-label="Comparison controls" className="space-y-5 rounded-lg border p-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Choice
          label="Measure"
          value={query.measure}
          options={Struct.keys(measureLabels).map((value) => ({
            value,
            label: measureLabels[value],
          }))}
          onChange={(value) => {
            const measure = Schema.decodeOption(Measure)(value);
            if (measure._tag === "Some") {
              const movement =
                measure.value === "cashBalanceChange" || measure.value === "netPrincipalReduction";
              apply(
                {
                  ...query,
                  measure: measure.value,
                  normalization: "total",
                  basis: movement ? "posted" : query.basis,
                  filters: movement
                    ? { categories: [], merchants: [], tags: [], personalEvents: [] }
                    : query.filters,
                },
                movement ? "account" : groupBy,
              );
            }
          }}
        />
        <Choice
          label="Compare with"
          value={query.comparison.kind}
          options={[
            { value: "previous", label: "Previous period" },
            { value: "previousYear", label: "Previous year" },
            { value: "fixed", label: "Fixed period" },
          ]}
          onChange={(kind) =>
            apply({
              ...query,
              comparison:
                kind === "fixed"
                  ? {
                      kind,
                      ...previousPeriod,
                    }
                  : { kind },
            })
          }
        />
        <Choice
          label="Group by"
          value={groupBy}
          options={Struct.keys(groupLabels)
            .filter(
              (key) =>
                !["cashBalanceChange", "netPrincipalReduction"].includes(query.measure) ||
                key === "account",
            )
            .map((value) => ({ value, label: groupLabels[value] }))}
          onChange={(value) => {
            const group = Schema.decodeOption(GroupBy)(value);
            if (group._tag === "Some") apply(query, group.value);
          }}
        />
        <Choice
          label="Normalization"
          value={query.normalization}
          options={[
            { value: "total", label: "Total" },
            ...(["grossCosts", "netPersonalCosts", "income", "surplus"].includes(query.measure)
              ? [{ value: "dailyAverage" as const, label: "Daily average" }]
              : []),
          ]}
          onChange={(normalization) => apply({ ...query, normalization })}
        />
      </div>
      {query.comparison.kind === "fixed" && (
        <div className="grid gap-3 sm:grid-cols-2">
          {(["start", "endExclusive"] as const).map((name) => (
            <Label key={name} className="flex-col items-start">
              {name === "start" ? "Comparison start" : "Comparison end, excluded"}
              <Input
                type="date"
                value={query.comparison.kind === "fixed" ? query.comparison[name] : ""}
                onChange={(event) => {
                  const date = Schema.decodeOption(CalendarDate)(event.target.value);
                  if (date._tag === "Some" && query.comparison.kind === "fixed") {
                    const comparison = { ...query.comparison, [name]: date.value };
                    if (comparison.start < comparison.endExclusive) apply({ ...query, comparison });
                  }
                }}
              />
            </Label>
          ))}
        </div>
      )}
      {!["cashBalanceChange", "netPrincipalReduction"].includes(query.measure) && (
        <details>
          <summary className="cursor-pointer text-sm font-medium">
            Filter categories, merchants, tags, and personal events
          </summary>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Dimension
              label="Categories, including descendants"
              options={references.categories}
              selected={query.filters.categories}
              onChange={(categories) =>
                apply({ ...query, filters: { ...query.filters, categories } })
              }
            />
            <Dimension
              label="Merchants"
              options={references.merchants}
              selected={query.filters.merchants}
              onChange={(merchants) =>
                apply({ ...query, filters: { ...query.filters, merchants } })
              }
            />
            <Dimension
              label="Tags"
              options={references.tags}
              selected={query.filters.tags}
              onChange={(tags) => apply({ ...query, filters: { ...query.filters, tags } })}
            />
            <Dimension
              label="Personal events"
              options={references.personalEvents}
              selected={query.filters.personalEvents}
              onChange={(personalEvents) =>
                apply({ ...query, filters: { ...query.filters, personalEvents } })
              }
            />
          </div>
        </details>
      )}
    </section>
  );
}
function Dimension<T extends string>({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: readonly { id: T; name: string }[];
  selected: readonly T[];
  onChange: (ids: T[]) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium">{label}</legend>
      <div className="max-h-48 space-y-2 overflow-auto">
        {options.length ? (
          options.map((option) => (
            <Label key={option.id}>
              <Checkbox
                aria-label={option.name}
                checked={selected.includes(option.id)}
                onCheckedChange={(checked) =>
                  onChange(
                    checked ? [...selected, option.id] : selected.filter((id) => id !== option.id),
                  )
                }
              />
              {option.name}
            </Label>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">None defined</p>
        )}
      </div>
    </fieldset>
  );
}
