import type { Money, PeriodFlow } from "@repo/contracts/finance";
import { formatCurrency } from "@repo/finance";
import { Link } from "@tanstack/react-router";
import { useLayoutEffect, useRef, useState } from "react";
import { Rectangle, ResponsiveContainer, Sankey, Tooltip } from "recharts";

import { Amount } from "@/components/amount";
import { Button } from "@/components/ui/button";

import { type FlowEntry, flowStreams } from "./flow-streams";

// Labels sit this far outside their nodes, in margins as wide as the widest label.
const labelGap = 12;
const list = new Intl.ListFormat("en-AU", { type: "conjunction" });
const whole = (amount: Money) => formatCurrency(amount, { cents: false });

export function FlowDiagram({ flow }: { flow: PeriodFlow }) {
  const [asTable, setAsTable] = useState(false);
  const { inflows, outflows } = flowStreams(flow);
  if (inflows.length === 0 && outflows.length === 0)
    return (
      <p className="text-slate">
        No money moved in this period, or its records have not been imported.
      </p>
    );
  const sources = inflows.filter((entry) => entry.kind === "stream").length;
  const destinations = outflows.filter((entry) => entry.kind === "stream").length;
  // What went out is net of money back, which the diagram draws coming in.
  const back = inflows.flatMap((entry) =>
    entry.kind === "moneyBack" ? [`${whole(entry.amount)} in ${entry.category}`] : [],
  );
  const summary = `${whole(flow.totals.inflow)} came in from ${sources} ${sources === 1 ? "source" : "sources"}, and ${whole(flow.totals.outflow)} went out to ${destinations} ${destinations === 1 ? "destination" : "destinations"}${back.length > 0 ? ` after ${list.format(back)} came back` : ""}.`;
  return (
    <figure className="space-y-3">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-3">
        <span className="type-small text-slate">{summary}</span>
        <Button
          variant="link"
          size="xs"
          className="px-0"
          onClick={() => setAsTable((value) => !value)}
        >
          {asTable ? "Show the flow" : "Show as a table"}
        </Button>
      </figcaption>
      {asTable ? (
        <FlowTable inflows={inflows} outflows={outflows} />
      ) : (
        <>
          <FlowSankey inflows={inflows} outflows={outflows} />
          <FlowBars inflows={inflows} outflows={outflows} />
        </>
      )}
    </figure>
  );
}

// What a stream's link says to someone who cannot see the diagram.
const spoken = (entry: FlowEntry) =>
  `${entry.label}, ${whole(entry.amount)} ${entry.side === "in" ? "came in" : "went out"}`;

// Recharts' `activeIndex` names the hovered node or band by its position.
const hovered = /^(node|link)-(\d+)$/;

function FlowSankey({
  inflows,
  outflows,
}: {
  inflows: readonly FlowEntry[];
  outflows: readonly FlowEntry[];
}) {
  // Sources, the middle, then destinations. Bands follow the same order.
  const nodes = [...inflows, null, ...outflows];
  const bands = [...inflows, ...outflows];
  const center = inflows.length;
  const [ruler, room] = useLabelRoom(bands);
  // Recharts lays out plain numbers; amounts stay exact in the entries for every label.
  const value = (amount: Money) => Number(amount.minor);
  const at = (activeIndex: string | null | undefined) => {
    const [, kind, index] = hovered.exec(activeIndex ?? "") ?? [];
    return (kind === "node" ? nodes : bands)[Number(index)];
  };
  return (
    <>
      <div className="hidden animate-[flow-reveal_600ms_ease-out] md:block">
        {/* A fixed height keeps Recharts from warning about an empty chart while phones hide it. */}
        <ResponsiveContainer height={Math.max(280, Math.max(inflows.length, outflows.length) * 34)}>
          <Sankey
            data={{
              nodes: nodes.map((entry) => ({ name: entry?.label ?? "" })),
              links: [
                ...inflows.map((entry, index) => ({
                  source: index,
                  target: center,
                  value: value(entry.amount),
                })),
                ...outflows.map((entry, index) => ({
                  source: center,
                  target: center + 1 + index,
                  value: value(entry.amount),
                })),
              ],
            }}
            accessibilityLayer={false}
            sort={false}
            iterations={0}
            nodeWidth={6}
            nodePadding={14}
            linkCurvature={0.55}
            margin={{ top: 8, bottom: 8, left: room.in, right: room.out }}
            node={(props) => {
              const entry = nodes[props.index];
              return entry ? (
                <FlowNode {...props} entry={entry} room={room[entry.side]} />
              ) : (
                <Rectangle
                  x={props.x}
                  y={props.y}
                  width={props.width}
                  height={props.height}
                  fill="var(--intaglio)"
                  radius={2}
                />
              );
            }}
            link={(props) => {
              const entry = bands[props.index];
              const band = (
                <path
                  d={`M${props.sourceX},${props.sourceY} C${props.sourceControlX},${props.sourceY} ${props.targetControlX},${props.targetY} ${props.targetX},${props.targetY}`}
                  fill="none"
                  stroke={entry?.color}
                  strokeOpacity={0.32}
                  strokeWidth={Math.max(1, props.linkWidth)}
                  className="transition-[stroke-opacity] hover:[stroke-opacity:0.55]"
                />
              );
              // The node's link carries the stream for keyboard and screen reader; the band
              // repeats it for the pointer. A click must not focus the hidden band.
              return entry && entry.kind !== "balance" ? (
                <Link
                  {...entry.link}
                  tabIndex={-1}
                  aria-hidden
                  onMouseDown={(event) => event.preventDefault()}
                >
                  {band}
                </Link>
              ) : (
                band
              );
            }}
          >
            <Tooltip
              content={({ active, activeIndex }) => {
                const entry = active ? at(activeIndex) : null;
                return entry ? <FlowTooltip entry={entry} /> : null;
              }}
            />
          </Sankey>
        </ResponsiveContainer>
      </div>
      <svg ref={ruler} aria-hidden className="invisible absolute size-0">
        {bands.map((entry) => (
          <FlowLabel key={entry.key} entry={entry} x={0} y={0} />
        ))}
      </svg>
    </>
  );
}

// The room each side's labels need: the widest label as drawn, its gap from the node, and
// space for the focus ring. The ruler draws every label unseen and outside the
// diagram, so phones that hide the diagram still measure it, and it measures again once
// web fonts load.
function useLabelRoom(entries: readonly FlowEntry[]) {
  const ruler = useRef<SVGSVGElement>(null);
  const [widths, setWidths] = useState({ in: 0, out: 0 });
  const labels = entries
    .map((entry) => `${entry.side} ${entry.label} ${whole(entry.amount)}`)
    .join("\n");
  useLayoutEffect(() => {
    const measure = () => {
      const widest = (side: FlowEntry["side"]) =>
        Math.max(
          0,
          ...Array.from(
            ruler.current?.querySelectorAll<SVGTextElement>(`text[data-side="${side}"]`) ?? [],
            (text) => Math.ceil(text.getBBox().width),
          ),
        );
      const next = { in: widest("in"), out: widest("out") };
      setWidths((current) => (current.in === next.in && current.out === next.out ? current : next));
    };
    measure();
    document.fonts.ready.then(measure).catch(reportError);
  }, [labels]);
  return [ruler, { in: widths.in + labelGap + 8, out: widths.out + labelGap + 8 }] as const;
}

function FlowLabel({ entry, x, y }: { entry: FlowEntry; x: number; y: number }) {
  return (
    <text
      x={x}
      y={y}
      textAnchor={entry.side === "in" ? "end" : "start"}
      dominantBaseline="middle"
      data-side={entry.side}
    >
      <tspan className="fill-intaglio text-[0.875rem]">{entry.label}</tspan>
      <tspan dx={8} className="fill-slate text-[0.8125rem] [font-variant-numeric:tabular-nums]">
        {whole(entry.amount)}
      </tspan>
    </text>
  );
}

function FlowNode({
  x,
  y,
  width,
  height,
  entry,
  room,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  entry: FlowEntry;
  // The margin beside the node that holds its label.
  room: number;
}) {
  const left = entry.side === "in";
  const middle = y + height / 2;
  const drawn = (
    <>
      <Rectangle x={x} y={y} width={width} height={height} fill={entry.color} radius={2} />
      <FlowLabel entry={entry} x={left ? x - labelGap : x + width + labelGap} y={middle} />
    </>
  );
  if (entry.kind === "balance") return drawn;
  // The whole row, label included, opens the stream, and draws the focus ring.
  const reach = Math.max(height, 20) / 2 + 3;
  return (
    <Link {...entry.link} aria-label={spoken(entry)} className="group outline-hidden">
      <rect
        x={left ? x - room + 4 : x - 4}
        y={middle - reach}
        width={room + width}
        height={reach * 2}
        rx={4}
        fill="transparent"
        className="stroke-transparent stroke-2 group-focus-visible:stroke-intaglio"
      />
      {drawn}
    </Link>
  );
}

function FlowTooltip({ entry }: { entry: FlowEntry }) {
  return (
    <div className="rounded-md border border-rule bg-sheet px-3 py-2 shadow-[0_12px_32px_rgba(22,50,58,0.14)]">
      <p className="type-small text-slate">{entry.side === "in" ? "Came in" : "Went out"}</p>
      <p>
        {entry.label}: <Amount value={entry.amount} cents={false} className="font-[560]" />
      </p>
      {entry.kind === "balance" && <p className="type-small text-slate">{entry.explanation}</p>}
    </div>
  );
}

function FlowBars({
  inflows,
  outflows,
}: {
  inflows: readonly FlowEntry[];
  outflows: readonly FlowEntry[];
}) {
  return (
    <div className="md:hidden">
      {[
        { title: "In", entries: inflows },
        { title: "Out", entries: outflows },
      ].map(({ title, entries }) => {
        const total = entries.reduce((sum, entry) => sum + entry.amount.minor, 0n) || 1n;
        return (
          <div key={title} className="mb-6 space-y-2">
            <p className="type-small text-slate">{title}</p>
            <div aria-hidden className="flex h-3 gap-[2px] overflow-hidden rounded-[3px]">
              {entries.map((entry) => (
                <span
                  key={entry.key}
                  style={{
                    flexGrow: Number((entry.amount.minor * 1000n) / total),
                    background: entry.color,
                  }}
                />
              ))}
            </div>
            <ul className="grid">
              {entries.map((entry) => {
                const row = (
                  <>
                    <span className="flex items-center gap-2">
                      <span
                        aria-hidden
                        className="size-2 rounded-[2px]"
                        style={{ background: entry.color }}
                      />
                      {entry.label}
                    </span>
                    <Amount value={entry.amount} cents={false} />
                  </>
                );
                return (
                  <li key={entry.key}>
                    {entry.kind === "balance" ? (
                      <>
                        <span className="flex items-center justify-between gap-3 py-1">{row}</span>
                        <span className="block type-small text-slate">{entry.explanation}</span>
                      </>
                    ) : (
                      <Link
                        {...entry.link}
                        aria-label={spoken(entry)}
                        className="flex items-center justify-between gap-3 rounded-sm py-1 hover:text-intaglio"
                      >
                        {row}
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function FlowTable({
  inflows,
  outflows,
}: {
  inflows: readonly FlowEntry[];
  outflows: readonly FlowEntry[];
}) {
  return (
    <table className="w-full max-w-xl">
      <caption className="sr-only">Money in and out</caption>
      <thead>
        <tr className="border-b border-rule text-left type-small text-slate">
          <th scope="col" className="py-2 font-normal">
            Stream
          </th>
          <th scope="col" className="py-2 text-right font-normal">
            Amount
          </th>
        </tr>
      </thead>
      {[
        { title: "Came in", entries: inflows },
        { title: "Went out", entries: outflows },
      ].map(({ title, entries }) => (
        <tbody key={title}>
          <tr>
            <th
              scope="rowgroup"
              colSpan={2}
              className="pt-5 pb-1 text-left type-small font-normal text-slate"
            >
              {title}
            </th>
          </tr>
          {entries.map((entry) => (
            <tr key={entry.key} className="border-b border-rule">
              <th scope="row" className="py-2 text-left font-normal">
                {entry.kind === "balance" ? (
                  <>
                    {entry.label}
                    <span className="block type-small text-slate">{entry.explanation}</span>
                  </>
                ) : (
                  <Link
                    {...entry.link}
                    aria-label={spoken(entry)}
                    className="rounded-sm hover:text-intaglio hover:underline"
                  >
                    {entry.label}
                  </Link>
                )}
              </th>
              <td className="py-2 text-right">
                <Amount value={entry.amount} cents={false} />
              </td>
            </tr>
          ))}
        </tbody>
      ))}
    </table>
  );
}
