import type { Import } from "@repo/contracts/finance";
import { useId } from "react";

import { ImportRecord } from "./import-record";

// Files still processing, waiting on you, or failed, each with its next action.
export function PendingImports({
  imports,
  timezone,
  heading,
  description,
}: {
  imports: readonly Import[];
  timezone: string;
  heading: string;
  description?: string;
}) {
  const id = useId();
  const pending = imports.filter((item) => item.status !== "complete");
  if (pending.length === 0) return null;
  return (
    <section aria-labelledby={id} className="space-y-3">
      <div>
        <h2 id={id} className="type-heading">
          {heading}
        </h2>
        {description && <p className="mt-1 type-small text-slate">{description}</p>}
      </div>
      <ul className="divide-y divide-rule rounded-lg border border-rule bg-sheet">
        {pending.map((item) => (
          <ImportRecord key={item.id} item={item} timezone={timezone} />
        ))}
      </ul>
    </section>
  );
}
