FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/cli/package.json ./apps/cli/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/rum-engine/package.json ./packages/rum-engine/package.json
RUN npm ci --ignore-scripts
COPY apps/web ./apps/web
RUN npm run build -w @rum-tool/web

FROM nginx:stable-alpine

RUN apk add --no-cache curl && \
    adduser -u 1001 -D -S -G nginx appuser && \
    chown -R appuser:nginx /var/cache/nginx && \
    chown -R appuser:nginx /var/log/nginx && \
    touch /var/run/nginx.pid && chown appuser:nginx /var/run/nginx.pid

COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html

USER appuser

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8080/ || exit 1
