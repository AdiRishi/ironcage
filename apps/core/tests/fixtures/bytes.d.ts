/** The `?bytes` loader in `vitest.config.ts`, which hands a fixture over as its exact bytes. */
declare module "*?bytes" {
  const bytes: Uint8Array;
  export default bytes;
}
