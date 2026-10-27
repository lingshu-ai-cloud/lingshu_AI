FROM node:22-bookworm-slim AS build

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.19.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY vendor ./vendor
RUN pnpm install --frozen-lockfile

# Keep the image source allowlist explicit. In particular, never copy runtime
# `data/` from a developer or production checkout into a build layer.
COPY index.html tsconfig.json vite.config.ts ./
COPY public ./public
COPY shared ./shared
COPY apps ./apps
COPY src ./src
COPY server ./server
COPY desktop ./desktop
COPY scripts/bootstrap-workbench-admin.mjs scripts/gemini-video-worker.mjs scripts/render-task-report-pdf.py scripts/rekey-tenant-transfer.mjs scripts/check-runtime-readiness.mjs scripts/check-studio-chunk.mjs scripts/studioBundleImports.mjs scripts/sync-mobile-shared.mjs scripts/generate-design-tokens.mjs scripts/sync-mobile-domain.mjs scripts/generate-miniapp-request-policy.mjs scripts/generate-miniapp-action-form.mjs scripts/generate-miniapp-work-status.mjs scripts/generate-miniapp-material-shooting.mjs ./scripts/
COPY scripts/customer-preview-ai-scope.mjs scripts/customer-isolated-test-guard.mjs scripts/customer-isolation-canary.mjs scripts/customer-isolation-diagnostics.mjs scripts/customer-isolated-processes.mjs ./scripts/
COPY scripts/recover-assistant-pb-claims.ts ./scripts/
COPY scripts/fast_head_pipeline.py scripts/fast_head_preflight.py scripts/fast_head_composite.py scripts/person-replacement-quality.ts ./scripts/
COPY scripts/person-replacement-qa-requirements.txt scripts/person_replacement_visual_qa.py scripts/validate-syncnet.py ./scripts/
COPY scripts/recover-assistant-pb-claims.ts ./scripts/
ARG APP_BUILD_SHA=unknown
ENV APP_BUILD_SHA=${APP_BUILD_SHA}
RUN pnpm run build \
  && pnpm prune --prod

FROM node:22-bookworm-slim AS runtime

WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl ffmpeg fonts-wqy-zenhei libgl1 libglib2.0-0 python3 python3-pip \
  && python3 -m pip install --break-system-packages --no-cache-dir "yt-dlp[default,curl-cffi]" reportlab \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable \
  && corepack prepare pnpm@11.19.0 --activate

COPY --from=build /app /app

# The visual QA runtime is part of the application image, not an undeclared
# host dependency. This imports OpenCV/MediaPipe at build time; the live
# readiness probe runs the same script with --self-check.
RUN python3 -m pip install --break-system-packages --no-cache-dir -r /app/scripts/person-replacement-qa-requirements.txt \
  && python3 /app/scripts/person_replacement_visual_qa.py --self-check

ARG APP_BUILD_SHA=unknown
ENV APP_BUILD_SHA=${APP_BUILD_SHA}
ENV NODE_ENV=production
ENV DIGITAL_HUMAN_VISUAL_QA_PYTHON=/usr/bin/python3
EXPOSE 8788

CMD ["pnpm", "run", "start"]
