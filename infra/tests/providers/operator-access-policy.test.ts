import assert from "node:assert/strict";

import * as Effect from "effect/Effect";

import { OperatorAccessPolicy } from "../../src/providers/operator-access-policy.ts";
import { accessPolicies, test } from "./cloudflare-settings.ts";

test("operator policy updates identity and MFA as one resource", (stack) =>
  Effect.gen(function* () {
    const initial = yield* stack.deploy(
      OperatorAccessPolicy("Operator", {
        name: "Ironcage operator",
        email: "first@example.com",
        sessionDuration: "720h",
        mfa: {
          required: true,
          allowedAuthenticators: ["security_key"],
          sessionDuration: "24h",
        },
      }),
    );
    const updated = yield* stack.deploy(
      OperatorAccessPolicy("Operator", {
        name: "Ironcage operator",
        email: "second@example.com",
        sessionDuration: "720h",
        mfa: {
          required: true,
          allowedAuthenticators: ["biometrics", "security_key"],
          sessionDuration: "1h",
        },
      }),
    );

    assert.equal(updated.policyId, initial.policyId);
    assert.deepEqual(accessPolicies.get(updated.policyId), {
      accountId: "00000000000000000000000000000000",
      policyId: updated.policyId,
      name: "Ironcage operator",
      email: "second@example.com",
      sessionDuration: "720h",
      mfa: {
        required: true,
        allowedAuthenticators: ["biometrics", "security_key"],
        sessionDuration: "1h",
      },
    });

    yield* stack.destroy();
    assert.equal(accessPolicies.has(updated.policyId), false);
  }));
