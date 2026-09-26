import { type AnyRouteMatch, SearchParamError, isNotFound, notFound } from "@tanstack/react-router";
import { Schema } from "effect";

import { AppRequestError } from "@/lib/app-error";

// A path value is an ID, so one that does not decode names no page. Throwing the router's
// not-found answers it with the not-found page and a 404.
export function pathParam<S extends Schema.Constraint>(schema: S, value: string) {
  if (Schema.is(schema)(value)) return value;
  throw notFound();
}

// As a route's `onError`, gives an address that names nothing the same not-found page and
// 404 instead of the error page and a 500: a search value that does not decode, or a
// record the API does not have, such as a transaction ID from before a reimport. Every
// other error stays with the error page.
export function addressNotFound(cause: unknown) {
  if (
    cause instanceof SearchParamError ||
    (cause instanceof AppRequestError && cause.code === "notFound")
  )
    throw notFound();
}

// Whether a route's path or search values did not decode.
export const unreadable = (match: AnyRouteMatch) =>
  match.searchError !== undefined || match.paramsError !== undefined;

// Whether a route found nothing at the address. A not-found thrown below the root shows
// on the root's match, because no route has a not-found page of its own.
export const namesNothing = (match: AnyRouteMatch) =>
  unreadable(match) || match.status === "notFound" || isNotFound(match.error);
