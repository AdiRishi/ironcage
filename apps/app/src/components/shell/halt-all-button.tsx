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
  return (
    <AlertDialog>
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
          {/* Calls nothing yet. The server function lands with core's
              risk-reducing surface, and it goes here — not behind a loader. */}
          <AlertDialogAction variant="destructive">Halt all</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
