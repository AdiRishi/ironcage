import { type QueryClient } from "@tanstack/react-query";
import { HeadContent, Link, Scripts, createRootRouteWithContext } from "@tanstack/react-router";
import { House, LockKeyhole } from "lucide-react";

import appCss from "@/global-styles/tailwind.css?url";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "ironcage" },
      {
        name: "description",
        content: "Your bank history, with the evidence behind every transaction.",
      },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  shellComponent: RootDocument,
});

function RootDocument({ children }: { readonly children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-white focus:p-3"
        >
          Skip to content
        </a>
        <div className="min-h-screen md:grid md:grid-cols-[220px_1fr]">
          <aside className="flex flex-col border-b bg-secondary p-5 md:border-r md:border-b-0">
            <Link to="/" className="mb-7 text-2xl font-semibold tracking-tight text-foreground">
              [ ] ironcage
            </Link>
            <nav aria-label="Main navigation">
              <Link
                to="/"
                className="flex items-center gap-3 rounded-md bg-accent px-3 py-2 text-primary"
              >
                <House className="size-5" />
                Home
              </Link>
            </nav>
            <p className="mt-auto hidden pt-10 text-xs text-muted-foreground md:block">
              <LockKeyhole className="mb-2 size-4" />
              Private financial workspace
            </p>
          </aside>
          <main id="main" className="min-w-0 p-5 md:p-9 lg:p-12">
            {children}
          </main>
        </div>
        <Scripts />
      </body>
    </html>
  );
}
