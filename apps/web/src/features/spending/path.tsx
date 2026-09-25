import type { ScopeCrumb } from "@repo/contracts/finance";
import { Link } from "@tanstack/react-router";
import { Fragment } from "react";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { everything } from "@/lib/scope";

import { type Narrowing, spendingSearch } from "./search";

// The crumbs from all spending, named `first`, down to a scope. Each opens that level of
// Spending narrowed by the same tag or personal event, and the one already open is marked
// as the current page.
export function SpendingPath({
  label,
  first,
  path,
  narrowing,
}: {
  label: string;
  first: string;
  path: readonly ScopeCrumb[];
  narrowing: Narrowing;
}) {
  return (
    <Breadcrumb aria-label={label}>
      <BreadcrumbList>
        {[{ label: first, opens: everything }, ...path].map((crumb, index) => (
          <Fragment key={index}>
            {index > 0 && <BreadcrumbSeparator />}
            <BreadcrumbItem className="type-small">
              <BreadcrumbLink
                render={
                  <Link
                    to="/spending"
                    search={spendingSearch(crumb.opens, narrowing)}
                    activeOptions={{ exact: true }}
                  />
                }
                className="rounded-sm data-[status=active]:text-foreground"
              >
                {crumb.label}
              </BreadcrumbLink>
            </BreadcrumbItem>
          </Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
