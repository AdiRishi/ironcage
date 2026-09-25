import { Link, useRouterState } from "@tanstack/react-router";

import { buttonVariants } from "@/components/ui/button";
import { unreadable } from "@/lib/address";

// The page for an address that names nothing. One whose path or search values do not
// decode says so, because it was edited or cut short rather than left behind.
export function NotFound() {
  const edited = useRouterState({ select: (state) => state.matches.some(unreadable) });
  return (
    <div className="max-w-[72ch] space-y-4">
      <h1 className="type-title">
        {edited
          ? "This address has a value Ironcage cannot read"
          : "There is no page at this address"}
      </h1>
      <p className="text-slate">
        {edited
          ? "It may have been typed by hand or cut short. Start again from the overview."
          : "It may have a typing mistake, or name something that no longer exists. Start again from the overview."}
      </p>
      <Link
        to="/"
        search={{ period: undefined, compare: undefined }}
        className={buttonVariants({ variant: "outline" })}
      >
        Open the overview
      </Link>
    </div>
  );
}
