import { useId } from "react";

// NetBank's labels, as CommBank's help pages name them. The export dialog lists formats
// by program, and Microsoft Money is the one that saves an OFX file.
const sections = [
  {
    title: "Recent transactions, as CSV and OFX",
    lead: "NetBank shows two years of transactions. Export each date range twice, once as CSV and once as OFX. The OFX tells Ironcage which account it is. For bank accounts and loans, the CSV also has the balance after every transaction, so Ironcage can check that none are missing. A transaction in both files is recorded once.",
    steps: [
      "Log on to NetBank and choose the account.",
      "Use Advanced search above the transaction list to choose the dates.",
      "Select Export, choose Comma Separated Values (CSV), then select Export transactions.",
      "Select Export again, choose Microsoft Money for the OFX file, then select Export transactions.",
    ],
    note: "One search or export holds up to 600 transactions, so export a busy account a few months at a time. The date ranges can overlap.",
  },
  {
    title: "Older history, as PDF statements",
    lead: "NetBank keeps up to seven years of statements, so they reach further back than exports. Each one prints its opening and closing balances, which lets Ironcage check that nothing is missing. For a credit card, whose exports have no balances, statements are the only balance check.",
    steps: [
      "Log on to NetBank and choose View accounts, then Statements. Some versions of NetBank have View statements on the home page instead.",
      "Select the account.",
      "Select the statements you want, then select Download.",
    ],
    note: "The same page can create a transaction summary for a date range. Ironcage reads statements, not summaries.",
  },
] as const;

// A guide under a section heading of its own reads as part of that section.
const headingStyles = { h2: "type-heading", h3: "font-[600]" };

// Which files to download from NetBank, and how.
export function NetBankGuide({ heading: Heading }: { heading: keyof typeof headingStyles }) {
  const id = useId();
  return (
    <div className="space-y-8">
      {sections.map((section, index) => (
        <section
          key={section.title}
          aria-labelledby={`${id}-${index}`}
          className="max-w-[72ch] space-y-3"
        >
          <Heading id={`${id}-${index}`} className={headingStyles[Heading]}>
            {section.title}
          </Heading>
          <p>{section.lead}</p>
          <ol className="list-decimal space-y-1 pl-5 marker:text-slate marker:tabular-nums">
            {section.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <p className="type-small text-slate">{section.note}</p>
        </section>
      ))}
    </div>
  );
}
