export interface ArtifactStore {
  readonly put: (key: string, bytes: Uint8Array) => Promise<unknown>;
}
