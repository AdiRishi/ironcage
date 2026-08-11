import { BankAccountProfileId, BankIdentity, Sha256 } from "@ironcage/domain";
import { Context, Effect, Layer, Schema } from "effect";

export class MoneyCryptoError extends Schema.TaggedError<MoneyCryptoError>()("MoneyCryptoError", {
  operation: Schema.String,
  cause: Schema.Defect(),
}) {}

const bytesToHex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

const decodeSha256 = Schema.decodeUnknownSync(Sha256);

const accountIdentityMaterial = (profile: BankAccountProfileId, identity: BankIdentity) =>
  identity.messageSet === "bank"
    ? ["commbank", profile, identity.bankId, identity.accountId].join("\u0000")
    : ["commbank", profile, identity.accountId].join("\u0000");

export class MoneyCryptography extends Context.Service<
  MoneyCryptography,
  {
    readonly sha256: (bytes: Uint8Array) => Effect.Effect<Sha256, MoneyCryptoError>;
    readonly accountIdentityHmac: (
      profile: BankAccountProfileId,
      identity: BankIdentity,
    ) => Effect.Effect<Sha256, MoneyCryptoError>;
    readonly randomUuidV7: Effect.Effect<string, MoneyCryptoError>;
  }
>()("ironcage/core/money/MoneyCryptography") {
  static layer(identityKey: string) {
    const identityKeyBytes = new TextEncoder().encode(identityKey);

    return Layer.succeed(
      MoneyCryptography,
      MoneyCryptography.of({
        sha256: (bytes) =>
          Effect.tryPromise({
            try: () => crypto.subtle.digest("SHA-256", bytes),
            catch: (cause) => new MoneyCryptoError({ operation: "sha256", cause }),
          }).pipe(Effect.map((digest) => decodeSha256(bytesToHex(new Uint8Array(digest))))),
        accountIdentityHmac: (profile, identity) =>
          identityKeyBytes.byteLength < 32
            ? Effect.fail(
                new MoneyCryptoError({
                  operation: "account_identity_hmac",
                  cause: new Error("MONEY_IDENTITY_KEY must contain at least 32 bytes"),
                }),
              )
            : Effect.tryPromise({
                try: async () => {
                  const key = await crypto.subtle.importKey(
                    "raw",
                    identityKeyBytes,
                    { name: "HMAC", hash: "SHA-256" },
                    false,
                    ["sign"],
                  );
                  return crypto.subtle.sign(
                    "HMAC",
                    key,
                    new TextEncoder().encode(accountIdentityMaterial(profile, identity)),
                  );
                },
                catch: (cause) =>
                  new MoneyCryptoError({ operation: "account_identity_hmac", cause }),
              }).pipe(Effect.map((digest) => decodeSha256(bytesToHex(new Uint8Array(digest))))),
        randomUuidV7: Effect.clockWith((clock) =>
          Effect.try({
            try: () => {
              const bytes = crypto.getRandomValues(new Uint8Array(16));
              const timestamp = clock.currentTimeMillisUnsafe();

              bytes[0] = Math.floor(timestamp / 2 ** 40);
              bytes[1] = Math.floor(timestamp / 2 ** 32) & 0xff;
              bytes[2] = Math.floor(timestamp / 2 ** 24) & 0xff;
              bytes[3] = Math.floor(timestamp / 2 ** 16) & 0xff;
              bytes[4] = Math.floor(timestamp / 2 ** 8) & 0xff;
              bytes[5] = timestamp & 0xff;
              bytes[6] = (bytes[6]! & 0x0f) | 0x70;
              bytes[8] = (bytes[8]! & 0x3f) | 0x80;

              return [
                bytes.subarray(0, 4),
                bytes.subarray(4, 6),
                bytes.subarray(6, 8),
                bytes.subarray(8, 10),
                bytes.subarray(10, 16),
              ]
                .map(bytesToHex)
                .join("-");
            },
            catch: (cause) => new MoneyCryptoError({ operation: "random_uuid_v7", cause }),
          }),
        ),
      }),
    );
  }
}

export type CanonicalValue =
  | null
  | boolean
  | number
  | string
  | CanonicalValue[]
  | { readonly [key: string]: CanonicalValue };

export const canonicalJson = (value: CanonicalValue): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;

  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key]!)}`)
    .join(",")}}`;
};

export const constantTimeDigestEqual = (left: Sha256, right: Sha256) => {
  let difference = 0;

  for (let index = 0; index < left.length; index++) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }

  return difference === 0;
};

export const sha256Text = (cryptography: MoneyCryptography["Service"], value: string) =>
  cryptography.sha256(new TextEncoder().encode(value));

export const mintUuidV7 = <A>(
  cryptography: MoneyCryptography["Service"],
  schema: Schema.Decoder<A>,
) => cryptography.randomUuidV7.pipe(Effect.map(Schema.decodeUnknownSync(schema)));
