import type { FlowStream, Money, PeriodFlow } from "@repo/contracts/finance";
import { formatCurrency } from "@repo/finance";
import { useState } from "react";
import { Layer, Rectangle, ResponsiveContainer, Sankey, Tooltip } from "recharts";

import { Amount } from "@/components/amount";
import { Button } from "@/components/ui/button";
import { categoryColor, categoryRank } from "@/lib/category-colors";

type Node = { name: string; amount: Money; side: "in" | "out" | "center"; color: string };

const nonNegative = (money: Money): Money => (money.minor < 0n ? { ...money, minor: 0n } : money);

function outflowColor(stream: FlowStream) {
  switch (stream.kind) {
    case "category":
    case "uncategorized":
      return categoryColor(stream.slug);
    case "loanPrincipal":
      return "var(--intaglio)";
    default:
      return "var(--category-other)";
  }
}

// Inflows on the left, outflows on the right, balanced through the middle: money kept
// appears as an outflow, and money drawn from savings as an inflow.
export function flowStreams(flow: PeriodFlow) {
  const inflows = flow.inflows
    .filter((stream) => stream.amount.minor > 0n)
    .map((stream) => ({ stream, color: "var(--eucalypt)" }));
  const outflows = flow.outflows
    .filter((stream) => stream.amount.minor > 0n)
    .toSorted((a, b) => {
      const order = (stream: FlowStream) =>
        stream.kind === "category"
          ? categoryRank(stream.slug)
          : ["uncategorized", "loanPrincipal", "externalOut", "unresolvedOut"].indexOf(
              stream.kind,
            ) + 20;
      return order(a) - order(b);
    })
    .map((stream) => ({ stream, color: outflowColor(stream) }));
  const inTotal = inflows.reduce((sum, row) => sum + row.stream.amount.minor, 0n);
  const outTotal = outflows.reduce((sum, row) => sum + row.stream.amount.minor, 0n);
  const money = (minor: bigint) => ({ currency: flow.currency, minor });
  return {
    inflows: [
      ...inflows.map((row) => ({
        label: row.stream.label,
        amount: row.stream.amount,
        color: row.color,
      })),
      ...(outTotal > inTotal
        ? [{ label: "From savings", amount: money(outTotal - inTotal), color: "var(--rule)" }]
        : []),
    ],
    outflows: [
      ...outflows.map((row) => ({
        label: row.stream.label,
        amount: row.stream.amount,
        color: row.color,
      })),
      ...(inTotal > outTotal
        ? [{ label: "Kept", amount: money(inTotal - outTotal), color: "var(--rule)" }]
        : []),
    ],
  };
}

export function FlowDiagram({ flow }: { flow: PeriodFlow }) {
  const [asTable, setAsTable] = useState(false);
  const { inflows, outflows } = flowStreams(flow);
  if (inflows.length === 0 && outflows.length === 0)
    return (
      <p className="text-slate">
        No money moved in this period, or its records have not been imported.
      </p>
    );
  const nodes: Node[] = [
    ...inflows.map((row) => ({
      name: row.label,
      amount: row.amount,
      side: "in" as const,
      color: row.color,
    })),
    { name: "", amount: flow.totals.inflow, side: "center", color: "var(--intaglio)" },
    ...outflows.map((row) => ({
      name: row.label,
      amount: row.amount,
      side: "out" as const,
      color: row.color,
    })),
  ];
  const center = inflows.length;
  // Recharts lays out plain numbers; amounts stay exact in `nodes` for every label.
  const value = (amount: Money) => Number(nonNegative(amount).minor);
  const links = [
    ...inflows.map((row, index) => ({
      source: index,
      target: center,
      value: value(row.amount),
      color: row.color,
    })),
    ...outflows.map((row, index) => ({
      source: center,
      target: center + 1 + index,
      value: value(row.amount),
      color: row.color,
    })),
  ];
  const summary = `${formatCurrency(flow.totals.inflow, { cents: false })} came in from ${inflows.length} ${inflows.length === 1 ? "source" : "sources"}, and ${formatCurrency(flow.totals.outflow, { cents: false })} went out to ${outflows.length} ${outflows.length === 1 ? "destination" : "destinations"}.`;
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
          <div
            className="hidden animate-[flow-reveal_600ms_ease-out] md:block"
            style={{ height: Math.max(280, Math.max(inflows.length, outflows.length) * 34) }}
            aria-hidden
          >
            <ResponsiveContainer>
              <Sankey
                data={{ nodes, links }}
                sort={false}
                iterations={0}
                nodeWidth={6}
                nodePadding={14}
                linkCurvature={0.55}
                margin={{ top: 8, bottom: 8, left: 200, right: 200 }}
                node={(props) => <FlowNode {...props} nodes={nodes} />}
                link={(props) => (
                  <path
                    d={`M${props.sourceX},${props.sourceY} C${props.sourceControlX},${props.sourceY} ${props.targetControlX},${props.targetY} ${props.targetX},${props.targetY}`}
                    fill="none"
                    stroke={links[props.index]?.color}
                    strokeOpacity={0.32}
                    strokeWidth={Math.max(1, props.linkWidth)}
                    className="transition-[stroke-opacity] hover:[stroke-opacity:0.55]"
                  />
                )}
              >
                <Tooltip content={<FlowTooltip nodes={nodes} links={links} />} />
              </Sankey>
            </ResponsiveContainer>
          </div>
          <FlowBars inflows={inflows} outflows={outflows} className="md:hidden" />
          <FlowTable inflows={inflows} outflows={outflows} className="sr-only" />
        </>
      )}
    </figure>
  );
}

function FlowNode(props: {
  x: number;
  y: number;
  width: number;
  height: number;
  index: number;
  nodes: Node[];
}) {
  const node = props.nodes[props.index];
  if (!node) return <Layer />;
  const left = node.side === "in";
  const x = left ? props.x - 12 : props.x + props.width + 12;
  const middle = props.y + props.height / 2;
  return (
    <Layer>
      <Rectangle
        x={props.x}
        y={props.y}
        width={props.width}
        height={props.height}
        fill={node.color}
        radius={2}
      />
      {node.side !== "center" && (
        <text x={x} y={middle} textAnchor={left ? "end" : "start"} dominantBaseline="middle">
          <tspan className="fill-intaglio text-[0.875rem]">{node.name}</tspan>
          <tspan dx={8} className="fill-slate text-[0.8125rem] [font-variant-numeric:tabular-nums]">
            {formatCurrency(node.amount, { cents: false })}
          </tspan>
        </text>
      )}
    </Layer>
  );
}

function FlowTooltip({
  active,
  payload,
  nodes,
  links,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{
    payload?: { source?: { name?: string }; target?: { name?: string }; name?: string };
  }>;
  nodes: Node[];
  links: ReadonlyArray<{ source: number; target: number }>;
}) {
  const item = payload?.[0]?.payload;
  if (!active || !item) return null;
  const name = item.target?.name || item.source?.name || item.name;
  const node = nodes.find((row) => row.name === name && row.name !== "");
  if (!node || links.length === 0) return null;
  return (
    <div className="rounded-md border border-rule bg-sheet px-3 py-2 shadow-[0_12px_32px_rgba(22,50,58,0.14)]">
      <p className="type-small text-slate">{node.side === "in" ? "Came in" : "Went out"}</p>
      <p>
        {node.name}: <Amount value={node.amount} cents={false} className="font-[560]" />
      </p>
    </div>
  );
}

type Side = ReadonlyArray<{ label: string; amount: Money; color: string }>;

function FlowBars({
  inflows,
  outflows,
  className,
}: {
  inflows: Side;
  outflows: Side;
  className?: string;
}) {
  return (
    <div className={className}>
      {[
        { title: "In", rows: inflows },
        { title: "Out", rows: outflows },
      ].map(({ title, rows }) => {
        const total = rows.reduce((sum, row) => sum + row.amount.minor, 0n) || 1n;
        return (
          <div key={title} className="mb-6 space-y-2">
            <p className="type-small text-slate">{title}</p>
            <div className="flex h-3 gap-[2px] overflow-hidden rounded-[3px]">
              {rows.map((row) => (
                <span
                  key={row.label}
                  style={{
                    flexGrow: Number((row.amount.minor * 1000n) / total),
                    background: row.color,
                  }}
                />
              ))}
            </div>
            <ul className="grid gap-1">
              {rows.map((row) => (
                <li key={row.label} className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2">
                    <span className="size-2 rounded-[2px]" style={{ background: row.color }} />
                    {row.label}
                  </span>
                  <Amount value={row.amount} cents={false} />
                </li>
              ))}
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
  className,
}: {
  inflows: Side;
  outflows: Side;
  className?: string;
}) {
  return (
    <table className={className ?? "w-full max-w-xl"}>
      <caption className="sr-only">Money in and out</caption>
      <tbody>
        {[
          { title: "Came in", rows: inflows },
          { title: "Went out", rows: outflows },
        ].map(({ title, rows }) =>
          rows.map((row, index) => (
            <tr key={`${title}-${row.label}`} className="border-b border-rule">
              <th scope="row" className="py-2 text-left font-normal text-slate">
                {index === 0 ? title : ""}
              </th>
              <td className="py-2">{row.label}</td>
              <td className="py-2 text-right">
                <Amount value={row.amount} cents={false} />
              </td>
            </tr>
          )),
        )}
      </tbody>
    </table>
  );
}
