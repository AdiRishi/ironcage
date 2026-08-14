import * as Cloudflare from "alchemy/Cloudflare";
import * as Layer from "effect/Layer";

import { cloudflareSettingsLive } from "./cloudflare-settings.ts";
import { queueSettingsProvider } from "./queue-settings.ts";

export * from "./cloudflare-settings.ts";
export * from "./queue-settings.ts";
export * from "./types.ts";

export const cloudflareSettingsProviders = () => Layer.mergeAll(queueSettingsProvider());

export const customCloudflareProviders = () =>
  cloudflareSettingsProviders().pipe(
    Layer.provideMerge(cloudflareSettingsLive),
    Layer.provide(Cloudflare.CloudflareApiLive().pipe(Layer.orDie)),
  );
