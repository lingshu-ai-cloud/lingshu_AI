FROM node:22-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5 AS build

WORKDIR /app
COPY package.json package-lock.json ./
COPY vendor/xlsx-0.20.3.tgz ./vendor/xlsx-0.20.3.tgz
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5 AS runtime

ENV NODE_ENV=production \
    HOME=/home/node \
    NPM_CONFIG_CACHE=/home/node/.npm

COPY requirements-runtime.txt /tmp/requirements-runtime.txt
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl fonts-wqy-zenhei python3 python3-pip tini \
  && python3 -m pip install --break-system-packages --no-cache-dir --require-hashes -r /tmp/requirements-runtime.txt \
  && rm -f /tmp/requirements-runtime.txt \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
COPY vendor/xlsx-0.20.3.tgz ./vendor/xlsx-0.20.3.tgz
RUN npm ci --omit=dev \
  && npm cache clean --force

COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/server ./server
COPY --from=build --chown=node:node /app/scripts ./scripts
COPY --from=build --chown=node:node /app/src ./src
COPY --from=build --chown=node:node /app/desktop ./desktop

RUN mkdir -p /app/data /home/node/.npm \
  && chown -R node:node /app /home/node

USER node
EXPOSE 8788
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sh", "-c", "npm run setup:pb && exec npm run start"]
