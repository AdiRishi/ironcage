import type { StructuredTextItem } from "unpdf";

export type PdfText = Pick<StructuredTextItem, "str" | "x" | "y" | "width" | "height">;
export type PdfPage = ReadonlyArray<PdfText>;
export const text = (items: PdfPage) =>
  items
    .map((item) => item.str)
    .join(" ")
    .trim();
export function lines(items: PdfPage): PdfText[][] {
  const result: PdfText[][] = [];
  for (const item of [...items]
    .filter((item) => item.str.trim())
    .sort((a, b) => b.y - a.y || a.x - b.x)) {
    const line = result.find((line) => Math.abs(line[0]!.y - item.y) < 2);
    if (line) line.push(item);
    else result.push([item]);
  }
  return result.map((line) => line.sort((a, b) => a.x - b.x));
}
export const bounds = (items: PdfPage): [number, number, number, number] => {
  const left = Math.min(...items.map((item) => item.x));
  const bottom = Math.min(...items.map((item) => item.y));
  return [
    left,
    bottom,
    Math.max(...items.map((item) => item.x + item.width)) - left,
    Math.max(...items.map((item) => item.y + item.height)) - bottom,
  ];
};
