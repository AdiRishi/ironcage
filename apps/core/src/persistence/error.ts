import { Internal } from "@ironcage/contracts/schema";
import { Effect, Schema } from "effect";

export class PersistenceError extends Schema.TaggedError<PersistenceError>()("PersistenceError", {
  operation: Schema.String,
  cause: Schema.Defect(),
}) {}

export type WithoutPersistence<E> = E extends PersistenceError ? never : E;

export function persistenceToBoundary<A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, WithoutPersistence<E> | Internal, R>;
export function persistenceToBoundary<A, E, R>(effect: Effect.Effect<A, E, R>) {
  return effect.pipe(
    Effect.catchIf(
      (error): error is Extract<E, PersistenceError> => error instanceof PersistenceError,
      (error) =>
        Effect.logError(`${error.operation} failed`, error.cause).pipe(
          Effect.andThen(Effect.fail(new Internal({ detail: `${error.operation} failed` }))),
        ),
      Effect.fail,
    ),
  );
}

export const decodeStored = <A>(
  schema: Schema.Decoder<A, never>,
  value: unknown,
  entity: string,
): Effect.Effect<A, Internal> =>
  Schema.decodeUnknownEffect(schema)(value).pipe(
    Effect.mapError(() => new Internal({ detail: `stored ${entity} failed schema decoding` })),
  );
