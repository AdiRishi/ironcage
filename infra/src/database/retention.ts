import { Config, Effect } from "effect";

export const retentionPolicy = Effect.gen(function* () {
  return {
    database: yield* Config.string("DATABASE_BACKUP_POLICY").pipe(
      Config.withDefault(
        "Local development uses disposable Postgres storage. Managed backups are not enabled here.",
      ),
    ),
    originals: yield* Config.string("SOURCE_ARCHIVE").pipe(
      Config.withDefault(
        "Keep an independent copy of every original bank file outside Cloudflare before uploading.",
      ),
    ),
  };
});
