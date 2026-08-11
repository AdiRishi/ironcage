import { SidebarInset, SidebarProvider } from "@ironcage/ui/components/sidebar";

import { AppSidebar } from "@/components/shell/app-sidebar";
import { AppTopbar } from "@/components/shell/app-topbar";
import { OverrideBanner } from "@/components/shell/override-banner";

/** 208px, from the design. Passed as a style rather than edited into the
 *  shadcn source, so `sidebar.tsx` stays a clean upstream file. */
const SIDEBAR_WIDTH = "13rem";

/**
 * The one layout every surface renders inside, per `docs/technical/11-app.md`
 * §5. Mode, halt-all, the critical count, the override banner, and the
 * connection indicator all live here so that no surface can forget them.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider style={{ "--sidebar-width": SIDEBAR_WIDTH } as React.CSSProperties}>
      <AppSidebar />
      <SidebarInset>
        <OverrideBanner />
        <AppTopbar />
        <div className="mx-auto flex w-full max-w-[1220px] flex-col gap-7 p-7">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
