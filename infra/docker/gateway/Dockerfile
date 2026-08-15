FROM golang:1.26.6 AS build
WORKDIR /src
COPY go.mod go.sum* ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /out/gateway ./cmd/gateway

FROM alpine:3.20.10
RUN apk add --no-cache wget
COPY --from=build /out/gateway /gateway
EXPOSE 8443 8081
ENTRYPOINT ["/gateway"]
