import { type QueryClient, useQuery, useSuspenseQuery } from "@tanstack/react-query";
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRouteWithContext,
  defaultStringifySearch,
  redirect,
  retainSearchParams,
  useRouterState,
} from "@tanstack/react-router";
import { Schema } from "effect";

import { RouteError } from "@/components/route-error";
import { PeriodStrip } from "@/components/shell/period-strip";
import { Recalculating } from "@/components/shell/recalculating";
import { TopBar } from "@/components/shell/top-bar";
import { monthlyFlowQuery } from "@/features/flow/queries";
import { questionsQuery } from "@/features/questions/queries";
import { settingsQueryOptions } from "@/features/settings/queries";
import { PeriodSearch, currentMonth, resolvePeriodKey } from "@/lib/period";

import appCss from "@/global-styles/tailwind.css?url";

// Screens that read the selected period show the strip; setup screens do not.
const periodScreens = ["/", "/spending", "/ledger", "/counterparties"];
const readsPeriod = (pathname: string) =>
  periodScreens.some((path) => (path === "/" ? pathname === "/" : pathname.startsWith(path)));

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  validateSearch: Schema.toStandardSchemaV1(PeriodSearch),
  search: { middlewares: [retainSearchParams(["period", "compare"])] },
  // Without a chosen period, screens read the current month in the settings timezone.
  // Before this month has any records, they read the latest month that does.
  beforeLoad: async ({ context, search, location }) => {
    if (search.period || !readsPeriod(location.pathname)) return;
    const settings = await context.queryClient.ensureQueryData(settingsQueryOptions());
    const months = await context.queryClient.ensureQueryData(
      monthlyFlowQuery(settings.reportingCurrency),
    );
    const latest = months.findLast((month) => month.coverage !== "missing")?.month;
    if (latest && latest < currentMonth(settings.timezone))
      throw redirect({
        href: `${location.pathname}${defaultStringifySearch({ ...location.search, period: latest })}`,
      });
  },
  loader: async ({ context }) => {
    const settings = await context.queryClient.ensureQueryData(settingsQueryOptions());
    await Promise.all([
      context.queryClient.ensureQueryData(monthlyFlowQuery(settings.reportingCurrency)),
      context.queryClient.ensureQueryData(questionsQuery(settings.reportingCurrency)),
    ]);
  },
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Ironcage" },
      { name: "description", content: "Where your money came from, where it went, and why." },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  shellComponent: RootDocument,
  component: Layout,
  errorComponent: RouteError,
});

function Layout() {
  const { data: settings } = useSuspenseQuery(settingsQueryOptions());
  const months = useQuery(monthlyFlowQuery(settings.reportingCurrency)).data ?? [];
  const questions = useQuery(questionsQuery(settings.reportingCurrency)).data ?? [];
  const period = resolvePeriodKey(Route.useSearch().period, settings.timezone);
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const showStrip = readsPeriod(pathname);
  return (
    <>
      <a
        href="#main"
        className="sr-only rounded-md bg-sheet p-3 focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50"
      >
        Skip to content
      </a>
      <TopBar questionCount={questions.length} />
      <Recalculating />
      {showStrip && months.length > 0 && <PeriodStrip months={months} period={period} />}
      <main id="main" className="mx-auto max-w-[1280px] px-5 py-8 md:px-8 md:py-10">
        <Outlet />
      </main>
    </>
  );
}

function RootDocument({ children }: { readonly children: React.ReactNode }) {
  return (
    <html lang="en-AU">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
