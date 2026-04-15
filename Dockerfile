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


FROM node:22-slim

ARG VERSION=unknown

LABEL maintainer="findsource@proton.me" \
      version="${VERSION}" \
      description="wxrss Docker image" \
      org.opencontainers.image.source="https://github.com/Mason-x/wxrss" \
      org.opencontainers.image.description="wxrss production image" \
      org.opencontainers.image.licenses="MIT"

# Install Chromium, fonts, and CA roots for server-side PDF export.
RUN apt-get update && apt-get install -y \
    chromium fonts-noto-cjk fonts-noto-color-emoji ca-certificates \
    --no-install-recommends && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
WORKDIR /app

COPY --from=build-env /app/.output ./
# puppeteer 被 Rollup external 排除，运行时需要从 node_modules 加载（Chromium 已通过 apt 安装，跳过下载）
RUN npm install --no-save --ignore-scripts puppeteer@24

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
