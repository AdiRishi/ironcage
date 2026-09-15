import { AccountId, FinanceError, SourceFileInput } from "@repo/contracts/finance";
import { Effect, Layer, Schema, Stream } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import { failureResponse } from "../http.ts";
import { Uploads } from "./uploads.ts";

const maximumFileSize = 10 * 1024 * 1024;
const FileUpload = Schema.instanceOf(File).check(
  Schema.makeFilter((file) => file.size > 0 && file.size <= maximumFileSize),
);
const invalid = () =>
  new FinanceError({
    kind: "invalid",
    message: "Choose a non-empty bank file of 10 MB or smaller.",
  });
const upload = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  let size = 0;
  const chunks = yield* request.stream.pipe(
    Stream.mapEffect((chunk) => {
      size += chunk.byteLength;
      return size > maximumFileSize + 16 * 1024
        ? Effect.fail(invalid())
        : Effect.succeed(new Uint8Array(chunk));
    }),
    Stream.runCollect,
    Effect.mapError(invalid),
  );
  const form = yield* Effect.tryPromise({
    try: () => new Response(new Blob(chunks), { headers: request.headers }).formData(),
    catch: invalid,
  });
  const file = yield* Schema.decodeUnknownEffect(FileUpload)(form.get("file")).pipe(
    Effect.mapError(invalid),
  );
  const accountId = yield* Schema.decodeUnknownEffect(Schema.NullOr(AccountId))(
    form.get("accountId"),
  ).pipe(
    Effect.mapError(
      () => new FinanceError({ kind: "invalid", message: "Choose a valid account." }),
    ),
  );
  const bytes = new Uint8Array(
    yield* Effect.tryPromise({ try: () => file.arrayBuffer(), catch: invalid }),
  );
  const result = yield* Uploads.use((uploads) =>
    uploads.upload({ fileName: file.name, mediaType: file.type, accountId, bytes }),
  );
  return HttpServerResponse.jsonUnsafe(result, { status: result.existing ? 200 : 202 });
}).pipe(Effect.catch((error) => Effect.succeed(failureResponse(error))));
const download = Effect.gen(function* () {
  const input = yield* HttpRouter.schemaPathParams(SourceFileInput).pipe(
    Effect.mapError(
      () => new FinanceError({ kind: "invalid", message: "Invalid source file ID." }),
    ),
  );
  const { fileName, mediaType, object } = yield* Uploads.use((uploads) => uploads.download(input));
  const inline = fileName.toLowerCase().endsWith(".pdf");
  return HttpServerResponse.stream(object.body, {
    headers: {
      "content-type": inline ? "application/pdf" : mediaType,
      "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "cache-control": "private, no-store",
    },
  });
}).pipe(Effect.catch((error) => Effect.succeed(failureResponse(error))));
export const importHttpRoutes = Layer.mergeAll(
  HttpRouter.add("POST", "/uploads", upload),
  HttpRouter.add("GET", "/sources/:sourceFileId", download),
);
