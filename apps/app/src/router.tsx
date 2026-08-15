import { QueryClient } from "@tanstack/react-query";
import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";

import { AppProviders } from "@/lib/app-provider";

import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  // QueryClient must be created per getRouter() call: TanStack Start calls the
  // router factory once per SSR request, and a shared cache would leak data
  // across requests.
  // 30 s is the default query staleTime from docs/technical/11-app.md §2;
  // surfaces that need a tighter budget say so on their own queryOptions.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000 } },
  });

  const router = createTanStackRouter({
    routeTree,
    scrollRestoration: true,
    context: { queryClient },
    Wrap: AppProviders,
  });

  setupRouterSsrQueryIntegration({
    router,
    queryClient,
  });

  return router;
};

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
