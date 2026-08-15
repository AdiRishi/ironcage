import type { RecurringCharge } from "@ironcage/contracts/schema";
import type {
  BankAccountId,
  BankTransactionId,
  CalendarDate,
  CategoryId,
  CategoryKind,
} from "@ironcage/domain";
import type { BigDecimal } from "effect";

export const analysisConfig = {
  recurringWindowDays: 400,
  recurringMinOccurrences: 3,
  recurringAmountTolerance: "0.05",
  recurringGapDeviation: "0.2",
  cadenceBuckets: [
    { days: 7, tolerance: 2 },
    { days: 14, tolerance: 3 },
    { days: 30, tolerance: 4 },
    { days: 91, tolerance: 7 },
    { days: 365, tolerance: 10 },
  ],
  priceChangeMinRatio: "0.01",
  priceChangeMinAmount: "1.00",
  largeExpenseFloor: "500",
  largeExpenseMultiple: "4",
  largeExpenseMedianDays: 90,
  newPayeeLookbackDays: 730,
  newPayeeMinAmount: "200",
  spikeMultiple: "1.5",
  spikeMinExcess: "150",
  steadyChargeAnnualFloor: "120",
} as const;

export interface SplitLine {
  readonly transactionId: BankTransactionId;
  readonly accountId: BankAccountId;
  readonly postedDate: CalendarDate;
  readonly payee: string;
  readonly categoryId: CategoryId;
  readonly categoryName: string;
  readonly kind: CategoryKind;
  readonly amount: BigDecimal.BigDecimal;
}

export interface RecurringGroup extends RecurringCharge {
  readonly transactionIds: readonly BankTransactionId[];
}
