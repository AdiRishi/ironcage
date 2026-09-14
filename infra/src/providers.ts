import * as Cloudflare from "alchemy/Cloudflare";
import * as Planetscale from "alchemy/Planetscale";
import { Layer } from "effect";

import { localDatabaseProviders } from "./database/providers.ts";

export const providers = () =>
  localDatabaseProviders.pipe(
    Layer.provideMerge(Planetscale.providers()),
    Layer.provideMerge(Cloudflare.providers()),
  );
