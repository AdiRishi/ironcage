import {
  type ObservationDecision,
  type ReviewItem,
  type ReviewObservation,
} from "@repo/contracts/finance";
import { formatMoney } from "@repo/finance";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { CorrectValues } from "./correct-values";
import { OmitRow } from "./omit-row";

export function RowChoice({
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
      {row.locator.kind === "pdfRow" &&
        (review.bytesAvailable ? (
          <a
            className="text-sm text-primary underline"
            href={`/sources/${review.sourceFileId}#page=${row.locator.page}`}
          >
            Open statement page {row.locator.page}
          </a>
        ) : (
          <Link to="/imports" className="text-sm text-primary underline">
            Original bytes removed. Reupload the statement.
          </Link>
        ))}
      <dl className="grid gap-3 text-sm sm:grid-cols-[140px_1fr]">
        {Object.entries(row.raw)
          .filter(([key]) => key !== "positions")
          .map(([key, value]) => (
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
              <div className="w-full space-y-1 text-xs">
                {posting.sources.map((source) =>
                  source.bytesAvailable ? (
                    <a
                      key={source.sourceFileId}
                      className="block text-primary underline"
                      href={`/sources/${source.sourceFileId}${source.locator.kind === "pdfRow" ? `#page=${source.locator.page}` : ""}`}
                    >
                      {source.fileName}
                      {source.locator.kind === "pdfRow" ? ` · Page ${source.locator.page}` : ""}
                    </a>
                  ) : (
                    <p key={source.sourceFileId}>{source.fileName} · Original bytes removed</p>
                  ),
                )}
              </div>
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
