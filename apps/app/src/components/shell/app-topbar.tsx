import { Badge } from "@ironcage/ui/components/badge";
import { Separator } from "@ironcage/ui/components/separator";
import { SidebarTrigger } from "@ironcage/ui/components/sidebar";
import { useQuery } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";

import { HaltAllButton } from "@/components/shell/halt-all-button";
import { activeSection } from "@/components/shell/nav";
import { systemStatusQuery } from "@/data/system";

/**
 * The bar that answers "where am I, and is the system running?" on every
 * surface. Mode and the unacknowledged-critical count belong here rather than
 * on Overview, because `docs/product/01-overview.md` requires them to be
 * legible without navigating anywhere.
 *
 * Both read "unknown" until core is wired. An unknown mode is a true statement;
 * a green "RUNNING" pill on an app that has never spoken to core is not.
 */
export function AppTopbar() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const current = activeSection(pathname);
  const status = useQuery(systemStatusQuery);
  const mode = status.data?.mode;

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
      <SidebarTrigger />
      <Separator orientation="vertical" className="h-4" />
      <h1 className="font-display text-[13px] font-semibold tracking-[0.18em] text-foreground">
        {current.label.toUpperCase()}
      </h1>
      {current.tagline === undefined ? null : (
        <span className="hidden font-mono text-xs tracking-wide text-ink-faint uppercase sm:inline">
          {current.tagline}
        </span>
      )}
      <div className="ml-auto flex items-center gap-2">
        {status.data !== undefined && status.data.unacknowledgedCriticals > 0 ? (
          <Badge variant="destructive" className="font-mono tracking-widest">
            {status.data.unacknowledgedCriticals} CRITICAL
          </Badge>
        ) : null}
        <Badge
          variant="outline"
          className={
            mode === "running"
              ? "font-mono tracking-widest text-live"
              : mode === "halted"
                ? "font-mono tracking-widest text-destructive"
                : "font-mono tracking-widest text-ink-faint"
          }
        >
          MODE {mode?.toUpperCase() ?? "UNKNOWN"}
        </Badge>
        <HaltAllButton />
      </div>
    </header>
  );
}
