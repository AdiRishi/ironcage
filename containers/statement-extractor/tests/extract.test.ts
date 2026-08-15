import { expect, test } from "vitest";

import { extractStatement } from "../src/extract";

const minimalPdf = (): Uint8Array => {
  const content = "BT /F1 12 Tf 72 720 Td (EXTRACTOR FIXTURE LINE) Tj ET";
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n",
    `4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`,
    "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
  ];
  const header = "%PDF-1.4\n";
  const offsets: number[] = [];
  let position = header.length;
  for (const object of objects) {
    offsets.push(position);
    position += object.length;
  }
  const xref =
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${position}\n%%EOF\n`;

  return new TextEncoder().encode(header + objects.join("") + xref + trailer);
};

test("extracts text with the pinned native AnyDoc build", async () => {
  const result = await extractStatement(minimalPdf());

  expect(result.extractor).toEqual({ package: "@firecrawl/anydoc", version: "0.1.7" });
  expect(result.markdown).toContain("EXTRACTOR FIXTURE LINE");
});
