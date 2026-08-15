import { HaltAllInput, Outcome, SystemStatus } from "@ironcage/contracts/schema";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@ironcage/ui/components/alert-dialog";
import { Button } from "@ironcage/ui/components/button";
import { Schema } from "effect";
import { useState } from "react";

import { mintRequestId } from "@/data/request";
import { describeError } from "@/features/money/format";
import { haltAll } from "@/server/system";

const encodeHalt = Schema.encodeSync(HaltAllInput);
const decodeOutcome = Schema.decodeUnknownSync(Outcome(SystemStatus));

/**
 * The always-available intervention.
 *
 * `docs/technical/11-app.md` §5 constrains this control specifically: it must
 * depend on nothing but the core service binding. It must not read TanStack
 * Query, the feed socket, or any route loader, because it has to stay
 * clickable when all three are broken — that is the only circumstance in which
 * it matters. Wiring it to a loader for a nicer disabled state would quietly
 * remove the guarantee.
 */
export function HaltAllButton() {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  const halt = async (event: React.MouseEvent) => {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    try {
      const outcome = decodeOutcome(
        await haltAll({
          data: encodeHalt({
            requestId: mintRequestId(),
            reason: "Operator invoked Halt All",
          }),
        }),
      );
      if (outcome.outcome === "error") {
        setError(describeError(outcome.error));
      } else {
        setOpen(false);
      }
    } catch (cause) {
      setError(String(cause));
    } finally {
      setPending(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger
        render={<Button variant="destructive" size="sm" className="font-mono tracking-widest" />}
      >
        HALT ALL
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Halt everything?</AlertDialogTitle>
          <AlertDialogDescription>
            Nothing trades anywhere. Every sleeve applies its winddown policy; stops held at the
            venue stay armed. Un-halting requires the incident report.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep running</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={pending} onClick={() => void halt()}>
            {pending ? "Halting…" : "Halt all"}
          </AlertDialogAction>
        </AlertDialogFooter>
        {error === undefined ? null : <p className="text-sm text-destructive">{error}</p>}
      </AlertDialogContent>
    </AlertDialog>
  );
}
