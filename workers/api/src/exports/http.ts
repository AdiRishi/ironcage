import { ExportInput, FinanceError } from "@repo/contracts/finance";
import { Effect } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/unstable/http";

import { failureResponse } from "../http.ts";
import { Exports } from "./service.ts";

export const exportHttpRoutes = HttpRouter.add(
  "GET",
  "/exports/:exportId",
  Effect.gen(function* () {
    const input = yield* HttpRouter.schemaPathParams(ExportInput).pipe(
      Effect.mapError(() => new FinanceError({ kind: "invalid", message: "Invalid export ID." })),
    );
    const object = yield* Exports.use((exports) => exports.download(input));
    return HttpServerResponse.stream(object.body, {
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="ironcage-${input.exportId}.zip"`,
        "cache-control": "private, no-store",
      },
    });
  }).pipe(Effect.catch((error) => Effect.succeed(failureResponse(error)))),
);
