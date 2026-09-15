import { type MatchMethod, PostingId } from "@repo/contracts/finance";
import { formatMoney } from "@repo/finance";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { InterpretationPanel } from "@/features/events/panel";
import { locatorLabel, sourceHref } from "@/lib/sources";

import { postingQueryOptions } from "./queries";

const matchLabels: Record<MatchMethod, string> = {
  new: "First recorded from this source",
  sameRow: "Same source row as an earlier import",
  bankId: "Matched by bank transaction ID",
  group: "Matched by date and amount",
  corroborated: "Matched by description or balance",
  user: "Matched by your review decision",
};

export function TransactionDetail({ id }: { id: typeof PostingId.Type }) {
  const {
    data: { posting, evidence },
  } = useSuspenseQuery(postingQueryOptions({ postingId: id }));
  return (
    <div className="max-w-4xl space-y-8">
      <Link to="/transactions" className="text-sm text-primary">
        ← Transactions
      </Link>
      <header>
        <p className="text-sm text-muted-foreground">
          {posting.accountLabel} · {posting.postedOn}
        </p>
        <h1 className="mt-3 text-2xl font-semibold">{posting.description}</h1>
        <p className="mt-5 font-mono text-3xl tabular-nums">{formatMoney(posting.amount)}</p>
        {posting.valueOn && (
          <p className="mt-3 text-sm text-muted-foreground">Value date {posting.valueOn}</p>
        )}
        {posting.originalMoney && (
          <p className="mt-2 text-sm text-muted-foreground">
            Original amount {formatMoney(posting.originalMoney)}
          </p>
        )}
      </header>
      <InterpretationPanel postingId={id} />
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Source evidence</h2>
        {evidence.map((item) => (
          <article key={item.id} className="space-y-4 rounded-lg border p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-medium break-all">{item.fileName}</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {locatorLabel(item.locator)}
                  {item.matchMethod && ` · ${matchLabels[item.matchMethod]}`}
                </p>
              </div>
              {item.bytesAvailable ? (
                <a
                  href={sourceHref(item.sourceFileId, item.locator)}
                  className="text-sm text-primary underline underline-offset-4"
                >
                  {item.locator.kind === "pdfRow" ? "Open statement page" : "Download original"}
                </a>
              ) : (
                <div className="text-sm text-muted-foreground">
                  Original bytes removed.{" "}
                  <Link to="/imports" className="text-primary underline">
                    Reupload
                  </Link>
                </div>
              )}
            </div>
            <dl className="space-y-3 text-sm">
              {Object.entries(item.raw)
                .filter(([key]) => key !== "positions")
                .map(([key, value]) => (
                  <div key={key} className="grid gap-1 sm:grid-cols-[120px_1fr]">
                    <dt className="text-muted-foreground">{key}</dt>
                    <dd className="break-words whitespace-pre-wrap">{value || "Empty"}</dd>
                  </div>
                ))}
            </dl>
          </article>
        ))}
      </section>
    </div>
  );
}
