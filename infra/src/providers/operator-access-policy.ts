import * as Cloudflare from "alchemy/Cloudflare";
import { deepEqual, isResolved } from "alchemy/Diff";
import * as Provider from "alchemy/Provider";
import { Resource, type Resource as AlchemyResource } from "alchemy/Resource";
import * as Effect from "effect/Effect";

import { CloudflareSettings } from "./cloudflare-settings.ts";
import type { OperatorAccessPolicyAttributes, OperatorAccessPolicyProps } from "./types.ts";

type OperatorAccessPolicy = AlchemyResource<
  "Ironcage.Cloudflare.OperatorAccessPolicy",
  OperatorAccessPolicyProps,
  OperatorAccessPolicyAttributes
>;

export const OperatorAccessPolicy = Resource<OperatorAccessPolicy>(
  "Ironcage.Cloudflare.OperatorAccessPolicy",
);

const policyProps = (attributes: OperatorAccessPolicyAttributes): OperatorAccessPolicyProps => ({
  name: attributes.name,
  email: attributes.email,
  sessionDuration: attributes.sessionDuration,
  mfa: attributes.mfa,
});

export const operatorAccessPolicyProvider = () =>
  Provider.succeed(OperatorAccessPolicy, {
    stables: ["accountId", "policyId"],
    diff: Effect.fn("Ironcage.Cloudflare.OperatorAccessPolicy.diff")(function* ({ news, output }) {
      if (!isResolved(news)) return undefined;
      const { accountId } = yield* yield* Cloudflare.CloudflareEnvironment;
      if (
        output?.accountId !== accountId ||
        output === undefined ||
        !deepEqual(news, policyProps(output))
      ) {
        return { action: "update" } as const;
      }
    }),
    read: Effect.fn("Ironcage.Cloudflare.OperatorAccessPolicy.read")(function* ({ olds, output }) {
      const { accountId } = yield* yield* Cloudflare.CloudflareEnvironment;
      const api = yield* CloudflareSettings;
      return output?.policyId
        ? yield* api.getAccessPolicy(accountId, output.policyId)
        : yield* api.findAccessPolicy(accountId, olds.name);
    }),
    reconcile: Effect.fn("Ironcage.Cloudflare.OperatorAccessPolicy.reconcile")(function* ({
      news,
      output,
    }) {
      const { accountId } = yield* yield* Cloudflare.CloudflareEnvironment;
      const api = yield* CloudflareSettings;
      const existing = output?.policyId
        ? yield* api.getAccessPolicy(accountId, output.policyId)
        : yield* api.findAccessPolicy(accountId, news.name);

      if (existing === undefined) {
        const policyId = yield* api.createAccessPolicy(accountId, news);
        return { accountId, policyId, ...news };
      }

      yield* api.updateAccessPolicy(accountId, existing.policyId, news);
      return { accountId, policyId: existing.policyId, ...news };
    }),
    delete: Effect.fn("Ironcage.Cloudflare.OperatorAccessPolicy.delete")(function* ({ output }) {
      const api = yield* CloudflareSettings;
      yield* api.deleteAccessPolicy(output.accountId, output.policyId);
    }),
  });
