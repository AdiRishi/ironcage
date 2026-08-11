import { Alert, AlertDescription, AlertTitle } from "@ironcage/ui/components/alert";
import { TriangleAlertIcon } from "lucide-react";

/**
 * The break-glass override strip, rendered above every surface while an
 * override is armed or active. `docs/product/07-operations.md` requires it to
 * be unmissable on every screen, which is why it lives in the shell rather
 * than on the surfaces that an override affects.
 *
 * Nothing renders it yet: there is no override state to read. It is here so
 * the shell has the slot, and so the next change wires a query rather than
 * inventing a layout.
 */
export function OverrideBanner({ children }: { children?: React.ReactNode }) {
  if (!children) return null;

  return (
    <Alert variant="destructive" className="rounded-none border-x-0 border-t-0">
      <TriangleAlertIcon />
      <AlertTitle className="font-mono tracking-widest">OVERRIDE ACTIVE</AlertTitle>
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}
