import * as Cloudflare from "alchemy/Cloudflare";
import { Effect } from "effect";
import { HttpServerResponse } from "effect/unstable/http";

import { Api } from "../../src/api.ts";
import { workerCompatibility } from "../../src/cloudflare-config.ts";

export default class ApiDriver extends Cloudflare.Worker<ApiDriver>()(
  "ApiDriver",
  {
    main: import.meta.url,
    compatibility: workerCompatibility,
    workersDev: true,
  },
  Effect.gen(function* () {
    const api = yield* Cloudflare.Workers.bindWorker(Api);
    return {
      fetch: Effect.gen(function* () {
        return yield* HttpServerResponse.json(yield* api.listAccounts().pipe(Effect.orDie));
      }),
    };
  }),
) {}
