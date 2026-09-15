import type { FinanceError } from "@repo/contracts/finance";
import { HttpServerResponse } from "effect/unstable/http";

export const failureResponse = (error: FinanceError) =>
  HttpServerResponse.jsonUnsafe(
    { code: error.kind, message: error.message },
    { status: error.kind === "invalid" ? 400 : error.kind === "notFound" ? 404 : 503 },
  );
