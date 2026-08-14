import { fileURLToPath } from "node:url";

import * as Alchemy from "alchemy";
import { adopt } from "alchemy/AdoptPolicy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Planetscale from "alchemy/Planetscale";
import { retain } from "alchemy/RemovalPolicy";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";

import {
  AccessMfa,
  BucketLock,
  QueueRetention,
  customCloudflareProviders,
} from "./src/cloudflare-settings.ts";

const migrationsDir = fileURLToPath(new URL("../migrations", import.meta.url));
const compatibility = { date: "2026-08-01", flags: ["nodejs_compat"] };
const observability = {
  enabled: true,
  logs: { enabled: true, invocationLogs: true, headSamplingRate: 1 },
  traces: { enabled: true, headSamplingRate: 0.01 },
};
const lifecycleRules = [
  {
    id: "abort-incomplete-uploads",
    enabled: true,
    prefix: "",
    abortMultipartUploadsTransition: {
      condition: { type: "Age", maxAge: 7 * 24 * 60 * 60 },
    },
  },
] as const;
const indefiniteLock = (id: string) => ({
  id,
  enabled: true,
  prefix: "",
  condition: { type: "Indefinite" as const },
});
const optionalSecret = (name: string) =>
  Config.redacted(name).pipe(
    Config.option,
    Config.map(Option.filter((value) => Redacted.value(value).length > 0)),
  );

const Infrastructure = Effect.gen(function* () {
  const { stage } = yield* Alchemy.Stack;
  const production = stage === "prod";
  const environment = production ? "production" : "local";
  const secrets = yield* Effect.all({
    aiGatewayToken: optionalSecret("AI_GATEWAY_TOKEN"),
    krakenKey: optionalSecret("KRAKEN_KEY"),
    krakenSecret: optionalSecret("KRAKEN_SECRET"),
    krakenExportKey: optionalSecret("KRAKEN_EXPORT_KEY"),
    krakenExportSecret: optionalSecret("KRAKEN_EXPORT_SECRET"),
    alpacaKey: optionalSecret("ALPACA_KEY"),
    alpacaSecret: optionalSecret("ALPACA_SECRET"),
    emailKey: optionalSecret("EMAIL_KEY"),
  });

  const database = production
    ? yield* Planetscale.PostgresDatabase("Database", {
        name: "ironcage",
        region: { slug: "aws-ap-southeast-2" },
        clusterSize: "PS_5",
        arch: "arm",
        replicas: 0,
        defaultBranch: "main",
        migrationsDir,
        migrationsTable: "__alchemy_migrations",
        requireApprovalForDeploy: true,
        restrictBranchRegion: true,
        productionBranchWebConsole: false,
      }).pipe(adopt(true), retain())
    : yield* Planetscale.PostgresDatabase.ref("Database", { stage: "prod" });

  const branch = production
    ? "main"
    : yield* Planetscale.PostgresBranch("DevelopmentBranch", {
        name: "dev",
        database,
        parentBranch: "main",
        clusterSize: "PS_DEV",
        replicas: 0,
        safeMigrations: true,
        migrationsDir,
        migrationsTable: "__alchemy_migrations",
      }).pipe(adopt(true), retain());

  const runtimeRoles = ["pg_read_all_data", "pg_write_all_data"] as const;
  const uncachedRole = yield* Planetscale.PostgresRole("UncachedRuntimeRole", {
    name: production ? "ironcage_runtime" : "ironcage_dev_runtime",
    database,
    branch,
    inheritedRoles: [...runtimeRoles],
  });
  const cachedRole = yield* Planetscale.PostgresRole("CachedRuntimeRole", {
    name: production ? "ironcage_analytics" : "ironcage_dev_analytics",
    database,
    branch,
    inheritedRoles: [...runtimeRoles],
  });
  if (production) {
    yield* Planetscale.PostgresRole("BackupRole", {
      name: "ironcage_backup",
      database,
      branch,
      inheritedRoles: ["pg_read_all_data"],
    });
  }

  const uncached = yield* Cloudflare.Hyperdrive.Connection("UncachedDatabase", {
    name: "ironcage-without-cache",
    origin: uncachedRole.origin,
    ...(!production && { dev: uncachedRole.pooledOrigin }),
    caching: { disabled: true },
    originConnectionLimit: 8,
  }).pipe(adopt(production));
  const cached = yield* Cloudflare.Hyperdrive.Connection("CachedDatabase", {
    name: "ironcage-with-cache",
    origin: cachedRole.origin,
    ...(!production && { dev: cachedRole.pooledOrigin }),
    caching: { maxAge: 60, staleWhileRevalidate: 15 },
    originConnectionLimit: 8,
  }).pipe(adopt(production));

  const blobs = yield* Cloudflare.R2.Bucket("Blobs", {
    name: "ironcage-private",
    lifecycleRules: [...lifecycleRules],
  }).pipe(adopt(production), retain());
  const agentArtifacts = yield* Cloudflare.R2.Bucket("AgentArtifacts", {
    name: "ironcage-agent-artifacts",
    lifecycleRules: [...lifecycleRules],
  }).pipe(retain());
  const backups = yield* Cloudflare.R2.Bucket("Backups", {
    name: "ironcage-backups",
    lifecycleRules: [...lifecycleRules],
  }).pipe(retain());

  const deadLetters = yield* Cloudflare.Queues.Queue("DecisionRecordDeadLetters", {
    name: "ironcage-decision-records-dlq",
  }).pipe(retain());
  const decisions = yield* Cloudflare.Queues.Queue("DecisionRecords", {
    name: "ironcage-decision-records",
  }).pipe(retain());

  const gatewaySpendLimit = yield* Config.number("AI_GATEWAY_DAILY_SPEND_CENTS").pipe(
    Config.withDefault(500),
  );
  const gatewayLogLimit = yield* Config.number("AI_GATEWAY_LOG_LIMIT").pipe(
    Config.withDefault(10_000),
  );
  const gateway = yield* Cloudflare.AI.Gateway("AiGateway", {
    id: production ? "ironcage" : "ironcage-dev",
    authentication: true,
    cacheTtl: null,
    collectLogs: true,
    logManagement: gatewayLogLimit,
    logManagementStrategy: "DELETE_OLDEST",
    spendLimits: {
      enabled: true,
      rules: [
        {
          limit: gatewaySpendLimit,
          limitType: "cost",
          technique: "sliding",
          window: "1 day",
        },
      ],
    },
  }).pipe(retain());

  const flags = yield* Cloudflare.Flagship.App("Flags", {
    name: production ? "ironcage" : "ironcage-dev",
  }).pipe(retain());
  yield* Cloudflare.Flagship.Flag("LiveTrading", {
    appId: flags.appId,
    key: "trading.live_enabled",
    enabled: true,
    defaultVariation: "off",
    variations: { off: false, on: true },
    description: "Independent production brake for every live order path.",
  }).pipe(retain());

  const backtests = Cloudflare.DurableObject("BacktestRunner", {
    className: "BacktestRunner",
  });
  const statementExtraction = Cloudflare.DurableObject("StatementExtractor", {
    className: "StatementExtractor",
  });
  const compute = yield* Cloudflare.Worker("ComputeWorker", {
    name: "ironcage-compute",
    main: "../apps/compute/src/index.ts",
    compatibility,
    workersDev: false,
    observability,
    env: {
      BACKTEST: backtests,
      STATEMENT_EXTRACTION: statementExtraction,
      BLOBS: blobs,
      ENVIRONMENT: environment,
    },
  });

  const moneyIdentityKey = Alchemy.makeRandom("MoneyIdentityKey");
  const healthSigningKey = Alchemy.makeRandom("HealthSigningKey");
  const core = yield* Cloudflare.Worker("CoreWorker", {
    name: "ironcage-core",
    main: "../apps/core/src/index.ts",
    compatibility,
    workersDev: false,
    observability,
    crons: ["* * * * *", "*/5 * * * *", "0 1 * * *", "0 2 * * *", "0 3 * * *", "0 4 1 1,4,7,10 *"],
    env: {
      DB: uncached,
      DB_CACHED: cached,
      BLOBS: blobs,
      AGENT_ARTIFACTS: agentArtifacts,
      BACKUPS: backups,
      FLAGS: flags,
      COMPUTE: Cloudflare.DurableObject("BacktestRunner", {
        className: "BacktestRunner",
        scriptName: compute.workerName,
      }),
      STATEMENT_EXTRACTION: Cloudflare.DurableObject("StatementExtractor", {
        className: "StatementExtractor",
        scriptName: compute.workerName,
      }),
      SLEEVES: Cloudflare.DurableObject("SleeveActor", { className: "SleeveActor" }),
      VENUES: Cloudflare.DurableObject("VenueActor", { className: "VenueActor" }),
      SYSTEM_CAGE: Cloudflare.DurableObject("SystemCageActor", {
        className: "SystemCageActor",
      }),
      FEEDS: Cloudflare.DurableObject("FeedActor", { className: "FeedActor" }),
      GATE_PIPELINE: Cloudflare.Workflow("GatePipeline", {
        className: "GatePipelineWorkflow",
      }),
      TAX_SYNC: Cloudflare.Workflow("TaxSync", { className: "TaxSyncWorkflow" }),
      REPORTS: Cloudflare.Workflow("Reports", { className: "ReportWorkflow" }),
      MONEY_CATEGORIZATION: Cloudflare.Workflow("MoneyCategorization", {
        className: "MoneyCategorizationWorkflow",
      }),
      BACKUP: Cloudflare.Workflow("Backup", { className: "BackupWorkflow" }),
      RESTORE_TEST: Cloudflare.Workflow("RestoreTest", {
        className: "RestoreTestWorkflow",
      }),
      ENVIRONMENT: environment,
      HEALTH_SIGNING_KEY: healthSigningKey,
      MONEY_IDENTITY_KEY: moneyIdentityKey,
      ...(production && Option.isSome(secrets.krakenKey)
        ? { KRAKEN_KEY: secrets.krakenKey.value }
        : {}),
      ...(production && Option.isSome(secrets.krakenSecret)
        ? { KRAKEN_SECRET: secrets.krakenSecret.value }
        : {}),
      ...(production && Option.isSome(secrets.krakenExportKey)
        ? { KRAKEN_EXPORT_KEY: secrets.krakenExportKey.value }
        : {}),
      ...(production && Option.isSome(secrets.krakenExportSecret)
        ? { KRAKEN_EXPORT_SECRET: secrets.krakenExportSecret.value }
        : {}),
      ...(production && Option.isSome(secrets.alpacaKey)
        ? { ALPACA_KEY: secrets.alpacaKey.value }
        : {}),
      ...(production && Option.isSome(secrets.alpacaSecret)
        ? { ALPACA_SECRET: secrets.alpacaSecret.value }
        : {}),
      ...(production && Option.isSome(secrets.emailKey)
        ? { EMAIL_KEY: secrets.emailKey.value }
        : {}),
    },
  });

  const agents = yield* Cloudflare.Worker("AgentsWorker", {
    name: "ironcage-agents",
    main: "../apps/agents/src/index.ts",
    compatibility,
    workersDev: false,
    observability,
    env: {
      CORE: Cloudflare.WorkerEntrypoint(core, "AgentReadApiEntrypoint"),
      DECISION_RECORDS: decisions,
      AI_GATEWAY: gateway,
      FLAGS: flags,
      ENVIRONMENT: environment,
      ...(Option.isSome(secrets.aiGatewayToken)
        ? { AI_GATEWAY_TOKEN: secrets.aiGatewayToken.value }
        : {}),
    },
  });

  yield* core.bind("AgentsDispatch", {
    bindings: [
      {
        type: "service",
        name: "AGENTS",
        service: agents.workerName,
        entrypoint: "DispatchApiEntrypoint",
      },
    ],
  });

  yield* Cloudflare.Queues.Consumer("DecisionRecordConsumer", {
    queueId: decisions.queueId,
    scriptName: core.workerName,
    deadLetterQueue: deadLetters.queueName,
    settings: {
      batchSize: 1,
      maxConcurrency: 1,
      maxRetries: 9,
      maxWaitTimeMs: 1_000,
    },
  });

  const domain = production ? "wealth.arishi.dev" : undefined;
  const accessEmail = production ? yield* Config.string("ACCESS_EMAIL") : undefined;
  const accessPolicy = production
    ? yield* Cloudflare.Access.Policy("OperatorAccess", {
        name: "Ironcage operator",
        decision: "allow",
        include: [{ email: { email: accessEmail! } }],
        sessionDuration: "720h",
      }).pipe(retain())
    : undefined;
  const access =
    production && accessPolicy && domain
      ? yield* Cloudflare.Access.Application("OperatorApplication", {
          type: "self_hosted",
          name: "Ironcage",
          domain,
          sessionDuration: "720h",
          appLauncherVisible: false,
          policies: [accessPolicy.policyId],
        }).pipe(retain())
      : undefined;

  const app = yield* Cloudflare.Website.Vite("AppWorker", {
    name: "ironcage-app",
    rootDir: "../apps/app",
    compatibility,
    workersDev: false,
    ...(domain === undefined ? {} : { domain }),
    observability,
    assets: { runWorkerFirst: true },
    memo: {
      include: ["**/*", "../../packages/contracts/src/**", "../../packages/ui/src/**"],
      lockfile: true,
    },
    env: {
      CORE: Cloudflare.WorkerEntrypoint(core, "AppApiEntrypoint"),
      AGENTS: Cloudflare.WorkerEntrypoint(agents, "ConversationApiEntrypoint"),
      ACCESS_AUD: access?.aud ?? "",
      ENVIRONMENT: environment,
    },
  });

  if (production && accessPolicy && accessEmail) {
    yield* AccessMfa("OperatorMfa", {
      policyId: accessPolicy.policyId,
      policyName: "Ironcage operator",
      email: accessEmail,
      sessionDuration: "720h",
      authenticators: ["biometrics", "security_key"],
    }).pipe(retain());
  }

  if (production) {
    yield* Effect.all(
      [
        BucketLock("BlobsLock", {
          bucketName: blobs.bucketName,
          rule: indefiniteLock("immutable-blobs"),
        }).pipe(retain()),
        BucketLock("AgentArtifactsLock", {
          bucketName: agentArtifacts.bucketName,
          rule: indefiniteLock("immutable-agent-artifacts"),
        }).pipe(retain()),
        BucketLock("BackupsLock", {
          bucketName: backups.bucketName,
          rule: indefiniteLock("immutable-backups"),
        }).pipe(retain()),
      ],
      { discard: true },
    );

    yield* Effect.all(
      [
        QueueRetention("DecisionRecordRetention", {
          queueId: decisions.queueId,
          seconds: 14 * 24 * 60 * 60,
        }),
        QueueRetention("DecisionRecordDeadLetterRetention", {
          queueId: deadLetters.queueId,
          seconds: 14 * 24 * 60 * 60,
        }),
      ],
      { discard: true },
    );
  }

  return { app, core, agents, compute };
});

type InfrastructureResources = Effect.Success<typeof Infrastructure>;

export type AppEnv = Cloudflare.InferEnv<InfrastructureResources["app"]>;
export type AgentsEnv = Cloudflare.InferEnv<InfrastructureResources["agents"]>;
export type ComputeEnv = Cloudflare.InferEnv<InfrastructureResources["compute"]>;
export type CoreEnv = Cloudflare.InferEnv<InfrastructureResources["core"]> & {
  AGENTS: { readonly fetch: typeof globalThis.fetch };
};

export default Alchemy.Stack(
  "Ironcage",
  {
    providers: Layer.mergeAll(
      Cloudflare.providers(),
      Planetscale.providers(),
      customCloudflareProviders(),
    ),
    state: Cloudflare.state(),
  },
  Infrastructure,
);
