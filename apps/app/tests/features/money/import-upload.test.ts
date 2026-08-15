import { BankAccountId, RequestId, Sha256 } from "@ironcage/domain";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  confirmUpload,
  decodeConfirmUpload,
  decodePreviewUpload,
  previewUpload,
} from "@/features/money/import-upload";

const accountId = Schema.decodeUnknownSync(BankAccountId)("01900000-0000-7000-8000-000000000001");
const requestId = Schema.decodeUnknownSync(RequestId)("01900000-0000-7000-8000-000000000002");
const digest = Schema.decodeUnknownSync(Sha256)("a".repeat(64));

describe("bank import upload transport", () => {
  it("moves files through FormData without a base64 transport copy", async () => {
    const csv = new File([Uint8Array.of(1, 2, 3)], "transactions.csv", { type: "text/csv" });
    const ofx = new File([Uint8Array.of(4, 5, 6)], "transactions.ofx");
    const source = { kind: "commbank_structured", accountId, csv, ofx } as const;

    const form = previewUpload(source);

    expect(form.get("csv")).toBe(csv);
    expect(form.get("ofx")).toBe(ofx);
    await expect(decodePreviewUpload(form)).resolves.toEqual({
      kind: "commbank_structured",
      accountId,
      csv: { displayName: csv.name, bytes: Uint8Array.of(1, 2, 3) },
      ofx: { displayName: ofx.name, bytes: Uint8Array.of(4, 5, 6) },
    });
  });

  it("round-trips confirmation metadata with the original files", async () => {
    const pdf = new File([Uint8Array.of(7, 8, 9)], "statement.pdf", {
      type: "application/pdf",
    });

    const payload = await decodeConfirmUpload(
      confirmUpload({
        source: { kind: "commbank_statement", accountId, pdf },
        expectedBundleDigest: digest,
        expectedPreviewFingerprint: digest,
        resolutions: [],
        requestId,
      }),
    );

    expect(payload).toEqual({
      source: {
        kind: "commbank_statement",
        accountId,
        pdf: { displayName: pdf.name, bytes: Uint8Array.of(7, 8, 9) },
      },
      expectedBundleDigest: digest,
      expectedPreviewFingerprint: digest,
      resolutions: [],
      requestId,
    });
  });
});
