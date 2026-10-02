FROM node:24.19.0-alpine AS build
ARG VITE_API_BASE_URL
ARG VITE_SSE_URL
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
ENV VITE_SSE_URL=${VITE_SSE_URL}
WORKDIR /src
COPY admin-console/package.json admin-console/package-lock.json ./
RUN npm ci
COPY admin-console/. .
RUN npm run build

FROM nginx:1.31.6-alpine
# 태그가 갱신되기 전에 공개된 OS 패키지 보안 수정(예: libexpat, pcre2)을 반영한다.
# CI image-scan은 수정본이 있는 HIGH·CRITICAL을 실패로 본다.
RUN apk upgrade --no-cache
COPY infra/docker/admin-console/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=10s --timeout=3s --retries=3 CMD wget -qO- http://localhost/ || exit 1
