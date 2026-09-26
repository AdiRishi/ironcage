import { Link } from "@tanstack/react-router";
import { Menu, Settings, X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

const destinations = [
  { to: "/", label: "Overview", exact: true },
  { to: "/spending", label: "Spending" },
  { to: "/ledger", label: "Ledger" },
  { to: "/counterparties", label: "Counterparties" },
  { to: "/sources", label: "Sources" },
  { to: "/analyst", label: "Analyst" },
] as const;

export function TopBar({ questionCount }: { questionCount: number }) {
  const [open, setOpen] = useState(false);
  return (
    <header className="border-b border-rule">
      <div className="mx-auto flex h-14 max-w-[1280px] items-center gap-8 px-5 md:px-8">
        <Link to="/" className="text-[1.0625rem] font-[720] tracking-[-0.02em] [font-stretch:125%]">
          ironcage
        </Link>
        <nav aria-label="Main" className="hidden h-full items-stretch gap-6 lg:flex">
          {destinations.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              activeOptions={{ exact: "exact" in item, includeSearch: false }}
              className="flex items-center border-b-2 pt-0.5 hover:text-intaglio"
              activeProps={{ className: "border-intaglio text-intaglio font-[560]" }}
              inactiveProps={{ className: "border-transparent text-slate" }}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <Link
            to="/questions"
            className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:text-intaglio"
            activeProps={{ className: "text-intaglio font-[560]" }}
            inactiveProps={{ className: "text-slate" }}
          >
            Questions
            {questionCount > 0 && (
              <span className="rounded-full border border-attention px-1.5 type-small text-attention tabular">
                {questionCount}
                <span className="sr-only"> open</span>
              </span>
            )}
          </Link>
          <Link
            to="/settings"
            aria-label="Settings"
            title="Settings"
            className="hidden rounded-md p-1.5 hover:text-intaglio lg:block"
            activeProps={{ className: "text-intaglio" }}
            inactiveProps={{ className: "text-slate" }}
          >
            <Settings className="size-4.5" aria-hidden />
          </Link>
          <Button
            variant="outline"
            size="sm"
            className="hidden lg:inline-flex"
            nativeButton={false}
            render={<Link to="/sources" />}
          >
            Upload
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="lg:hidden"
            aria-expanded={open}
            aria-controls="mobile-navigation"
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? <X /> : <Menu />}
          </Button>
        </div>
      </div>
      {open && (
        <nav id="mobile-navigation" aria-label="Main" className="border-t border-rule lg:hidden">
          <ul className="mx-auto grid max-w-[1280px] px-5 py-2">
            {destinations.map((item) => (
              <li key={item.to}>
                <Link
                  to={item.to}
                  onClick={() => setOpen(false)}
                  activeOptions={{ exact: "exact" in item, includeSearch: false }}
                  className="block py-2.5"
                  activeProps={{ className: "text-intaglio font-[560]" }}
                  inactiveProps={{ className: "text-slate" }}
                >
                  {item.label}
                </Link>
              </li>
            ))}
            <li>
              <Link
                to="/settings"
                onClick={() => setOpen(false)}
                className="block py-2.5"
                activeProps={{ className: "text-intaglio font-[560]" }}
                inactiveProps={{ className: "text-slate" }}
              >
                Settings
              </Link>
            </li>
          </ul>
        </nav>
      )}
    </header>
  );
}
