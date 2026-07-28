// Configuration for the vendored reference repositories under `.repos/`.
// Pinning comes in two flavors:
//   - `installedPackage` + `versionTagPrefix`: the subtree tracks the version
//     of a dependency this workspace actually installs (tag = prefix + version),
//     so vendored source always matches what the code compiles against.
//   - `pinnedRef`: a plain branch/tag for repos that are reference material
//     only (prior art), where "reasonably current" is the requirement.

export interface ReferenceRepo {
  readonly id: string;
  /** Subtree prefix, relative to the repo root. */
  readonly prefix: string;
  readonly repository: string;
  /** Ref used with `--latest` instead of the pin. */
  readonly latestRef: string;
  /** Installed package whose version resolves the pinned tag. */
  readonly installedPackage?: string;
  /** Tag = `${versionTagPrefix}${installed version}`. */
  readonly versionTagPrefix?: string;
  /** Explicit pin for repos not tied to an installed dependency. */
  readonly pinnedRef?: string;
}

export const REFERENCE_REPOS: ReadonlyArray<ReferenceRepo> = [
  {
    id: "effect",
    prefix: ".repos/effect",
    repository: "https://github.com/Effect-TS/effect.git",
    latestRef: "main",
    installedPackage: "effect",
    versionTagPrefix: "effect@",
  },
  {
    id: "freqtrade",
    prefix: ".repos/freqtrade",
    repository: "https://github.com/freqtrade/freqtrade.git",
    latestRef: "develop",
    pinnedRef: "stable",
  },
  {
    id: "condor",
    prefix: ".repos/condor",
    repository: "https://github.com/hummingbot/condor.git",
    latestRef: "main",
    pinnedRef: "main",
  },
];
