import { Schema } from "effect";

/**
 * A name-based UUID derived from the capability, its configuration version,
 * and the trigger anchor it answers — a cadence slot or a batch identity — so
 * a re-dispatched run collides with its earlier self instead of arriving as a
 * fresh identity.
 */
export const RunId = Schema.String.check(Schema.isUUID(5)).pipe(Schema.brand("RunId"));
export type RunId = typeof RunId.Type;

// The package's lib is runtime-neutral ESNext; these two globals exist in
// every runtime that executes this code (workerd, Node, browsers).
declare const TextEncoder: new () => { encode(input: string): Uint8Array };
declare const crypto: {
  readonly subtle: { digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer> };
};

/** The fixed namespace every Ironcage run identity hashes under. */
const runIdNamespace = "6ba7b811-9dad-11d1-80b4-00c04fd430c8";

const namespaceBytes = Uint8Array.from(
  runIdNamespace
    .replace(/-/g, "")
    .match(/.{2}/g)!
    .map((pair) => Number.parseInt(pair, 16)),
);

/**
 * UUIDv5 over `capability|configVersion|anchor`. The producer and any
 * re-dispatch derive the same identity, which is what lets the consumer's
 * dedupe boundary treat a duplicate delivery as exactly that.
 */
export const deriveRunId = async (
  capability: string,
  configVersion: number,
  anchor: string,
): Promise<RunId> => {
  const name = new TextEncoder().encode(`${capability}|${configVersion}|${anchor}`);
  const input = new Uint8Array(namespaceBytes.length + name.length);
  input.set(namespaceBytes);
  input.set(name, namespaceBytes.length);

  const digest = new Uint8Array(await crypto.subtle.digest("SHA-1", input)).slice(0, 16);
  digest[6] = (digest[6]! & 0x0f) | 0x50;
  digest[8] = (digest[8]! & 0x3f) | 0x80;

  const hex = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
  const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  return Schema.decodeUnknownSync(RunId)(uuid);
};
