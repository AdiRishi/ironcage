import { Button } from "@ironcage/ui/components/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@ironcage/ui/components/sidebar";
import { cn } from "@ironcage/ui/lib/utils";
import { Link, useRouterState } from "@tanstack/react-router";
import { MoonIcon, SunIcon } from "lucide-react";

import { activeSection, NAV_SECTIONS } from "@/components/shell/nav";
import { useFeedConnection } from "@/data/feed";
import { useTheme } from "@/lib/theme";

/**
 * The navigation rail.
 *
 * `collapsible="offcanvas"` rather than `"icon"`: the design numbers its
 * destinations instead of giving them icons, so an icon rail would collapse to
 * a column of nothing. Off-canvas slides the whole rail away and keeps the
 * mobile sheet, both of which come from the shadcn component unchanged.
 */
export function AppSidebar() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const current = activeSection(pathname);
  const { theme, toggleTheme } = useTheme();
  const feedConnection = useFeedConnection();

  return (
    <Sidebar collapsible="offcanvas">
      <SidebarHeader>
        <Link to="/" className="flex items-center gap-2.5 px-2 py-3">
          <img src="/icon-192.png" alt="" className="size-6 rounded-md" />
          <span className="font-display text-[13px] font-semibold tracking-[0.22em] text-foreground">
            IRONCAGE
          </span>
        </Link>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            {NAV_SECTIONS.map((section) => {
              const isActive = section.match === current.match;
              return (
                <SidebarMenuItem key={section.match}>
                  <SidebarMenuButton isActive={isActive} render={<Link to={section.to} />}>
                    <span
                      className={cn(
                        "font-mono text-[10px] tabular-nums",
                        isActive ? "text-primary" : "text-ink-faint",
                      )}
                    >
                      {section.ordinal}
                    </span>
                    <span>{section.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <div className="flex items-center gap-2 px-2 font-mono text-[10px] tracking-[0.15em] text-ink-faint">
          <span
            className={
              feedConnection === "live"
                ? "size-1.5 rounded-full bg-emerald-500"
                : "size-1.5 rounded-full bg-amber-500"
            }
          />
          FEED — {feedConnection.toUpperCase()}
        </div>
        <Button variant="outline" size="sm" onClick={toggleTheme} className="justify-start">
          {theme === "dark" ? (
            <SunIcon data-icon="inline-start" />
          ) : (
            <MoonIcon data-icon="inline-start" />
          )}
          <span className="font-mono text-[10px] tracking-[0.15em]">
            {theme === "dark" ? "LIGHT MODE" : "DARK MODE"}
          </span>
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
