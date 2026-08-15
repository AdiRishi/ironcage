import { TanStackDevtools } from "@tanstack/react-devtools";
import { type QueryClient } from "@tanstack/react-query";
import { HeadContent, Outlet, Scripts, createRootRouteWithContext } from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";

import { AppShell } from "@/components/shell/app-shell";
import { systemStatusQuery } from "@/data/system";
import { themeInitScript } from "@/lib/theme";

import appCss from "@ironcage/ui/globals.css?url";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  loader: ({ context }) => context.queryClient.prefetchQuery(systemStatusQuery),
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      {
        title: "Ironcage",
      },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
    scripts: [
      // Must run before first paint — see the comment on `themeInitScript`.
      { children: themeInitScript },
    ],
  }),

  shellComponent: RootDocument,
  component: RootLayout,
});

function RootDocument({ children }: { children: React.ReactNode }) {
  // `dark` is the SSR default. The head script above corrects it to `light`
  // before paint when that is what the operator chose, which by design makes
  // the client's class attribute differ from the server's. That is the one
  // mismatch we want, so it is suppressed here rather than avoided — the
  // alternative is applying the theme in an effect and flashing dark first.
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <TanStackDevtools
          config={{
            position: "bottom-right",
          }}
          plugins={[
            {
              name: "Tanstack Router",
              render: <TanStackRouterDevtoolsPanel />,
            },
          ]}
        />
        <Scripts />
      </body>
    </html>
  );
}

function RootLayout() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
