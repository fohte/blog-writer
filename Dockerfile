FROM node:24.22.1-bookworm-slim AS node

FROM rust:1.98.1-slim-bookworm AS build

COPY --from=node /usr/local/ /usr/local/

RUN apt-get update \
    && apt-get install --no-install-recommends -y build-essential ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable pnpm

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY frontend/package.json frontend/package.json
RUN pnpm install --filter frontend... --frozen-lockfile

COPY frontend frontend
COPY backend backend
COPY scripts/build-release scripts/build-release

WORKDIR /app/backend
RUN /app/scripts/build-release

FROM debian:bookworm-slim

RUN apt-get update \
    && apt-get install --no-install-recommends -y ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/backend/target/release/backend /usr/local/bin/backend

ENV BACKEND_BIND_ADDR=0.0.0.0:3000

EXPOSE 3000
USER 65534:65534
ENTRYPOINT ["/usr/local/bin/backend"]
