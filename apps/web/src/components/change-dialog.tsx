import type { ComponentProps, ReactElement, ReactNode } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { PreviewedCommand } from "@/lib/use-previewed-command";

// A change chosen, previewed, and confirmed in one dialog. Confirm stays off until the
// change has a preview, and after a lost reply it retries the same command.
export function ChangeDialog({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  change,
  confirmLabel,
  recovery,
  finalFocus,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: ReactElement;
  title: string;
  description?: ReactNode;
  change: PreviewedCommand;
  confirmLabel: string;
  // What to do about a failure, such as previewing again after a stale reply.
  recovery?: ReactNode;
  // Where focus goes when the dialog closes, for a change that removes its trigger.
  finalFocus?: ComponentProps<typeof DialogContent>["finalFocus"];
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger render={trigger} />
      <DialogContent
        finalFocus={finalFocus}
        className="max-h-[90dvh] grid-cols-1 overflow-y-auto sm:max-w-xl"
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {children}
        {change.previewing && <output className="text-slate">Calculating the effect…</output>}
        {change.error && (
          <Alert variant="destructive">
            <AlertDescription>{change.error.message}</AlertDescription>
            {recovery && <div className="mt-2">{recovery}</div>}
          </Alert>
        )}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button
            disabled={!change.ready || change.pending}
            onClick={() => {
              change.confirm();
            }}
          >
            {change.pending && change.ready ? "Saving…" : change.uncertain ? "Retry" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
