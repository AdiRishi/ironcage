import { useQuery } from "@tanstack/react-query";

import type { SurfaceTab } from "@/components/shell/nav";
import { ledgerQuery } from "@/features/money/queries";

type CountKey = NonNullable<SurfaceTab["count"]>;

/**
 * The live counts a tab strip can print. Each source query is enabled only
 * while a tab in the current strip asks for it, so a section pays for no
 * count it does not show; hook order stays fixed regardless.
 */
export function useTabCounts(
  tabs: readonly SurfaceTab[],
): Partial<Record<CountKey, number | undefined>> {
  const wantsAttention = tabs.some((tab) => tab.count === "moneyAttention");
  const attention = useQuery({ ...ledgerQuery({ kind: "attention" }), enabled: wantsAttention });

  return {
    moneyAttention: wantsAttention
      ? attention.data?.filter((entry) => entry.filedBy === "system").length
      : undefined,
  };
}
