import type { AccountKind, Descriptor, Institution } from "@repo/contracts/finance";

import { commbankProfileVersion, describeCommBank } from "./commbank.ts";

export type DescriptorProfile = {
  // Bump when `describe` reads a description differently; stored descriptors from an
  // older version are recomputed.
  readonly version: number;
  readonly describe: (posting: {
    description: string;
    amountMinor: bigint;
    accountKind: typeof AccountKind.Type;
  }) => Descriptor;
};

// How each institution's descriptions read. A posting uses its account's institution.
export const descriptorProfiles = {
  commbank: { version: commbankProfileVersion, describe: describeCommBank },
} satisfies Record<Institution, DescriptorProfile>;
