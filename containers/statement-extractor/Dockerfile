FROM node:24.13.0-bookworm-slim AS build

RUN corepack enable
WORKDIR /workspace
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY tooling/tsconfig/package.json tooling/tsconfig/base.json ./tooling/tsconfig/
COPY containers/statement-extractor/package.json ./containers/statement-extractor/
RUN pnpm install --filter @ironcage/statement-extractor --frozen-lockfile
COPY containers/statement-extractor/src ./containers/statement-extractor/src
COPY containers/statement-extractor/tsconfig.json ./containers/statement-extractor/
RUN pnpm --filter @ironcage/statement-extractor build

FROM node:24.13.0-bookworm-slim

ENV NODE_ENV=production
RUN corepack enable
WORKDIR /app
COPY containers/statement-extractor/runtime/package.json containers/statement-extractor/runtime/pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile
COPY --from=build --chown=node:node /workspace/containers/statement-extractor/dist ./dist
USER node
EXPOSE 8080
CMD ["node", "dist/server.js"]
