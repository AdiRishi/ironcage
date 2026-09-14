import * as Command from "alchemy/Command";
import { Container, ContainerProvider } from "alchemy/Docker/Container";
import { DockerLive } from "alchemy/Docker/Docker";
import { Providers as DockerProviders } from "alchemy/Docker/Providers";
import { Volume, VolumeProvider } from "alchemy/Docker/Volume";
import * as Provider from "alchemy/Provider";
import { Layer } from "effect";

export const localDatabaseProviders = Layer.effect(
  DockerProviders,
  Provider.collection([Container, Volume]),
).pipe(
  Layer.provide(Layer.mergeAll(ContainerProvider(), VolumeProvider())),
  Layer.provideMerge(DockerLive),
  Layer.provideMerge(Command.providers()),
);
