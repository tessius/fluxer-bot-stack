# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS base
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates fontconfig \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@11.6.0 --activate
WORKDIR /app

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm run build
WORKDIR /app/dashboard
ARG VITE_FLUXER_INSTANCE_API=https://api.fluxer.app
ARG VITE_FLUXER_INSTANCE_WEB=https://web.fluxer.app
ARG VITE_FLUXER_INSTANCE_MEDIA=https://fluxerusercontent.com
ARG VITE_FLUXER_CLIENT_ID=1474069931333816428
RUN printf 'VITE_MOCK_MODE=false\nVITE_FLUXER_INSTANCE_API=%s\nVITE_FLUXER_INSTANCE_WEB=%s\nVITE_FLUXER_INSTANCE_MEDIA=%s\nVITE_FLUXER_CLIENT_ID=%s\n' \
  "$VITE_FLUXER_INSTANCE_API" "$VITE_FLUXER_INSTANCE_WEB" "$VITE_FLUXER_INSTANCE_MEDIA" "$VITE_FLUXER_CLIENT_ID" > .env.production
RUN pnpm run build
WORKDIR /app
ENV CI=true
RUN pnpm prune --prod --ignore-scripts

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY --from=build /app/dashboard/dist ./dashboard/dist
COPY --from=build /app/.forgejo/.shrek ./.forgejo/.shrek
COPY --from=build /app/scripts/preflight-slot.js ./scripts/preflight-slot.js
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 4000 4001
ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "build/index.js"]
