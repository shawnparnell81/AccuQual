# ---- Stage 1: build React app ----
FROM node:20-alpine AS build
WORKDIR /repo
COPY package.json ./
COPY apps/web/package.json apps/web/package.json
RUN npm install --workspace apps/web --include-workspace-root
COPY tsconfig.base.json ./
COPY apps/web ./apps/web
ARG VITE_API_BASE_URL=/api
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
# Optional browser error tracking (see apps/web/src/lib/errorTracking.ts). Empty = the Sentry code is never loaded.
ARG VITE_SENTRY_DSN=
ARG VITE_APP_VERSION=
ENV VITE_SENTRY_DSN=$VITE_SENTRY_DSN
ENV VITE_APP_VERSION=$VITE_APP_VERSION
RUN npm run build --workspace apps/web

# ---- Stage 2: serve via NGINX ----
FROM nginx:1.29-alpine AS runtime
# Pick up OS security patches (OpenSSL, etc.) released since the base image was built.
RUN apk upgrade --no-cache
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
