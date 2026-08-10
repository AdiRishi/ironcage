import { useRequest } from "nitro/context";

// Read per request rather than at module scope: in development the bindings
// come from Wrangler's platform proxy, which Nitro attaches to each request.
export const appEnv = (): Env => {
  const env = useRequest().runtime?.cloudflare?.env as Env | undefined;

  if (!env) {
    throw new Error(
      "No Cloudflare environment on this request. Run the app under `wrangler dev` or with Nitro's Cloudflare dev proxy.",
    );
  }

  return env;
};
