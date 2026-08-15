// Configuration for the vendored reference repositories under `.repos/`.
//
// Each entry pins its subtree to a version read out of a file in this repo —
// for Effect, the `catalog.effect` entry in `pnpm-workspace.yaml`. That means
// the vendored source always matches the version the workspace is pinned to,
// and it resolves without needing anything installed.

export interface ReferenceRepo {
  readonly id: string;
  /** Subtree prefix, relative to the repo root. */
  readonly prefix: string;
  readonly repository: string;
  /** Ref used with `--latest` instead of the pinned version tag. */
  readonly latestRef: string;
  /** Repo-root-relative workspace file holding the pnpm catalog. */
  readonly versionSourcePath: string;
  /** Package key in the workspace's pnpm catalog. */
  readonly catalogPackage: string;
  /** Tag = `${versionTagPrefix}${resolved version}`. */
  readonly versionTagPrefix: string;
}

export const REFERENCE_REPOS: ReadonlyArray<ReferenceRepo> = [
  {
    id: "effect",
    prefix: ".repos/effect",
    repository: "https://github.com/Effect-TS/effect.git",
    latestRef: "main",
    versionSourcePath: "pnpm-workspace.yaml",
    catalogPackage: "effect",
    versionTagPrefix: "effect@",
  },
];
