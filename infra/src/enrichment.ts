import * as Cloudflare from "alchemy/Cloudflare";

export const EnrichmentGateway = Cloudflare.AI.Gateway("EnrichmentGateway", {
  authentication: true,
  collectLogs: false,
  cacheTtl: null,
});
