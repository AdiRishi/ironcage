import { Schema } from "effect";

/**
 * What every Worker answers `ping` with. It names the surface as well as the
 * Worker because a binding pointed at the wrong entrypoint still answers, and
 * the surface name is the only thing that distinguishes it from a correct one.
 */
export const SystemPing = Schema.Struct({
  worker: Schema.String,
  surface: Schema.String,
  serverTime: Schema.DateTimeUtcFromString,
});
export type SystemPing = typeof SystemPing.Type;
