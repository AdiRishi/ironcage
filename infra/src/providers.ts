import * as Cloudflare from "alchemy/Cloudflare";
import { Container, ContainerProvider } from "alchemy/Docker/Container";
import { DockerLive } from "alchemy/Docker/Docker";
import { Providers as DockerProviders } from "alchemy/Docker/Providers";
import { Volume, VolumeProvider } from "alchemy/Docker/Volume";
import * as Planetscale from "alchemy/Planetscale";
import * as Provider from "alchemy/Provider";
import { Layer } from "effect";

const localDatabaseProviders = Layer.effect(
  DockerProviders,
  Provider.collection([Container, Volume]),
).pipe(
  Layer.provide(Layer.mergeAll(ContainerProvider(), VolumeProvider())),
  Layer.provideMerge(DockerLive),
);

export const providers = () =>
  localDatabaseProviders.pipe(
    Layer.provideMerge(Planetscale.providers()),
    Layer.provideMerge(Cloudflare.providers()),
  );
