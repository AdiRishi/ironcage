import { useQuery } from "@tanstack/react-query";

import type { SurfaceTab } from "@/components/shell/nav";
import { reviewQuery } from "@/features/money/queries";

type CountKey = NonNullable<SurfaceTab["count"]>;

/**
 * The live counts a tab strip can print. Each source query is enabled only
 * while a tab in the current strip asks for it, so a section pays for no
 * count it does not show; hook order stays fixed regardless.
 */
export function useTabCounts(
  tabs: readonly SurfaceTab[],
): Partial<Record<CountKey, number | undefined>> {
  const wantsReview = tabs.some((tab) => tab.count === "moneyReview");
  const review = useQuery({ ...reviewQuery, enabled: wantsReview });

  return { moneyReview: wantsReview ? review.data?.length : undefined };
}
