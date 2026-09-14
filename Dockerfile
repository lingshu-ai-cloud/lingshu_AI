FROM node:22-bookworm-slim AS build

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.19.0 --activate

COPY package.json pnpm-lock.yaml ./
COPY vendor ./vendor
RUN pnpm install --frozen-lockfile

# Keep the image source allowlist explicit. In particular, never copy runtime
# `data/` from a developer or production checkout into a build layer.
COPY index.html tsconfig.json vite.config.ts ./
COPY public ./public
COPY shared ./shared
COPY src ./src
COPY server ./server
COPY desktop ./desktop
COPY scripts/bootstrap-workbench-admin.mjs scripts/gemini-video-worker.mjs scripts/render-task-report-pdf.py ./scripts/
RUN pnpm run build \
  && pnpm prune --prod

FROM node:22-bookworm-slim AS runtime

WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl fonts-wqy-zenhei python3 python3-pip \
  && python3 -m pip install --break-system-packages --no-cache-dir "yt-dlp[default,curl-cffi]" reportlab \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable \
  && corepack prepare pnpm@11.19.0 --activate

COPY --from=build /app /app

ENV NODE_ENV=production
EXPOSE 8788

CMD ["pnpm", "run", "start"]
