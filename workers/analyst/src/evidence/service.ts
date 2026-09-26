import {
  type Answer,
  type Figure,
  FigureId,
  type Limit,
  type Proposal,
  ProposalId,
  RecordId,
  type RecordRef,
  type TurnId,
  type TurnStep,
} from "@repo/contracts/analyst";
import type { Api } from "@repo/infra/api";
import { Array as Arr, Context, Effect, Layer, Ref, Struct } from "effect";
import { SqlClient } from "effect/unstable/sql";
import { v5 } from "uuid";

import { insertStep, readNextReference } from "../storage/conversations.ts";
import { toFinanceError } from "../storage/failures.ts";
import type { AccountLabel, CoverageRead } from "./basis.ts";

// Everything a turn's tools registered, in order.
export type Evidence = {
  readonly currency: string;
  readonly accounts: ReadonlyArray<AccountLabel>;
  readonly figures: ReadonlyArray<Figure>;
  readonly records: ReadonlyArray<RecordRef>;
  // The read of the period that places each figure a period places.
  readonly placed: ReadonlyMap<FigureId, CoverageRead>;
  // Checks of a period's records, which no figure rests on.
  readonly checks: ReadonlyArray<CoverageRead>;
  readonly limits: ReadonlyArray<Limit>;
  // The changes the turn proposed, which its answer keeps.
  readonly proposals: ReadonlyArray<Proposal>;
  // What the tools named, such as accounts, categories, and counterparties, which an
  // answer may write as the tools wrote them.
  readonly names: ReadonlyArray<string>;
  // The number the conversation's next figure or record takes.
  readonly nextReference: number;
  // The answer the Answer tool accepted, once it has.
  readonly accepted: Pick<Answer, "text" | "missing"> | null;
};

export class TurnEvidence extends Context.Service<
  TurnEvidence,
  {
    // The reporting currency, which every read in the turn uses, the settings timezone,
    // which places instants on dates, and the ledger's accounts.
    readonly currency: string;
    readonly timezone: string;
    readonly accounts: ReadonlyArray<AccountLabel>;
    // A figure takes its date basis from the read that places it, and has none when no
    // period places it.
    readonly figure: (
      figure: Omit<Figure, "id" | "basis">,
      placed: CoverageRead | null,
    ) => Effect.Effect<FigureId>;
    readonly record: (record: Omit<RecordRef, "id">) => Effect.Effect<RecordId>;
    // A pending proposal. Its ID comes from the turn and the proposal's place in it.
    readonly propose: (
      proposal: Pick<Proposal, "intent" | "preview" | "title" | "reason">,
    ) => Effect.Effect<ProposalId>;
    // Stored as soon as it is taken, so the conversation shows it while the turn runs.
    readonly step: (step: TurnStep) => Effect.Effect<void>;
    readonly check: (read: CoverageRead) => Effect.Effect<void>;
    readonly limit: (limit: Limit) => Effect.Effect<void>;
    readonly names: (names: ReadonlyArray<string | null>) => Effect.Effect<void>;
    readonly accept: (answer: Pick<Answer, "text" | "missing">) => Effect.Effect<void>;
    readonly snapshot: Effect.Effect<Evidence>;
  }
>()("@repo/analyst/evidence/TurnEvidence") {
  // Figures and records take their numbers from the conversation's stored count, so an
  // answer never cites a figure an earlier answer in the conversation cited.
  static readonly layer = (
    api: Pick<Api, "getSettings" | "listAccounts" | "getFactsStatus">,
    turnId: TurnId,
  ) =>
    Layer.effect(
      TurnEvidence,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const [first, settings, accounts, facts] = yield* Effect.all(
          [readNextReference(turnId), api.getSettings(), api.listAccounts(), api.getFactsStatus()],
          { concurrency: "unbounded" },
        );
        const { reportingCurrency: currency, timezone } = settings;
        const labels = accounts.map(Struct.pick(["id", "kind", "label", "currency"]));
        const state = yield* Ref.make<
          Omit<Evidence, "currency" | "accounts" | "nextReference"> & { readonly next: number }
        >({
          next: first,
          figures: [],
          records: [],
          placed: new Map(),
          checks: [],
          limits: [],
          proposals: [],
          names: labels.map((account) => account.label),
          accepted: null,
        });
        const limit = (added: Limit) =>
          Ref.update(state, (current) => ({
            ...current,
            limits: Arr.dedupe([...current.limits, added]),
          }));
        if (facts.outdated > 0) yield* limit({ kind: "recalculating", outdated: facts.outdated });
        return TurnEvidence.of({
          currency,
          timezone,
          accounts: labels,
          figure: (figure, placed) =>
            Ref.modify(state, (current) => {
              const id = FigureId.make(`f${current.next}`);
              return [
                id,
                {
                  ...current,
                  next: current.next + 1,
                  figures: [...current.figures, { id, ...figure, basis: placed?.basis ?? null }],
                  placed: placed ? new Map([...current.placed, [id, placed]]) : current.placed,
                },
              ];
            }),
          record: (record) =>
            Ref.modify(state, (current) => {
              const id = RecordId.make(`r${current.next}`);
              return [
                id,
                {
                  ...current,
                  next: current.next + 1,
                  records: [...current.records, { id, ...record }],
                },
              ];
            }),
          propose: (proposed) =>
            Ref.modify(state, (current) => {
              const place = current.proposals.length + 1;
              const id = ProposalId.make(v5(`${turnId}/proposals/${place}`, v5.URL));
              const proposal = {
                id,
                ...proposed,
                status: "pending",
                commandId: null,
                resolvedAt: null,
              } satisfies Proposal;
              return [id, { ...current, proposals: [...current.proposals, proposal] }];
            }),
          step: (step) =>
            insertStep(turnId, step).pipe(
              Effect.provideService(SqlClient.SqlClient, sql),
              Effect.orDie,
            ),
          check: (read) =>
            Ref.update(state, (current) => ({ ...current, checks: [...current.checks, read] })),
          limit,
          names: (names) =>
            Ref.update(state, (current) => ({
              ...current,
              names: Arr.dedupe([...current.names, ...names.flatMap((name) => name ?? [])]),
            })),
          accept: (answer) => Ref.update(state, (current) => ({ ...current, accepted: answer })),
          snapshot: Ref.get(state).pipe(
            Effect.map(({ next, ...current }) => ({
              ...current,
              currency,
              accounts: labels,
              nextReference: next,
            })),
          ),
        });
      }).pipe(toFinanceError),
    );
}
