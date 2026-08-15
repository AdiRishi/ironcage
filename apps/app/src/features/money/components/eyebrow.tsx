import { CardTitle } from "@ironcage/ui/components/card";
import { cn } from "@ironcage/ui/lib/utils";

/**
 * A panel's title in the observatory register: small mono caps, tracked wide,
 * receding — the panel is named by its data, not by a headline. Prose stays
 * in Plex Sans; only the label goes to mono.
 */
export function Eyebrow({ className, ...props }: React.ComponentProps<typeof CardTitle>) {
  return (
    <CardTitle
      className={cn(
        "font-mono text-[10px] font-medium tracking-[0.15em] text-ink-faint uppercase",
        className,
      )}
      {...props}
    />
  );
}
