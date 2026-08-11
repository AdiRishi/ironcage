import { TooltipProvider } from "@ironcage/ui/components/tooltip";

import { ThemeProvider } from "@/lib/theme";

// App-wide providers, wrapping every route via the router's `Wrap` option.
// Anything here runs on both the server and the client, so it must not touch
// `window` or `document` during render.
export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <TooltipProvider>{children}</TooltipProvider>
    </ThemeProvider>
  );
}
