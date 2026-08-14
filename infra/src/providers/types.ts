import type * as r2 from "@distilled.cloud/cloudflare/r2";

export type BucketLockRule = r2.BucketsLocksUpdateRequestRulesItem;

export interface BucketLocksProps {
  readonly bucketName: string;
  readonly rules: readonly BucketLockRule[];
}

export interface BucketLocksAttributes extends BucketLocksProps {
  readonly accountId: string;
}

export const DEFAULT_QUEUE_RETENTION_SECONDS = 4 * 24 * 60 * 60;

export interface QueueSettingsProps {
  readonly queueId: string;
  readonly messageRetentionSeconds: number;
}

export interface QueueSettingsAttributes extends QueueSettingsProps {
  readonly accountId: string;
}

export type AccessAuthenticator = "totp" | "biometrics" | "security_key";

export interface OperatorAccessPolicyProps {
  readonly name: string;
  readonly email: string;
  readonly sessionDuration: string;
  readonly mfa: {
    readonly required: boolean;
    readonly allowedAuthenticators: readonly AccessAuthenticator[];
    readonly sessionDuration: string;
  };
}

export interface OperatorAccessPolicyAttributes extends OperatorAccessPolicyProps {
  readonly accountId: string;
  readonly policyId: string;
}
