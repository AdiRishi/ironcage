import { useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { accountsQueryOptions } from "@/features/accounts/queries";
import { AccountsSection } from "@/features/accounts/section";

import { AccountPeriodsSection } from "../accounts/periods";
import { EnrichmentSection } from "../enrichment/settings";
import { DisplaySettings } from "./display-settings";
import { ModelUsageSection } from "./model-usage";
import { settingsQueryOptions, retentionQueryOptions } from "./queries";

export function SettingsPage() {
  const { data: accounts } = useSuspenseQuery(accountsQueryOptions());
  const { data: retention } = useSuspenseQuery(retentionQueryOptions());
  const { data: settings } = useSuspenseQuery(settingsQueryOptions());
  return (
    <div className="max-w-4xl space-y-12">
      <header>
        <h1 className="type-title">Settings</h1>
        <p className="mt-1 text-slate">How Ironcage reads your accounts and names your money.</p>
      </header>
      <nav aria-label="Interpretation settings" className="grid gap-3 sm:grid-cols-2">
        <Link
          to="/settings/categories"
          className="rounded-lg border border-rule bg-sheet p-4 hover:border-intaglio/40"
        >
          <span className="block font-[600]">Categories</span>
          <span className="mt-1 block type-small text-slate">
            The two levels spending and income sort into, plus tags and personal events.
          </span>
        </Link>
        <Link
          to="/settings/rules"
          className="rounded-lg border border-rule bg-sheet p-4 hover:border-intaglio/40"
        >
          <span className="block font-[600]">Rules</span>
          <span className="mt-1 block type-small text-slate">
            Standing instructions that win over the model and the bank.
          </span>
        </Link>
      </nav>
      <AccountsSection accounts={accounts} />
      <AccountPeriodsSection accounts={accounts} />
      <EnrichmentSection />
      <ModelUsageSection />
      <section aria-labelledby="display-heading" className="space-y-4">
        <h2 id="display-heading" className="type-heading">
          Display
        </h2>
        <DisplaySettings settings={settings} />
      </section>
      <section aria-labelledby="backups-heading" className="space-y-2">
        <h2 id="backups-heading" className="type-heading">
          Backups and original files
        </h2>
        <p className="type-small text-slate">{retention.database}</p>
        <p className="type-small break-words text-slate">{retention.originals}</p>
        <p className="type-small text-slate">
          Removing live data does not remove it from retained backups.
        </p>
      </section>
    </div>
  );
}
