import type {
  Briefing,
  BriefingInput,
  BriefingStatus,
  BriefingSummary,
} from "@repo/contracts/analyst";
import { FinanceError, type YearMonth } from "@repo/contracts/finance";
import { calendarDateIn, hasRecords, monthLabel, shiftYearMonth, yearMonthOf } from "@repo/finance";
import type { AnalystOperation, Api } from "@repo/infra/api";
import { Context, Crypto, DateTime, Effect, Layer, Struct } from "effect";
import { SqlClient } from "effect/unstable/sql";

import { TurnEvidence } from "../evidence/service.ts";
import {
  insertBriefing,
  queueBriefing,
  queueRewrite,
  readBriefing,
  readBriefingSummaries,
  type RewritableBriefing,
} from "../storage/briefings.ts";
import { toFinanceError } from "../storage/failures.ts";
import { AnalystToolkit, analystTools } from "../tools/toolkit.ts";
import { WorkScheduler } from "../work/scheduler.ts";
import { readBriefingFacts } from "./facts.ts";

// How many months the list shows.
const recentMonths = 12;

// Why a briefing cannot be asked for now.
type Refusal = ConstructorParameters<typeof FinanceError>[0];

const unwritten = (
  month: YearMonth,
  status: Exclude<BriefingStatus, "ready">,
  message: string | null = null,
): Briefing => ({
  month,
  status,
  sections: null,
  figures: [],
  records: [],
  basis: null,
  limits: [],
  writtenAt: null,
  message,
});

export class Briefings extends Context.Service<
  Briefings,
  {
    // A ready briefing only while it was written from the facts the ledger gives now.
    // Otherwise its sections stay hidden, and a rewrite is queued once the analyst may
    // call its model and no facts wait to be rebuilt.
    readonly get: (input: BriefingInput) => Effect.Effect<Briefing, FinanceError>;
    // Queues a write of a month that has ended and has records, unless one waits or runs
    // already.
    readonly request: (input: BriefingInput) => Effect.Effect<Briefing, FinanceError>;
    readonly list: Effect.Effect<ReadonlyArray<BriefingSummary>, FinanceError>;
    // Queues last month's first write in the settings timezone, once it could be asked for.
    readonly queueLastMonth: Effect.Effect<void, FinanceError>;
  }
>()("@repo/analyst/briefings/Briefings") {
  static readonly layer = (api: Pick<Api, AnalystOperation>) =>
    Layer.effect(
      Briefings,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const crypto = yield* Crypto.Crypto;
        const scheduler = yield* WorkScheduler;
        const reads = yield* AnalystToolkit;
        const provide = Effect.provideService(SqlClient.SqlClient, sql);

        const thisMonth = Effect.fnUntraced(function* (timezone: string) {
          return yearMonthOf(calendarDateIn(yield* DateTime.now, timezone));
        });

        // Why the month's briefing cannot be written now, if it cannot: the month has no
        // records, the analyst may not call its model, or facts wait to be rebuilt, which
        // moves the figures the briefing would cite.
        const unwritable = Effect.fnUntraced(function* (month: YearMonth, currency: string) {
          const [{ period, coverage }, allowance, facts] = yield* Effect.all(
            [
              api.getCoverage({ period: { kind: "months", from: month, to: month }, currency }),
              api.getModelAllowance({ task: "briefing" }),
              api.getFactsStatus(),
            ],
            { concurrency: "unbounded" },
          );
          if (!hasRecords(coverage, period))
            return {
              kind: "invalid",
              message: `No records for ${monthLabel(month)} yet. Upload the ${monthLabel(month)} statements.`,
            } satisfies Refusal;
          if (!allowance.allowed)
            return { kind: "unavailable", message: allowance.message } satisfies Refusal;
          if (facts.outdated > 0)
            return {
              kind: "unavailable",
              message:
                "Ironcage is recalculating totals after an update. Write the briefing once it finishes.",
            } satisfies Refusal;
          return null;
        });

        // Queues a write of a briefing that was blocked or whose facts changed, and shows
        // it as blocked while the analyst may not call its model. The reason is read now,
        // because it changes when you change the settings.
        const writeAgain = Effect.fnUntraced(function* (
          briefing: RewritableBriefing,
          rebuilding: boolean,
        ) {
          const allowance = yield* api.getModelAllowance({ task: "briefing" });
          if (!allowance.allowed) return unwritten(briefing.month, "blocked", allowance.message);
          // A rebuild moves the figures until it finishes, so the write waits for the
          // rebuild instead of following them. No other I/O may come between queuing and
          // scheduling, so the object commits the write and its alarm together.
          if (!rebuilding && (yield* queueRewrite(briefing))) yield* scheduler.schedule;
          return unwritten(briefing.month, "writing");
        });

        const get = Effect.fn("Briefings.get")(
          function* ({ month }: BriefingInput) {
            const briefing = yield* readBriefing(month);
            if (!briefing) return unwritten(month, "none");
            switch (briefing.status) {
              case "queued":
              case "writing":
                return unwritten(month, "writing");
              case "failed":
                return unwritten(month, "failed", briefing.failure);
              case "blocked":
                return yield* writeAgain(briefing, (yield* api.getFactsStatus()).outdated > 0);
              case "ready": {
                const facts = yield* readBriefingFacts(reads, month).pipe(
                  Effect.provide(TurnEvidence.briefing(api, month)),
                  Effect.provideService(Crypto.Crypto, crypto),
                );
                if (facts.fingerprint === briefing.fingerprint)
                  return {
                    ...Struct.omit(briefing, ["fingerprint"]),
                    message: null,
                  } satisfies Briefing;
                return yield* writeAgain(
                  briefing,
                  facts.evidence.limits.some((limit) => limit.kind === "recalculating"),
                );
              }
            }
          },
          provide,
          toFinanceError,
        );

        const request = Effect.fn("Briefings.request")(
          function* ({ month }: BriefingInput) {
            const settings = yield* api.getSettings();
            if (month >= (yield* thisMonth(settings.timezone)))
              return yield* new FinanceError({
                kind: "invalid",
                message: `${monthLabel(month)} has not ended. Choose a month that has.`,
              });
            const refused = yield* unwritable(month, settings.reportingCurrency);
            if (refused) return yield* new FinanceError(refused);
            yield* queueBriefing(month);
            yield* scheduler.schedule;
            return unwritten(month, "writing");
          },
          provide,
          toFinanceError,
        );

        const list = readBriefingSummaries(recentMonths).pipe(
          provide,
          toFinanceError,
          Effect.withSpan("Briefings.list"),
        );

        const queueLastMonth = Effect.gen(function* () {
          const settings = yield* api.getSettings();
          const month = shiftYearMonth(yield* thisMonth(settings.timezone), -1);
          if (yield* readBriefing(month)) return;
          if (yield* unwritable(month, settings.reportingCurrency)) return;
          if (!(yield* insertBriefing(month))) return;
          yield* scheduler.schedule;
          yield* Effect.logInfo("The analyst queued last month's briefing", { month });
        }).pipe(provide, toFinanceError, Effect.withSpan("Briefings.queueLastMonth"));

        return Briefings.of({ get, request, list, queueLastMonth });
      }),
    ).pipe(Layer.provide(analystTools(api)));
}
