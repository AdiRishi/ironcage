import { Badge } from "@ironcage/ui/components/badge";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@ironcage/ui/components/empty";
import { useRouterState } from "@tanstack/react-router";
import { CompassIcon } from "lucide-react";

import { activeSection } from "@/components/shell/nav";
import { SurfaceTabs } from "@/components/shell/surface-tabs";

/**
 * What an unbuilt surface renders.
 *
 * It names the surface, says what will live there, and cites the product
 * document that specifies it. It shows no figures at all — not even plausible
 * ones. `docs/technical/11-app.md` guarantees that no value renders as current
 * without freshness evidence, and a placeholder full of invented numbers is
 * the cheapest possible way to break that on day one.
 */
export function PagePlaceholder({
  title,
  description,
  doc,
}: {
  readonly title: string;
  readonly description: string;
  /** The product document that specifies this surface. */
  readonly doc: string;
}) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { tabs } = activeSection(pathname);

  return (
    <>
      <SurfaceTabs tabs={tabs} />
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CompassIcon />
          </EmptyMedia>
          <EmptyTitle>{title}</EmptyTitle>
          <EmptyDescription>{description}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Badge variant="outline" className="font-mono">
            {doc}
          </Badge>
        </EmptyContent>
      </Empty>
    </>
  );
}
