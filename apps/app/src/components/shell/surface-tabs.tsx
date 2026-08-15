import { Tabs, TabsList, TabsTrigger } from "@ironcage/ui/components/tabs";
import { Link, useRouterState } from "@tanstack/react-router";

import type { SurfaceTab } from "@/components/shell/nav";
import { useTabCounts } from "@/components/shell/tab-counts";

/**
 * A surface's sub-navigation, driven by the router rather than by local state.
 *
 * `Tabs` is controlled from the current pathname and each trigger renders a
 * `Link`, so the browser's back button, a deep link, and a click all move the
 * selection the same way. Giving `Tabs` its own state would create a second
 * source of truth that disagrees with the URL on the first back-navigation.
 */
function TabCount({ value }: { readonly value: number | undefined }) {
  if (value === undefined || value === 0) return null;
  return <span className="ml-1.5 font-mono text-[11px] text-ink-faint">· {value}</span>;
}

export function SurfaceTabs({ tabs }: { tabs: readonly SurfaceTab[] }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const counts = useTabCounts(tabs);

  if (tabs.length === 0) return null;

  return (
    <Tabs value={pathname}>
      <TabsList variant="line">
        {tabs.map((tab) => (
          // `nativeButton={false}` because the trigger renders an anchor.
          // Without it Base UI warns that it lost native button semantics —
          // which is correct and intended: these are links, and they should
          // open in a new tab on middle-click.
          <TabsTrigger
            key={tab.to}
            value={tab.to}
            nativeButton={false}
            render={<Link to={tab.to} />}
          >
            {tab.label}
            <TabCount value={tab.count === undefined ? undefined : counts[tab.count]} />
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
