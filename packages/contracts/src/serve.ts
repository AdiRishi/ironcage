import { DateTime, Effect, Layer } from "effect";
import { HttpServer } from "effect/unstable/http";
import { RpcSerialization, RpcServer } from "effect/unstable/rpc";

export const rpcPath = "/rpc";

export const rpcServerLayer = Layer.mergeAll(
  RpcServer.layerProtocolHttp({ path: rpcPath }).pipe(Layer.provide(RpcSerialization.layerJson)),
  HttpServer.layerServices,
);

export const systemPingHandler = (identity: {
  readonly worker: string;
  readonly surface: string;
}) => Effect.map(DateTime.now, (serverTime) => ({ ...identity, serverTime }));
