import { useRouterState } from "@tanstack/react-router";

import { activeSection } from "@/components/shell/nav";
import { SurfaceTabs } from "@/components/shell/surface-tabs";

/**
 * A surface's own tab strip, resolved from the one nav manifest. It renders
 * nothing for a surface that declares no tabs, so the shell does not need to
 * know which surfaces have them.
 */
export function SurfaceNav() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  return <SurfaceTabs tabs={activeSection(pathname).tabs} />;
}
