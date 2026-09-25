import type { MatchMethod, PostingId } from "@repo/contracts/finance";
import { formatCurrency } from "@repo/finance";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { Amount } from "@/components/amount";
import { locatorLabel, sourceHref } from "@/lib/sources";

import { Meaning } from "./meaning";
import { postingQueryOptions } from "./queries";

const matchLabels: Record<MatchMethod, string> = {
  new: "First recorded from this file",
  sameRow: "The same row as an earlier import",
  bankId: "Matched by the bank's transaction ID",
  group: "Matched by date and amount",
  corroborated: "Matched by description or balance",
  user: "Matched by your answer",
};
const dateFormat = new Intl.DateTimeFormat("en-AU", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});
const longDate = (date: string) => dateFormat.format(new Date(`${date}T00:00:00`));

export function LedgerDetail({ id }: { id: typeof PostingId.Type }) {
  const {
    data: { posting, evidence, descriptor },
  } = useSuspenseQuery(postingQueryOptions({ postingId: id }));
  const inflow = posting.amount.minor > 0n;
  return (
    <article className="max-w-3xl space-y-10">
      <header className="space-y-4">
        <Link to="/ledger" className="type-small text-slate hover:text-intaglio">
          Ledger
        </Link>
        <div>
          <p className={`type-figure ${inflow ? "text-inflow" : ""}`}>
            {inflow ? "+" : ""}
            {formatCurrency(posting.amount)}
          </p>
          <h1 className="mt-2 type-heading break-words">{posting.description}</h1>
          <p className="mt-1 type-small text-slate">
            {posting.accountLabel}, {longDate(posting.postedOn)}
          </p>
        </div>
      </header>

      <Meaning postingId={id} descriptor={descriptor} />

      <section aria-labelledby="bank-heading" className="space-y-4 border-t border-rule pt-8">
        <h2 id="bank-heading" className="type-heading">
          What the bank booked
        </h2>
        <dl className="grid grid-cols-[7.5rem_1fr] gap-x-4 gap-y-3">
          <dt className="text-slate">Account</dt>
          <dd>{posting.accountLabel}</dd>
          <dt className="text-slate">Posted</dt>
          <dd>{longDate(posting.postedOn)}</dd>
          {posting.valueOn && (
            <>
              <dt className="text-slate">Value date</dt>
              <dd>{longDate(posting.valueOn)}</dd>
            </>
          )}
          <dt className="text-slate">Amount</dt>
          <dd>
            <Amount value={posting.amount} signed />
          </dd>
          {posting.originalMoney && (
            <>
              <dt className="text-slate">Original</dt>
              <dd>
                <Amount value={posting.originalMoney} /> {posting.originalMoney.currency}
              </dd>
            </>
          )}
          <dt className="text-slate">Description</dt>
          <dd className="break-words">{posting.description}</dd>
        </dl>
      </section>

      <section aria-labelledby="sources-heading" className="space-y-4 border-t border-rule pt-8">
        <h2 id="sources-heading" className="type-heading">
          Where it came from
        </h2>
        <ul className="space-y-4">
          {evidence.map((item) => (
            <li key={item.id} className="space-y-3 rounded-lg border border-rule bg-sheet p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-[560] break-all">{item.fileName}</p>
                  <p className="type-small text-slate">
                    {locatorLabel(item.locator)}.{" "}
                    {item.matchMethod ? `${matchLabels[item.matchMethod]}.` : ""}
                  </p>
                </div>
                {item.bytesAvailable ? (
                  <a
                    href={sourceHref(item.sourceFileId, item.locator)}
                    className="type-small underline underline-offset-4"
                  >
                    {item.locator.kind === "pdfRow"
                      ? "Open the statement page"
                      : "Download the file"}
                  </a>
                ) : (
                  <span className="type-small text-slate">
                    Original removed.{" "}
                    <Link to="/sources" className="text-intaglio underline underline-offset-4">
                      Upload it again
                    </Link>
                  </span>
                )}
              </div>
              <dl className="grid gap-x-4 gap-y-1 type-small sm:grid-cols-[8rem_1fr]">
                {Object.entries(item.raw)
                  .filter(([key]) => key !== "positions")
                  .map(([key, value]) => (
                    <div key={key} className="contents">
                      <dt className="text-slate">{key}</dt>
                      <dd className="break-words whitespace-pre-wrap">{value || "Empty"}</dd>
                    </div>
                  ))}
              </dl>
            </li>
          ))}
        </ul>
      </section>
    </article>
  );
}
