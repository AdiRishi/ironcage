import { Tabs, TabsList, TabsTrigger } from "@ironcage/ui/components/tabs";
import { Link, useRouterState } from "@tanstack/react-router";

/**
 * A sleeve's sub-navigation.
 *
 * This cannot come from the shell's static nav manifest, because every
 * destination needs the sleeve id. Selection is matched on the route id rather
 * than the pathname for the same reason: `/sleeves/$sleeveId/mandate` is the
 * stable identity, while the pathname carries whichever sleeve is open.
 */
const SLEEVE_TABS = [
  // `to` and `routeId` differ for Now: the index route's id keeps its trailing
  // slash, while the path you navigate to does not.
  { label: "Now", to: "/sleeves/$sleeveId", routeId: "/sleeves/$sleeveId/" },
  {
    label: "Capabilities",
    to: "/sleeves/$sleeveId/capabilities",
    routeId: "/sleeves/$sleeveId/capabilities",
  },
  {
    label: "Positions",
    to: "/sleeves/$sleeveId/positions",
    routeId: "/sleeves/$sleeveId/positions",
  },
  {
    label: "Performance",
    to: "/sleeves/$sleeveId/performance",
    routeId: "/sleeves/$sleeveId/performance",
  },
  {
    label: "Decisions",
    to: "/sleeves/$sleeveId/decisions",
    routeId: "/sleeves/$sleeveId/decisions",
  },
  { label: "Mandate", to: "/sleeves/$sleeveId/mandate", routeId: "/sleeves/$sleeveId/mandate" },
  { label: "Trial", to: "/sleeves/$sleeveId/trial", routeId: "/sleeves/$sleeveId/trial" },
] as const;

export function SleeveTabs({ sleeveId }: { sleeveId: string }) {
  const activeRouteId = useRouterState({
    select: (state) => state.matches.at(-1)?.routeId ?? "",
  });

  return (
    <Tabs value={activeRouteId}>
      <TabsList variant="line">
        {SLEEVE_TABS.map((tab) => (
          // See the note in `components/shell/surface-tabs.tsx`: these render
          // as anchors, so they are not native buttons.
          <TabsTrigger
            key={tab.routeId}
            value={tab.routeId}
            nativeButton={false}
            render={<Link to={tab.to} params={{ sleeveId }} />}
          >
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
