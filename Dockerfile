# Build React
FROM node:22-alpine AS web
WORKDIR /src
COPY web/package.json ./
RUN npm install
COPY web/ ./
RUN npm run build

# Build API
FROM golang:1.23-alpine AS api
WORKDIR /src
RUN apk add --no-cache git ca-certificates
COPY go.mod go.sum ./
RUN go mod download
COPY . .
COPY --from=web /src/dist ./web/dist
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /guard-api ./cmd/api

FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata
WORKDIR /app
COPY --from=api /guard-api /app/guard-api
COPY --from=web /src/dist ./web/dist
RUN chown -R nobody:nobody /app
ENV HTTP_ADDR=:8080
ENV STATIC_DIR=/app/web/dist
EXPOSE 8080
USER nobody
ENTRYPOINT ["/app/guard-api"]
