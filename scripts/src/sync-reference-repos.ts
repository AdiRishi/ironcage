#!/usr/bin/env node
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Cause, Console, Data, Effect, Option, Schema } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import * as YAML from "yaml";

import { referenceRepos, type ReferenceRepo } from "../lib/reference-repos.ts";

const repoRoot = NodePath.resolve(import.meta.dirname, "../..");
const WorkspaceCatalog = Schema.Struct({
  catalog: Schema.Record(Schema.String, Schema.String),
});

class ReferenceRepoConfigError extends Data.TaggedError("ReferenceRepoConfigError")<{
  readonly message: string;
}> {}

const selectedRepos = (repoId: string | undefined) => {
  if (repoId === undefined) return referenceRepos;
  const selected = referenceRepos.find((repo) => repo.id === repoId);
  if (selected === undefined) {
    throw new Error(`Unknown reference repo "${repoId}".`);
  }
  return [selected];
};

const pinnedVersion = Effect.fn(function* (repo: ReferenceRepo) {
  const contents: unknown = yield* Effect.try(() =>
    YAML.parse(NodeFS.readFileSync(NodePath.join(repoRoot, repo.versionSourcePath), "utf8")),
  );
  const workspace = yield* Schema.decodeUnknownEffect(WorkspaceCatalog)(contents);
  const version = workspace.catalog[repo.catalogPackage];
  if (version === undefined) {
    return yield* new ReferenceRepoConfigError({
      message: `catalog.${repo.catalogPackage} is missing from ${repo.versionSourcePath}.`,
    });
  }
  return version;
});

const assertCleanWorkingTree = () => {
  const status = NodeChildProcess.execFileSync("git", ["status", "--porcelain"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (status.trim().length > 0) {
    throw new Error("Commit or stash changes before syncing reference repositories.");
  }
};

const command = Command.make(
  "sync:repos",
  {
    dryRun: Flag.boolean("dry-run").pipe(Flag.withDefault(false)),
    latest: Flag.boolean("latest").pipe(Flag.withDefault(false)),
    repo: Flag.string("repo").pipe(Flag.optional),
  },
  ({ dryRun, latest, repo }) =>
    Effect.gen(function* () {
      const repos = yield* Effect.try(() => selectedRepos(Option.getOrUndefined(repo)));
      if (!dryRun) yield* Effect.try(assertCleanWorkingTree);

      for (const repo of repos) {
        const action = yield* Effect.try(() =>
          NodeFS.existsSync(NodePath.join(repoRoot, repo.prefix)) ? "pull" : "add",
        );
        const ref = latest
          ? repo.latestRef
          : `${repo.versionTagPrefix}${yield* pinnedVersion(repo)}`;
        const args = [
          "subtree",
          action,
          `--prefix=${repo.prefix}`,
          repo.repository,
          ref,
          "--squash",
        ];
        yield* Console.log(`[sync:repos] ${repo.id}: git ${args.join(" ")}`);
        if (dryRun) continue;

        yield* Effect.try(() => {
          const result = NodeChildProcess.spawnSync("git", args, {
            cwd: repoRoot,
            stdio: "inherit",
          });
          if (result.status !== 0) {
            throw new Error(`git subtree ${action} failed with exit code ${result.status}.`);
          }
        });
      }
    }).pipe(
      Effect.tapError((error) => {
        const cause = Cause.isUnknownError(error) ? error.cause : error;
        return Console.error(cause instanceof Error ? cause.message : String(cause));
      }),
    ),
).pipe(
  Command.withDescription("Synchronize vendored reference repositories with pinned versions."),
);

command.pipe(
  Command.run({ version: "1.0.0" }),
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain({ disableErrorReporting: true }),
);
