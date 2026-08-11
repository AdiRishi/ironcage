import { SystemPing } from "@ironcage/contracts/schema";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@ironcage/ui/components/item";
import { Skeleton } from "@ironcage/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { DateTime, Schema } from "effect";

import { getSystemPing } from "@/server/core";

/**
 * The one live thing on Overview: proof that the app Worker can still reach
 * core over its service binding.
 *
 * This is a system fact, not a product read, so it is safe to render before
 * `Observed<A>` exists. Every financial value that lands on this surface later
 * has to arrive wrapped, per `docs/technical/11-app.md` §2.
 */
export function CoreBindingProbe() {
  const core = useQuery({
    queryKey: ["vitals"],
    queryFn: () => getSystemPing(),
    // The server function returns the encoded form.
    select: Schema.decodeSync(SystemPing),
  });

  return (
    <ItemGroup className="rounded-xl border">
      <Item variant="default">
        <ItemContent>
          <ItemTitle className="font-mono text-xs tracking-widest text-muted-foreground">
            CORE BINDING
          </ItemTitle>
          {core.isPending ? (
            <Skeleton className="h-4 w-64" />
          ) : core.isError ? (
            <ItemDescription className="text-destructive">{String(core.error)}</ItemDescription>
          ) : (
            <ItemDescription className="font-mono">
              {core.data.worker} · {core.data.surface} · as of{" "}
              {DateTime.formatIso(core.data.serverTime)}
            </ItemDescription>
          )}
        </ItemContent>
      </Item>
    </ItemGroup>
  );
}
