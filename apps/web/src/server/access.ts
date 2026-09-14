import { createRemoteJWKSet, jwtVerify } from "jose";

export interface AccessConfig {
  readonly ENVIRONMENT: string;
  readonly ACCESS_ISSUER: string;
  readonly ACCESS_AUDIENCE: string;
}

const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export async function authenticate(request: Request, config: AccessConfig) {
  if (config.ENVIRONMENT === "local") return { email: "local@ironcage.invalid" };
  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token || !config.ACCESS_ISSUER || !config.ACCESS_AUDIENCE) return null;
  let keys = keySets.get(config.ACCESS_ISSUER);
  if (!keys) {
    keys = createRemoteJWKSet(new URL("/cdn-cgi/access/certs", config.ACCESS_ISSUER));
    keySets.set(config.ACCESS_ISSUER, keys);
  }
  try {
    const { payload } = await jwtVerify(token, keys, {
      issuer: config.ACCESS_ISSUER,
      audience: config.ACCESS_AUDIENCE,
      algorithms: ["RS256"],
      requiredClaims: ["exp", "sub", "email"],
    });
    return payload;
  } catch {
    return null;
  }
}

export function validMutationOrigin(request: Request) {
  return (
    ["GET", "HEAD", "OPTIONS"].includes(request.method) ||
    request.headers.get("origin") === new URL(request.url).origin
  );
}
