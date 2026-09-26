import type { AccountCoverage, Import, PeriodFlow } from "@repo/contracts/finance";
import { ChevronRight } from "lucide-react";
import { useId } from "react";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ExportsSection } from "@/features/exports/section";
import { NetBankGuide } from "@/features/imports/netbank-guide";
import { PendingImports } from "@/features/imports/pending-imports";
import { UploadFiles } from "@/features/imports/upload-files";

import { SourceFilesSection } from "./section";

const days = (start: string, end: string) => (Date.parse(end) - Date.parse(start)) / 86_400_000;

export function SourcesPage({
  coverage,
  imports,
  timezone,
}: {
  coverage: PeriodFlow["coverage"];
  imports: readonly Import[];
  timezone: string;
}) {
  return (
    <div className="max-w-4xl space-y-12">
      <header className="space-y-2">
        <h1 className="type-title">Sources</h1>
        <p className="text-slate">
          Every number comes from these files. Each transaction keeps the rows it came from.
        </p>
      </header>

      <UploadFiles />

      <DownloadGuide />

      <PendingImports imports={imports} timezone={timezone} heading="Imports that need you" />

      <Timeline coverage={coverage} />

      <SourceFilesSection />

      <ExportsSection timezone={timezone} />
    </div>
  );
}

function DownloadGuide() {
  const id = useId();
  return (
    <Collapsible render={<section aria-labelledby={id} />} className="space-y-6">
      <h2 id={id} className="type-heading">
        <CollapsibleTrigger className="group flex items-center gap-2 rounded-sm text-left hover:text-intaglio">
          <ChevronRight
            aria-hidden
            className="size-4 shrink-0 text-slate transition-transform group-data-panel-open:rotate-90"
          />
          Which files to download from NetBank
        </CollapsibleTrigger>
      </h2>
      <CollapsibleContent className="pl-6">
        <NetBankGuide heading="h3" />
      </CollapsibleContent>
    </Collapsible>
  );
}

// Each account across its whole history: dark where statement balances reconcile,
// light where there are records without a balance check, a gap where nothing arrived.
function Timeline({ coverage }: { coverage: readonly AccountCoverage[] }) {
  const starts = coverage.flatMap((item) => item.observed.map((interval) => interval.start));
  const ends = coverage.flatMap((item) => item.observed.map((interval) => interval.endExclusive));
  if (starts.length === 0) return null;
  const start = `${starts.toSorted()[0]?.slice(0, 4)}-01-01`;
  const end = `${Number(ends.toSorted().at(-1)?.slice(0, 4)) + 1}-01-01`;
  const total = days(start, end);
  const place = (interval: { start: string; endExclusive: string }) => ({
    left: `${(days(start, interval.start) / total) * 100}%`,
    width: `${(days(interval.start, interval.endExclusive) / total) * 100}%`,
  });
  const years = Array.from(
    { length: Number(end.slice(0, 4)) - Number(start.slice(0, 4)) },
    (_, index) => Number(start.slice(0, 4)) + index,
  );
  return (
    <section aria-labelledby="timeline-heading" className="space-y-4">
      <div>
        <h2 id="timeline-heading" className="type-heading">
          What the records cover
        </h2>
        <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 type-small text-slate">
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="h-2 w-4 rounded-[2px] bg-intaglio" /> Balances reconcile
          </span>
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="h-2 w-4 rounded-[2px] bg-intaglio/30" /> Records without a
            balance check
          </span>
          <span className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="h-2 w-4 rounded-[2px] border border-dashed border-attention"
            />{" "}
            Missing
          </span>
        </p>
      </div>
      <ul className="space-y-4">
        {coverage.map((item) => (
          <li
            key={item.account.id}
            className="grid gap-1.5 sm:grid-cols-[11rem_1fr] sm:items-center sm:gap-4"
          >
            <span className="truncate">{item.account.label}</span>
            <span className="relative block h-3 rounded-[3px] bg-rule/40">
              {item.observed.map((interval) => (
                <span
                  key={`o${interval.start}`}
                  className="absolute inset-y-0 rounded-[2px] bg-intaglio/30"
                  style={place(interval)}
                />
              ))}
              {item.reconciled.map((interval) => (
                <span
                  key={`r${interval.start}`}
                  className="absolute inset-y-0 rounded-[2px] bg-intaglio"
                  style={place(interval)}
                />
              ))}
              {item.missing.map((interval) => (
                <span
                  key={`m${interval.start}`}
                  className="absolute inset-y-0 rounded-[2px] border border-dashed border-attention"
                  style={place(interval)}
                  title={`Missing ${interval.start} to ${interval.endExclusive}`}
                />
              ))}
            </span>
            <span className="sr-only">
              {item.missing.length === 0
                ? "No gaps."
                : `Missing ${item.missing.map((interval) => `${interval.start} to ${interval.endExclusive}`).join(", ")}.`}
            </span>
          </li>
        ))}
      </ul>
      <div aria-hidden className="relative ml-0 h-4 type-small text-slate sm:ml-[12rem]">
        {years.map((year) => (
          <span
            key={year}
            className="absolute -translate-x-1/2 tabular"
            style={{ left: `${(days(start, `${year}-07-01`) / total) * 100}%` }}
          >
            {years.length > 8 ? `’${String(year).slice(2)}` : year}
          </span>
        ))}
      </div>
    </section>
  );
}
