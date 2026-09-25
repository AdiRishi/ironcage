import { useSuspenseInfiniteQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { buttonVariants } from "@/components/ui/button";
import { NetBankGuide } from "@/features/imports/netbank-guide";
import { PendingImports } from "@/features/imports/pending-imports";
import { importsQueryOptions } from "@/features/imports/queries";
import { useImportCompletion } from "@/features/imports/use-import-completion";

// The overview until the first file has imported: the files uploaded so far, which files
// to download from NetBank, and the way to Sources to upload them.
export function FirstUse({ timezone }: { timezone: string }) {
  const history = useSuspenseInfiniteQuery(importsQueryOptions());
  const imports = history.data.pages.flatMap((page) => page.rows);
  useImportCompletion(imports);
  return (
    <div className="max-w-4xl space-y-12">
      <header className="max-w-[72ch] space-y-2">
        <h1 className="type-title">Start with your NetBank files</h1>
        <p>
          Every number in Ironcage comes from files you download from CommBank NetBank. For each
          account, download recent transactions as CSV and OFX, and statements as PDF. Then upload
          them on Sources.
        </p>
      </header>
      <PendingImports
        imports={imports}
        timezone={timezone}
        heading="Your files so far"
        description="The overview fills in once a file finishes importing."
      />
      <NetBankGuide heading="h2" />
      <section aria-labelledby="upload-heading" className="max-w-[72ch] space-y-3">
        <h2 id="upload-heading" className="type-heading">
          Upload them
        </h2>
        <p>
          Upload the OFX files and statements first. They name their account, so Ironcage adds it
          for you. Then upload each CSV and choose its account, because a CSV does not say which
          account it came from.
        </p>
        <Link to="/sources" className={buttonVariants()}>
          Upload files
        </Link>
      </section>
    </div>
  );
}
