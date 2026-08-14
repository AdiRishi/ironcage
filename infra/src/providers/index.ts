import * as Cloudflare from "alchemy/Cloudflare";
import * as Layer from "effect/Layer";

import { bucketLocksProvider } from "./bucket-locks.ts";
import { cloudflareSettingsLive } from "./cloudflare-settings.ts";
import { operatorAccessPolicyProvider } from "./operator-access-policy.ts";
import { queueSettingsProvider } from "./queue-settings.ts";

export * from "./bucket-locks.ts";
export * from "./cloudflare-settings.ts";
export * from "./operator-access-policy.ts";
export * from "./queue-settings.ts";
export * from "./types.ts";

export const cloudflareSettingsProviders = () =>
  Layer.mergeAll(bucketLocksProvider(), queueSettingsProvider(), operatorAccessPolicyProvider());

export const customCloudflareProviders = () =>
  cloudflareSettingsProviders().pipe(
    Layer.provideMerge(cloudflareSettingsLive),
    Layer.provide(Cloudflare.CloudflareApiLive().pipe(Layer.orDie)),
  );
