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
] as const;

export function TopBar({ questionCount }: { questionCount: number }) {
  const [open, setOpen] = useState(false);
  return (
    <header className="border-b border-rule">
      <div className="mx-auto flex h-14 max-w-[1280px] items-center gap-8 px-5 md:px-8">
        <Link to="/" className="text-[1.0625rem] font-[720] tracking-[-0.02em] [font-stretch:125%]">
          ironcage
        </Link>
        <nav aria-label="Main" className="hidden h-full items-stretch gap-6 md:flex">
          {destinations.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              activeOptions={{ exact: "exact" in item, includeSearch: false }}
              className="flex items-center border-b-2 border-transparent pt-0.5 text-slate hover:text-intaglio"
              activeProps={{ className: "border-intaglio text-intaglio font-[560]" }}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <Link
            to="/questions"
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-slate hover:text-intaglio"
            activeProps={{ className: "text-intaglio font-[560]" }}
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
            className="hidden rounded-md p-1.5 text-slate hover:text-intaglio md:block"
            activeProps={{ className: "text-intaglio" }}
          >
            <Settings className="size-4.5" aria-hidden />
          </Link>
          <Button
            variant="outline"
            size="sm"
            className="hidden md:inline-flex"
            nativeButton={false}
            render={<Link to="/sources" />}
          >
            Upload
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="md:hidden"
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
        <nav id="mobile-navigation" aria-label="Main" className="border-t border-rule md:hidden">
          <ul className="mx-auto grid max-w-[1280px] px-5 py-2">
            {destinations.map((item) => (
              <li key={item.to}>
                <Link
                  to={item.to}
                  onClick={() => setOpen(false)}
                  activeOptions={{ exact: "exact" in item, includeSearch: false }}
                  className="block py-2.5 text-slate"
                  activeProps={{ className: "text-intaglio font-[560]" }}
                >
                  {item.label}
                </Link>
              </li>
            ))}
            <li>
              <Link
                to="/settings"
                onClick={() => setOpen(false)}
                className="block py-2.5 text-slate"
                activeProps={{ className: "text-intaglio font-[560]" }}
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
