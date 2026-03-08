FROM node:22-alpine AS build-env

RUN corepack enable
RUN corepack prepare yarn@1.22.22 --activate
RUN apk add --no-cache python3 py3-setuptools make g++

WORKDIR /app

# Copy the full repo before install because yarn lifecycle scripts
# reference files under scripts/ and Nuxt config during install.
COPY . .

# Build needs devDependencies, so install the full dependency set here.
RUN yarn install --frozen-lockfile && yarn cache clean

ENV NODE_ENV=production \
    SQLITE_DB_PATH=.data/sqlite/app.db \
    NITRO_KV_DRIVER=fs \
    NITRO_KV_BASE=.data/kv

RUN yarn build


FROM node:22-alpine

ARG VERSION=unknown

LABEL maintainer="findsource@proton.me" \
      version="${VERSION}" \
      description="wxrss Docker image" \
      org.opencontainers.image.source="https://github.com/Mason-x/wxrss" \
      org.opencontainers.image.description="wxrss production image" \
      org.opencontainers.image.licenses="MIT"

WORKDIR /app

COPY --from=build-env /app/.output ./

RUN mkdir -p .data/kv .data/sqlite && chown -R node:node /app

USER node

EXPOSE 3000

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    SQLITE_DB_PATH=.data/sqlite/app.db \
    NITRO_KV_DRIVER=fs \
    NITRO_KV_BASE=.data/kv

ENTRYPOINT ["node", "server/index.mjs"]
