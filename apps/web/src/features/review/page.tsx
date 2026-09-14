import {
  AccountId,
  type ObservationDecision,
  type ReviewItem,
  type ReviewObservation,
} from "@repo/contracts/finance";
import { formatMoney } from "@repo/finance";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CreateAccountDialog } from "@/features/accounts/create-account";
import { accountsQueryOptions } from "@/features/accounts/queries";

import { CorrectValues } from "./correct-values";
import { OmitRow } from "./omit-row";
import { reviewQueryOptions } from "./queries";
import { useResolution } from "./use-resolution";

export function ReviewPage({ importId }: { importId?: string | undefined }) {
  const { data } = useSuspenseQuery(reviewQueryOptions());
  const reviews = importId ? data.filter((review) => review.importId === importId) : data;
  const heading = useRef<HTMLHeadingElement>(null);
  const previousCount = useRef(reviews.length);
  useEffect(() => {
    if (reviews.length < previousCount.current) heading.current?.focus();
    previousCount.current = reviews.length;
  }, [reviews.length]);
  return (
    <div className="space-y-8">
      <header>
        <h1 ref={heading} tabIndex={-1} className="text-3xl font-semibold tracking-tight">
          Source review
        </h1>
        <p className="mt-2 text-muted-foreground">
          Check the source evidence and choose what should be recorded.
        </p>
      </header>
      {importId && (
        <Link to="/review" className="text-primary underline">
          Show all reviews
        </Link>
      )}
      {reviews.length === 0 ? (
        <div className="rounded-lg border p-10">
          <h2 className="font-semibold">Nothing to review</h2>
          <p className="mt-2 text-muted-foreground">
            All imported source rows have been accounted for.
          </p>
          <Link to="/transactions" className="mt-4 inline-block text-primary underline">
            View transactions
          </Link>
        </div>
      ) : (
        reviews.map((review) => <ReviewCard key={review.id} review={review} />)
      )}
    </div>
  );
}
function ReviewCard({ review }: { review: ReviewItem }) {
  const { mutation, submit } = useResolution(review);
  const blocked = mutation.isPending || mutation.isError;
  return (
    <section className="space-y-5 rounded-lg border p-5 sm:p-6">
      <header>
        <p className="text-sm break-all text-muted-foreground">{review.fileName}</p>
        <h2 className="mt-2 text-lg font-semibold">{review.question.message}</h2>
      </header>
      {review.kind === "account" ? (
        <AccountChoice
          disabled={blocked}
          onChoose={(accountId) => submit({ kind: "account", accountId })}
        />
      ) : (
        review.observations.map((row) => (
          <RowChoice
            key={row.id}
            row={row}
            review={review}
            disabled={blocked}
            onChoose={(decision) =>
              submit({ kind: "observations", decisions: [{ observationId: row.id, decision }] })
            }
          />
        ))
      )}
      {mutation.isPending && <output className="text-sm">Saving your decision…</output>}
      {mutation.isError && (
        <div role="alert" className="space-y-3 text-sm">
          <p className="text-destructive">{mutation.error.message}</p>
          <Button variant="outline" onClick={() => mutation.mutate(mutation.variables)}>
            Retry this decision
          </Button>
          <Button variant="ghost" onClick={() => window.location.reload()}>
            Refresh review
          </Button>
        </div>
      )}
    </section>
  );
}
function AccountChoice({
  disabled,
  onChoose,
}: {
  disabled: boolean;
  onChoose: (id: typeof AccountId.Type) => void;
}) {
  const { data: accounts } = useSuspenseQuery(accountsQueryOptions());
  const id = useId();
  const [accountId, setAccountId] = useState<typeof AccountId.Type | null>(null);
  return (
    <div className="space-y-4">
      <Label htmlFor={id}>Account for this file</Label>
      <Select value={accountId} onValueChange={setAccountId} disabled={disabled}>
        <SelectTrigger id={id}>
          <SelectValue placeholder="Choose an account" />
        </SelectTrigger>
        <SelectContent>
          {accounts.map((account) => (
            <SelectItem key={account.id} value={account.id}>
              {account.label} · {account.currency}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="flex flex-wrap gap-3">
        <Button
          disabled={disabled || !accountId}
          onClick={() => {
            if (accountId) onChoose(accountId);
          }}
        >
          Confirm account
        </Button>
        <CreateAccountDialog />
      </div>
    </div>
  );
}
function RowChoice({
  row,
  review,
  disabled,
  onChoose,
}: {
  row: typeof ReviewObservation.Type;
  review: ReviewItem;
  disabled: boolean;
  onChoose: (decision: ObservationDecision) => void;
}) {
  const [correcting, setCorrecting] = useState(false);
  const [omitting, setOmitting] = useState(false);
  const [correctionTarget, setCorrectionTarget] = useState(row.postingId);
  const locator =
    row.locator.kind === "csvLine"
      ? `Line ${row.locator.line}`
      : row.locator.kind === "ofxTransaction"
        ? `Transaction ${row.locator.ordinal}`
        : `Page ${row.locator.page}, row ${row.locator.row}`;
  const accepted = row.acceptedCandidate;
  return (
    <article className="space-y-4 rounded-md bg-secondary/50 p-4">
      <h3 className="font-medium">{locator}</h3>
      <dl className="grid gap-3 text-sm sm:grid-cols-[140px_1fr]">
        {Object.entries(row.raw).map(([key, value]) => (
          <div key={key} className="contents">
            <dt className="text-muted-foreground">{key}</dt>
            <dd className="min-w-0 font-mono break-words whitespace-pre-wrap">
              {value || "Empty"}
            </dd>
          </div>
        ))}
      </dl>
      {row.candidate && (
        <p className="text-sm">
          Decoded as {row.candidate.postedOn} · {formatMoney(row.candidate.amount)} ·{" "}
          {row.candidate.description}
        </p>
      )}
      {accepted && row.postingId && (
        <div className="space-y-2 rounded-md border bg-background p-4">
          <p className="text-sm">
            Accepted: {accepted.postedOn} · {formatMoney(accepted.amount)} · {accepted.description}
          </p>
          <Button
            variant="outline"
            disabled={disabled}
            onClick={() => {
              if (row.postingId)
                onChoose({ kind: "keep", candidate: accepted, postingId: row.postingId });
            }}
          >
            Keep accepted values
          </Button>
        </div>
      )}
      {!row.postingId && review.candidates.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">Possible existing transactions</p>
          {review.candidates.map((posting) => (
            <div
              key={posting.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-background p-3"
            >
              <Link
                to="/transactions/$id"
                params={{ id: posting.id }}
                className="text-sm underline"
              >
                {posting.postedOn} · {formatMoney(posting.amount)} · {posting.description}
              </Link>
              <Button
                variant="outline"
                disabled={disabled || !row.candidate}
                onClick={() => onChoose({ kind: "match", postingId: posting.id })}
              >
                Match this transaction
              </Button>
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-3">
        {!row.postingId && row.candidate && (
          <Button
            variant="outline"
            disabled={disabled}
            onClick={() => onChoose({ kind: "distinct" })}
          >
            This is a distinct transaction
          </Button>
        )}
        <Button
          variant="outline"
          disabled={disabled}
          onClick={() => setCorrecting((value) => !value)}
        >
          {correcting ? "Close editor" : "Check or correct values"}
        </Button>
      </div>
      {!row.postingId && review.kind === "value" && (
        <Button variant="ghost" disabled={disabled} onClick={() => setOmitting((value) => !value)}>
          {omitting ? "Close exclusion" : "Leave this row out"}
        </Button>
      )}
      {omitting && (
        <OmitRow disabled={disabled} onSubmit={(reason) => onChoose({ kind: "omit", reason })} />
      )}
      {correcting && !row.postingId && review.candidates.length > 0 && (
        <div className="space-y-2">
          <Label htmlFor={`${row.id}-target`}>Save corrected values to</Label>
          <Select value={correctionTarget} onValueChange={setCorrectionTarget} disabled={disabled}>
            <SelectTrigger id={`${row.id}-target`}>
              <SelectValue placeholder="A distinct new transaction" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={null}>A distinct new transaction</SelectItem>
              {review.candidates.map((posting) => (
                <SelectItem key={posting.id} value={posting.id}>
                  {posting.postedOn} · {formatMoney(posting.amount)} · {posting.description}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {correcting && (
        <CorrectValues
          row={row}
          disabled={disabled}
          onSubmit={(candidate) =>
            onChoose({ kind: "correct", candidate, postingId: correctionTarget })
          }
        />
      )}
    </article>
  );
}
