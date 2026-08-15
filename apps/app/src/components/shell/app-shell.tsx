import { SidebarInset, SidebarProvider } from "@ironcage/ui/components/sidebar";
import { useRouterState } from "@tanstack/react-router";

import { AppSidebar } from "@/components/shell/app-sidebar";
import { AppTopbar } from "@/components/shell/app-topbar";
import { activeSection } from "@/components/shell/nav";
import { OverrideBanner } from "@/components/shell/override-banner";
import { SurfaceTabs } from "@/components/shell/surface-tabs";

/** 208px, from the design. Passed as a style rather than edited into the
 *  shadcn source, so `sidebar.tsx` stays a clean upstream file. */
const SIDEBAR_WIDTH = "13rem";

// SAFETY: React supports CSS custom properties, but CSSProperties intentionally
// omits their open-ended names from its static property list.
const sidebarStyle = { "--sidebar-width": SIDEBAR_WIDTH } as React.CSSProperties;

/**
 * The one layout every surface renders inside, per `docs/technical/11-app.md`
 * §5. Mode, halt-all, the critical count, the override banner, and the
 * connection indicator all live here so that no surface can forget them.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { tabs } = activeSection(pathname);

  return (
    <SidebarProvider style={sidebarStyle}>
      <AppSidebar />
      <SidebarInset>
        <OverrideBanner />
        <AppTopbar />
        <div className="mx-auto flex w-full max-w-[1220px] flex-col gap-7 p-7">
          <SurfaceTabs tabs={tabs} />
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
