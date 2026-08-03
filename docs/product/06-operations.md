# Operations & control

This document specifies how the operator controls Ironcage: the modes, the always-available interventions, mandate changes, the break-glass override, and the integrity behaviors (reconciliation, data gaps) that keep the system honest under failure.

## Modes

Sleeve states are specified in [Sleeves](./02-sleeves.md). Above them, the system as a whole is in exactly one mode:

- **Running** — normal operation.
- **Halted** — nothing trades anywhere. Entered automatically by the system cage ([Capital](./07-capital.md) — total drawdown or exposure breach, or a failure the system cannot attribute to a single sleeve), or manually by the operator's halt-all. Leaving system Halted is always an operator action from the incident report.

## The operator's controls

**Risk-reducing actions are always available and never gated.** From any relevant view, one click plus a confirm:

- **Pause a sleeve** — no new entries; existing positions and stops continue to be managed.
- **Flatten** — exit a position, or all of a sleeve's positions, at market.
- **Halt a sleeve** — full stop with its winddown policy.
- **Halt everything** — the system-wide stop, reachable from anywhere in the app.

No AI output, cage rule, or system state can block these. Every use is a feed event.

**Risk-increasing actions go through the mandate.** Raising a cap, widening a limit, changing a strategy: these are mandate changes — deliberate, versioned, recorded acts. The app presents a mandate edit as what it is: a review screen showing the full diff and requiring a written reason, which becomes part of the mandate's version history. Changes take effect from the next tick, never mid-decision. There are no live sliders on risk.

AI-originated changes arrive through the same door: a gated proposal ([Sleeves](./02-sleeves.md)) that has passed its pipeline reaches the operator as a pre-filled mandate change — diff, rationale, and gate results attached — and is approved or rejected on the same review screen with the same recording. The AI never gets a second, quieter path into the mandate.

## The break-glass override

For the moment the operator decides, with open eyes, to act outside a limit — without dismantling the cage to do it.

- **Scope**: an override names one specific limit on one sleeve and permits one class of action past it (e.g. "allow one entry in BTC above the position cap"). It cannot disable auditing, cannot touch the always-on risk-reducing controls, cannot affect any other sleeve, and cannot suspend the system cage.
- **Flow**: request → the app states exactly what is being overridden and its risk in plain words → the operator types a confirmation phrase naming the limit → a **15-minute cooling-off** timer runs → the override becomes active for at most **24 hours**, then expires automatically.
- **Visibility**: an armed or active override is unmissable from every view, with its scope and expiry. Arming, activation, each use, and expiry are all `critical` feed events requiring acknowledgment.

The friction is the feature: the override exists so the cage never has to be dismantled in an emergency, and the delay exists because the cage protects the operator from himself too.

## Reconciliation

For every live sleeve, Ironcage reconciles its own records against the venue: on engine startup, on a fixed schedule, and after any connectivity loss. Balances, positions, and open orders must match what the blotter implies. On mismatch: the sleeve halts (winddown: `keep-all` — never trade on numbers in dispute), a `critical` event fires, and an incident report is generated with both sides of the disagreement. External changes the operator made manually at the venue are adopted into the record during reconciliation and noted in the feed — the system does not fight its operator; it accounts for them.

## Failing closed, visibly

- A market-data gap stands down the sleeves that depend on it (no evaluation on incomplete candles); the stand-down and recovery are feed events.
- A failed or invalid AI output (regime tick, categorization, report) is a recorded failure; the dependent behavior degrades to its safe default (OFF, uncategorized-pending-review, missing-report warning) — never to a guess.
- A venue or gateway outage halts entries for affected sleeves; stops that live server-side at the venue are noted as still armed; the outage is a `critical` event when positions are open.
- The app itself losing its backend connection shows as staleness on the health strip — the observatory never displays dead data as live.

## Access

One operator. The app requires authentication, sessions expire, and there are no other roles, shares, or viewers. (Mechanism is a technical-doc concern; the product commitment is simply: nobody but the operator sees or touches any of this.)
