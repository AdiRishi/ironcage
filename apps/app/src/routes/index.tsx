import { SystemPing } from "@ironcage/contracts/schema";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { DateTime, Schema } from "effect";

import { getSystemPing } from "@/server/core";

export const Route = createFileRoute("/")({ component: Overview });

function Overview() {
  const core = useQuery({
    queryKey: ["vitals"],
    queryFn: () => getSystemPing(),
    // The server function returns the encoded form.
    select: Schema.decodeSync(SystemPing),
  });

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col gap-6 px-6 py-10">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Ironcage</h1>
        <p className="text-sm text-muted-foreground">
          The observatory holds no state. Everything it shows arrives from core.
        </p>
      </header>

      <dl className="rounded-lg border px-4 py-3 text-sm">
        {core.isPending ? (
          <p className="text-muted-foreground">Asking core…</p>
        ) : core.isError ? (
          <p className="font-mono text-xs">{String(core.error)}</p>
        ) : (
          <div className="grid grid-cols-[8rem_1fr] gap-y-2 font-mono text-xs">
            <dt className="text-muted-foreground">worker</dt>
            <dd>{core.data.worker}</dd>
            <dt className="text-muted-foreground">surface</dt>
            <dd>{core.data.surface}</dd>
            <dt className="text-muted-foreground">as of</dt>
            <dd>{DateTime.formatIso(core.data.serverTime)}</dd>
          </div>
        )}
      </dl>
    </main>
  );
}
