import type { CandidateEffect } from "@ironcage/contracts/schema";
import type { BankTransactionId, Sha256, SourceProfile } from "@ironcage/domain";
import type { BigDecimal } from "effect";

import type { AccountRow } from "../accounts/repository";
import type { EffectiveRule } from "../categorization/rules";
import type { PairedBundle } from "./bundle";
import type { ParsedStatement, StatementRow } from "./commbank-offset-statement";
import type { CoveredSpan } from "./coverage";
import type { MatchOutcome } from "./matching";
import type { ImportRow } from "./repository";

export const statementProfileName = "cba-offset-statement-v1" as const;

export interface StatementExtraction {
  readonly markdown: string;
  readonly extractor: {
    readonly package: "@firecrawl/anydoc";
    readonly version: "0.1.7";
  };
}

export interface ImportDependencies {
  readonly identityKey: string;
  readonly extractStatement: (pdf: Uint8Array) => Promise<StatementExtraction>;
}

export interface PreparedSourceFile {
  readonly role: "csv" | "ofx" | "pdf" | "extracted_markdown";
  readonly bytes: Uint8Array;
  readonly displayName: string;
  readonly digest: Sha256;
  readonly mediaType: string;
  readonly extractor: StatementExtraction["extractor"] | null;
}

export interface StatementMatch {
  readonly row: StatementRow;
  readonly transactionId: BankTransactionId | null;
}

export type ImportPlan =
  | {
      readonly kind: "structured";
      readonly bundle: PairedBundle;
      readonly outcomes: readonly MatchOutcome[];
    }
  | {
      readonly kind: "statement";
      readonly statement: ParsedStatement;
      readonly matches: readonly StatementMatch[];
    };

interface PreparedImportBase {
  readonly account: AccountRow;
  readonly digest: Sha256;
  readonly profile: SourceProfile;
  readonly files: readonly PreparedSourceFile[];
}

export interface ReplayedImport extends PreparedImportBase {
  readonly kind: "replay";
  readonly import: ImportRow;
}

export interface PendingImport extends PreparedImportBase {
  readonly kind: "pending";
  readonly plan: ImportPlan;
  readonly window: CoveredSpan;
  readonly identityHmac: string;
  readonly maskedSuffix: string;
  readonly candidates: readonly CandidateEffect[];
  readonly ruleHits: ReadonlyMap<number, EffectiveRule>;
  readonly coverage: {
    readonly segment: CoveredSpan;
    readonly added: readonly CoveredSpan[];
    readonly overlapRetained: readonly CoveredSpan[];
    readonly gapsBefore: readonly CoveredSpan[];
    readonly gapsRemaining: readonly CoveredSpan[];
  };
  readonly balances: {
    readonly ledger: BigDecimal.BigDecimal | null;
    readonly available: BigDecimal.BigDecimal | null;
    readonly ledgerReconciled: boolean;
  };
  readonly warnings: readonly string[];
  readonly fingerprint: Sha256;
}

export type PreparedImport = ReplayedImport | PendingImport;
