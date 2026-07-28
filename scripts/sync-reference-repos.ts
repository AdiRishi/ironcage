#!/usr/bin/env node
// Vendors read-only reference repositories under `.repos/` as squashed git
// subtrees. The vendored copies are reference material only: never edit them,
// never import from them, and re-sync `effect` whenever the pinned dependency
// is bumped.
//
// Usage:
//   pnpm sync:repos                 sync every configured repo
//   pnpm sync:repos --repo <id>     sync one repo
//   pnpm sync:repos --latest        track the default branch instead of the pin
//   pnpm sync:repos --dry-run       print the git commands without running them
//
// Adapted from the throughline starter's sync script; kept dependency-free.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { REFERENCE_REPOS, type ReferenceRepo } from "./lib/reference-repos.ts";

const REPO_ROOT = NodePath.dirname(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)));

// pnpm does not hoist workspace dependencies to the root node_modules, so
// resolve installed packages the way a workspace package would. Contracts is
// the anchor because it depends on `effect` by definition.
const resolveFromContracts = NodeModule.createRequire(
  NodePath.join(REPO_ROOT, "packages/contracts/package.json"),
).resolve;

interface CliOptions {
  readonly repoId: string | undefined;
  readonly latest: boolean;
  readonly dryRun: boolean;
}

function parseCliOptions(argv: ReadonlyArray<string>): CliOptions {
  const repoFlagIndex = argv.indexOf("--repo");
  return {
    repoId: repoFlagIndex !== -1 ? argv[repoFlagIndex + 1] : undefined,
    latest: argv.includes("--latest"),
    dryRun: argv.includes("--dry-run"),
  };
}

function selectRepos(repoId: string | undefined): ReadonlyArray<ReferenceRepo> {
  if (repoId === undefined) {
    return REFERENCE_REPOS;
  }
  const repo = REFERENCE_REPOS.find((candidate) => candidate.id === repoId);
  if (!repo) {
    const expected = REFERENCE_REPOS.map((candidate) => candidate.id).join(", ");
    throw new Error(`Unknown reference repo "${repoId}". Expected one of: ${expected}.`);
  }
  return [repo];
}

/** The exact version of the dependency as installed in the workspace. */
function installedVersion(packageName: string): string {
  const packageJsonPath = resolveFromContracts(`${packageName}/package.json`);
  const parsed = JSON.parse(NodeFS.readFileSync(packageJsonPath, "utf8")) as {
    version?: unknown;
  };
  if (typeof parsed.version !== "string") {
    throw new Error(`Could not read an installed version from ${packageJsonPath}.`);
  }
  return parsed.version;
}

function resolveRef(repo: ReferenceRepo, latest: boolean): string {
  if (latest) {
    return repo.latestRef;
  }
  if (repo.installedPackage !== undefined && repo.versionTagPrefix !== undefined) {
    return `${repo.versionTagPrefix}${installedVersion(repo.installedPackage)}`;
  }
  if (repo.pinnedRef !== undefined) {
    return repo.pinnedRef;
  }
  throw new Error(
    `Reference repo "${repo.id}" has neither an installed-package pin nor a pinnedRef.`,
  );
}

function ensureCleanWorkingTree(): void {
  const status = NodeChildProcess.execSync("git status --porcelain", {
    cwd: REPO_ROOT,
    encoding: "utf8",
  }).trim();
  if (status !== "") {
    throw new Error(
      "The working tree has uncommitted changes. git subtree requires a clean tree — commit or stash first.",
    );
  }
}

function run(command: string, dryRun: boolean): void {
  console.log(`$ ${command}`);
  if (dryRun) {
    return;
  }
  NodeChildProcess.execSync(command, { cwd: REPO_ROOT, stdio: "inherit" });
}

function syncRepo(repo: ReferenceRepo, options: CliOptions): void {
  const ref = resolveRef(repo, options.latest);
  const exists = NodeFS.existsSync(NodePath.join(REPO_ROOT, repo.prefix));
  const verb = exists ? "pull" : "add";
  run(
    `git subtree ${verb} --prefix ${repo.prefix} ${repo.repository} ${ref} --squash -m "sync ${repo.id} reference repo (${ref})"`,
    options.dryRun,
  );
}

const options = parseCliOptions(process.argv.slice(2));
if (!options.dryRun) {
  ensureCleanWorkingTree();
}
for (const repo of selectRepos(options.repoId)) {
  syncRepo(repo, options);
}
