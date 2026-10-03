# ---- Stage 1: build React app ----
FROM node:26-alpine AS build
WORKDIR /repo
COPY package.json ./
COPY apps/web/package.json apps/web/package.json
RUN npm install --workspace apps/web --include-workspace-root
COPY tsconfig.base.json ./
COPY apps/web ./apps/web
# The sheet re-exports a few API leaves so the screen and the server share
# one function. Copy only those files, after npm install, so the services/*
# workspace glob does not pull the API into this image. services/api/package.json
# ("type": "module") has to sit next to the copied source so TypeScript's
# package lookup matches the API, same as the worker images. CI's "Build Web"
# step typechecks the full checkout and will not catch a missing COPY here.
# passFail.ts imports nothing. fai.logic.ts also needs the role helper it calls.
COPY services/api/package.json ./services/api/package.json
COPY services/api/src/utils/passFail.ts ./services/api/src/utils/passFail.ts
COPY services/api/src/modules/roles/roleAccess.ts ./services/api/src/modules/roles/roleAccess.ts
COPY services/api/src/modules/fai/fai.logic.ts ./services/api/src/modules/fai/fai.logic.ts
ARG VITE_API_BASE_URL=/api
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
# Optional browser error tracking (see apps/web/src/lib/errorTracking.ts). Empty = the Sentry code is never loaded.
ARG VITE_SENTRY_DSN=
ARG VITE_APP_VERSION=
ENV VITE_SENTRY_DSN=$VITE_SENTRY_DSN
ENV VITE_APP_VERSION=$VITE_APP_VERSION
RUN npm run build --workspace apps/web

# ---- Stage 2: serve via NGINX ----
FROM nginx:1.31-alpine AS runtime
# Pick up OS security patches (OpenSSL, etc.) released since the base image was built.
RUN apk upgrade --no-cache
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
# Official image envsubst: /etc/nginx/templates/*.template -> /etc/nginx/conf.d/
# at container start. Only these names are substituted, so nginx's own
# $uri / $host / $proxy_host are left alone. NGINX_ENTRYPOINT_LOCAL_RESOLVERS
# makes 15-local-resolvers.envsh export NGINX_LOCAL_RESOLVERS from
# /etc/resolv.conf (127.0.0.11 under Compose, Render's DNS on Render).
# The stock default.conf would otherwise also listen on port 80.
ENV API_UPSTREAM_URL=http://api:3000 \
    CF_ACCESS_CLIENT_ID= \
    CF_ACCESS_CLIENT_SECRET= \
    NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1 \
    NGINX_ENVSUBST_FILTER=^(API_UPSTREAM_URL|CF_ACCESS_CLIENT_ID|CF_ACCESS_CLIENT_SECRET|NGINX_LOCAL_RESOLVERS)$$
COPY apps/web/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY apps/web/18-accuqual-proxy.envsh /docker-entrypoint.d/18-accuqual-proxy.envsh
RUN chmod +x /docker-entrypoint.d/18-accuqual-proxy.envsh && rm -f /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
