import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Planetscale from "alchemy/Planetscale";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { dataPlane } from "./src/data-plane.ts";
import { deploymentConfig } from "./src/deployment-config.ts";
import { operatorEdge } from "./src/operator-edge.ts";
import { platformControls } from "./src/platform-controls.ts";
import { customCloudflareProviders } from "./src/providers/index.ts";
import { workerGraph } from "./src/workers.ts";

const Infrastructure = Effect.gen(function* () {
  const config = yield* deploymentConfig();
  const data = yield* dataPlane(config);
  const platform = yield* platformControls(config);
  const workers = yield* workerGraph(config, data, platform);
  const edge = yield* operatorEdge(config, workers);

  return { app: edge.app, ...workers };
});

export default Alchemy.Stack(
  "Ironcage",
  {
    providers: Layer.mergeAll(
      Cloudflare.providers(),
      Planetscale.providers(),
      customCloudflareProviders(),
    ),
    state: Cloudflare.state(),
  },
  Infrastructure,
);
