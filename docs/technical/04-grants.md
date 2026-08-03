# Grants & the gate pipeline

This document is the runtime for `docs/product/02-sleeves.md`'s grant system: how AI actually executes, how its outputs reach the engine, how the control ledger keeps score, and how design-time proposals pass their gauntlet. The topology rule (ADR-0001) governs everything here: **grant runners write rows; the engine reads rows; there is no other channel.**

## The registry

`@app/contracts/grants` defines `GrantRegistryEntry`; the registry itself is code — a versioned list in `apps/grants/registry.ts`. Each entry binds: valve class, cadence, staleness window, output schema, safe default, control definition ("multiplier 1.0" for the regime vector; "no locks" for the event veto; "no tightenings" for the risk officer), demotion rule (threshold + window + confidence), and the prompt/context assembly for AI-backed grants. Adding a grant is a commit; the four valve classes are closed (ADR-0003).

## Runtime grants (attenuators)

`apps/grants` runs on Cron Triggers, one handler per grant cadence:

1. **Context assembly** — deterministic code gathers the inputs the registry entry declares: candles and derived stats from D1, calendar feeds, venue status, news sources. Multiple independent sources by design; each context is snapshotted in full.
2. **The AI call** — through **AI Gateway** (caching, cost tracking, automatic retries, provider fallback Anthropic → OpenAI), requesting structured output.
3. **Validation** — the response is decoded against the grant's output schema (`Schema.decodeUnknown`). A failed decode is a **failed tick**: nothing is written except the failure event; the engine's staleness logic converts silence into the safe default. The system never repairs, coerces, or retries-until-it-parses an invalid AI output.
4. **Persistence** — validated output → `grant_outputs` row; full prompt/context/response → R2 snapshot; material changes (axis moved, veto placed) → feed events.

Attenuator consumption happens entirely in the engine's slow tick (03): staleness computed at read time, clamping and `min`-composition in pure code, exits/stops structurally exempt. Event vetoes are not even a special path — they're `pair_locks` rows with `source: grant`, expiring on their own; the grant runner cannot delete locks (no code path exists), which is how "AI locks, never unlocks" is enforced by topology rather than policy.

The risk-officer grant writes `RiskTightening` rows; the cage evaluates effective limits as `min(mandate limit, active tightenings)` — tightenings reference the mandate baseline (never each other), expire, and cannot exceed it, making ratchet drift and loosening both unrepresentable.

## The control ledger

The counterfactual leg (03, step 6) writes `control_decisions`; `apps/jobs` accrues them: control intents are simulated-filled with the same simulator, a shadow equity series per grant is maintained, and `grant_ledger` holds the running deltas (P&L, drawdown, costs — including the grant's own AI spend, attributed via AI Gateway's per-request cost data). The demotion rule evaluates on accrual: a breach flips the grant's status to `suspended` in D1, emits a `critical` event, and the engine's read path treats a suspended grant exactly as a stale one — safe default. Reinstatement is an operator act. No component ever "argues" for a grant; the ledger is the whole conversation.

## Design-time grants: proposals and gates

Proposal-producing grants (parameter corridors, strategy variants) run on slow crons in `apps/grants`, read performance history, and write `proposals` rows. Each proposal spawns a **GatePipeline** Workflow:

```
gate 1  validate      — schema; corridor bounds & step limits; concurrent-trial cap
gate 2  reproduce     — re-run the proposal's claimed backtest from its config;
                        results must match its claims (hash-compared)
gate 3  walk-forward  — the standard harness over the declared windows; acceptance
                        thresholds are multiplicity-adjusted using the workbench's
                        trial count for this strategy family
gate 4  shadow        — register a champion/challenger shadow run; the challenger
                        config runs simulated beside the incumbent for the declared
                        period; the workflow sleeps and re-checks on a schedule
gate 5  operator      — waitForEvent: the approval arrives from the web app as a
                        pre-filled mandate-change review (same screen, same record
                        as a manual change — no second door)
```

A failure at any gate ends the run with the gate's full artifact persisted; the proposal's status and every gate result are feed events and workbench-visible. An approved proposal becomes a `mandate_versions` row exactly as a manual edit would.

The **multiplicity ledger** is a counter table keyed by strategy family, incremented by every backtest the workbench or gates run; gate-3 thresholds scale with it (deflated-Sharpe-style correction implemented in `@app/core/stats`). This is the lucky-monkey defense as arithmetic rather than vigilance.

## Observers

Report-producing grants (weekly reviews, calibration, allocation memo, red-team scenarios) run in `apps/jobs` on their schedules: gather recorded data → AI Gateway → validate the structured skeleton (claims with record references) → render to R2 → `reports` row + feed event. A report whose citations don't resolve against the database fails generation — visibly. The red-team grant additionally drives the deterministic scenario engine in `@app/core/scenarios` (typed shocks replayed against current state) and cites its outputs.

## Prompt & model conventions

Prompts are assembled from named, ordered sections (context, task, output schema, constraints) with the full assembly snapshotted per tick — never templated ad hoc in call sites. Models are configured per grant in the registry (a cheap model for classification-shaped grants, a frontier model for synthesis-shaped ones), with AI Gateway holding the fallback chain. Budget: per-grant spend is visible in the ledger; a grant exceeding its mandate-declared monthly budget is suspended like any other underperformer — cost is part of value-added.
