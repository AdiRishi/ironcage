import { Badge } from "@ironcage/ui/components/badge";
import { Outlet, createFileRoute } from "@tanstack/react-router";

import { SleeveTabs } from "@/features/sleeves/components/sleeve-tabs";

export const Route = createFileRoute("/sleeves/$sleeveId")({ component: SleeveLayout });

/**
 * The living view's layout.
 *
 * `docs/technical/11-app.md` §1 requires the mode tag to render here rather
 * than in a leaf: a tab that forgot it would show dry-run figures with nothing
 * marking them as simulated. Putting it in the layout means no leaf can omit
 * it.
 */
function SleeveLayout() {
  const { sleeveId } = Route.useParams();

  return (
    <>
      <div className="flex items-center gap-3">
        <h2 className="font-display text-2xl font-semibold">{sleeveId}</h2>
        {/* Mode is unknown until core is wired. It is never absent, and it is
            never guessed. */}
        <Badge variant="outline" className="font-mono tracking-widest text-ink-faint">
          MODE UNKNOWN
        </Badge>
      </div>
      <SleeveTabs sleeveId={sleeveId} />
      <Outlet />
    </>
  );
}
