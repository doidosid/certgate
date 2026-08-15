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

FROM nginx:1.27.5-alpine
COPY infra/docker/admin-console/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=10s --timeout=3s --retries=3 CMD wget -qO- http://localhost/ || exit 1
