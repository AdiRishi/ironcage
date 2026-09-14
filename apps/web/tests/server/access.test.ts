import { Predicate } from "effect";
import { expect, it } from "vitest";

import { authenticate, validMutationOrigin } from "../../src/server/access";

it("requires Access for every non-development environment", async () => {
  for (const environment of ["production", "staging", "test"]) {
    expect(
      await authenticate(new Request("https://wealth.example/"), {
        ENVIRONMENT: environment,
        ACCESS_ISSUER: "https://team.cloudflareaccess.com",
        ACCESS_AUDIENCE: "application",
      }),
    ).toBeNull();
  }
});

it("lets the local development stack render without an Access session", async () => {
  expect(
    await authenticate(new Request("http://localhost/"), {
      ENVIRONMENT: "local",
      ACCESS_ISSUER: "",
      ACCESS_AUDIENCE: "",
    }),
  ).toEqual({ email: "local@ironcage.invalid" });
});

it("rejects mutations from another origin or without origin evidence", () => {
  for (const headers of [{}, { origin: "https://other.example" }]) {
    expect(
      validMutationOrigin(
        new Request("https://wealth.example/uploads", { method: "POST", headers }),
      ),
    ).toBe(false);
  }
  expect(
    validMutationOrigin(
      new Request("https://wealth.example/uploads", {
        method: "POST",
        headers: { origin: "https://wealth.example" },
      }),
    ),
  ).toBe(true);
});

it("accepts a signed Access session and rejects wrong audiences, issuers, expired and forged sessions", async () => {
  const { createServer } = await import("node:http");
  const { exportJWK, generateKeyPair, SignJWT } = await import("jose");
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  const server = createServer((_request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ keys: [{ ...jwk, kid: "test-key", alg: "RS256" }] }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || Predicate.isString(address)) throw new Error("Expected a TCP address");
  const issuer = `http://127.0.0.1:${address.port}`;
  const config = { ENVIRONMENT: "production", ACCESS_ISSUER: issuer, ACCESS_AUDIENCE: "ironcage" };
  try {
    for (const session of [
      { issuer, audience: "ironcage", expires: "1h", allowed: true },
      { issuer, audience: "another-app", expires: "1h", allowed: false },
      {
        issuer: "https://another-team.example",
        audience: "ironcage",
        expires: "1h",
        allowed: false,
      },
      { issuer, audience: "ironcage", expires: "-1h", allowed: false },
    ]) {
      const token = await new SignJWT({ email: "user@example.test" })
        .setProtectedHeader({ alg: "RS256", kid: "test-key" })
        .setSubject("user")
        .setIssuer(session.issuer)
        .setAudience(session.audience)
        .setExpirationTime(session.expires)
        .sign(privateKey);
      const identity = await authenticate(
        new Request("https://wealth.example", { headers: { "cf-access-jwt-assertion": token } }),
        config,
      );
      expect(identity !== null).toBe(session.allowed);
    }
    expect(
      await authenticate(
        new Request("https://wealth.example", {
          headers: { "cf-access-jwt-assertion": "forged.token.value" },
        }),
        config,
      ),
    ).toBeNull();
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
