import * as PlanetScaleApi from "@distilled.cloud/planetscale";
import { Action } from "alchemy";
import * as Planetscale from "alchemy/Planetscale";
import { Effect, Schedule } from "effect";
import { HttpClient } from "effect/unstable/http";

const CaptureBackup = Action(
  "CaptureBackup",
  Effect.gen(function* () {
    const credentials = yield* PlanetScaleApi.Credentials;
    const http = yield* HttpClient.HttpClient;
    return Effect.fn("CaptureBackup.run")(
      function* (input: { organization: string; database: string }) {
        const target = { ...input, branch: "main" };
        const backups = yield* PlanetScaleApi.listBackups(target);
        const existing = backups.data.find((backup) => backup.name === "restore-verification");
        const created =
          existing ??
          (yield* PlanetScaleApi.createBackup({
            ...target,
            name: "restore-verification",
            retention_unit: "day",
            retention_value: 1,
          }));
        const completed = yield* PlanetScaleApi.getBackup({ ...target, id: created.id }).pipe(
          Effect.repeat({
            schedule: Schedule.spaced("10 seconds"),
            while: (backup) => backup.state === "pending" || backup.state === "running",
          }),
          Effect.timeout("15 minutes"),
        );
        if (completed.state !== "success")
          return yield* Effect.die("The managed backup did not complete.");
        return {
          id: completed.id,
          completedAt: completed.completed_at,
          expiresAt: completed.expires_at,
        };
      },
      Effect.provideService(PlanetScaleApi.Credentials, credentials),
      Effect.provideService(HttpClient.HttpClient, http),
    );
  }).pipe(Effect.provide(Planetscale.fromAuthProvider())),
);

export const restoreVerificationDatabase = Effect.fn("RestoreVerification.database")(function* (
  fixture: string,
) {
  const source = yield* Planetscale.PostgresDatabase("RestoreSource", {
    clusterSize: "PS_10",
    majorVersion: "17",
    region: { slug: "ap-southeast" },
    migrations: "../workers/api/migrations",
    importFiles: [fixture],
  });
  const backup = yield* CaptureBackup({ organization: source.organization, database: source.name });
  const restored = yield* Planetscale.PostgresBranch("RestoredRecords", {
    database: source,
    parentBranch: "main",
    backupId: backup.id,
    clusterSize: "PS_10",
  });
  const reader = yield* Planetscale.PostgresRole("RestoreReader", {
    database: source,
    branch: restored,
    inheritedRoles: ["pg_read_all_data"],
    ttl: 900,
  });
  return { source, backup, restored, reader };
});
