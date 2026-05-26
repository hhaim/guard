#!/usr/bin/env bash
# Build, test, and run the guard stack from source.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

usage() {
  cat <<'EOF'
Usage: ./b <command> [options]

Commands:
  build-ui      Build React UI (web/ → web/dist)
  build-docker  Build Docker images (docker compose build)
  build         Build Go backend (go build ./...)
  build-sim     Build guardsim CLI (bin/guardsim)
  build-cli     Build guardcli DB tool (bin/guardcli)
  build-all     Build UI, backend, and Docker images
  sim           Run guardsim CLI (pass args after sim)
  cli           Run guardcli (pass args after cli; e.g. users list)
  test          Run Go unit tests and Python pytest suite
  run           Start the stack (docker compose up)
  help          Show this help (--help, -h)

Examples:
  ./b build-ui
  ./b build
  ./b build-docker
  ./b build-all
  ./b test
  ./b run
  ./b run --build          # pass extra args to docker compose up
  DATABASE_URL="$(npx -y neonctl@latest connection-string --pooled)" ./b cli users list
EOF
}

cmd_build_ui() {
  if [[ ! -f web/package.json ]]; then
    echo "==> skip web build (no web/package.json)" >&2
    return 0
  fi

  if command -v npm >/dev/null 2>&1; then
    echo "==> npm run build (web/)"
    (cd web && npm ci && npm run build)
    return 0
  fi

  if command -v docker >/dev/null 2>&1; then
    echo "==> npm not found; building UI with node:22-alpine via Docker"
    docker run --rm \
      -v "$ROOT/web:/src" \
      -w /src \
      node:22-alpine \
      sh -c "npm ci && npm run build"
    return 0
  fi

  echo "error: need npm or docker to build web/" >&2
  exit 1
}

cmd_build_backend() {
  echo "==> go build ./..."
  go build ./...
}

cmd_build_sim() {
  echo "==> go build -o bin/guardsim ./cmd/guardsim"
  mkdir -p bin
  go build -o bin/guardsim ./cmd/guardsim
}

cmd_build_cli() {
  echo "==> go build -o bin/guardcli ./cmd/guardcli"
  mkdir -p bin
  go build -o bin/guardcli ./cmd/guardcli
}

cmd_cli() {
  if [[ -x "$ROOT/bin/guardcli" ]]; then
    exec "$ROOT/bin/guardcli" "$@"
  fi
  echo "==> go run ./cmd/guardcli $*"
  go run ./cmd/guardcli "$@"
}

cmd_sim() {
  if [[ -x "$ROOT/bin/guardsim" ]]; then
    exec "$ROOT/bin/guardsim" "$@"
  fi
  echo "==> go run ./cmd/guardsim $*"
  go run ./cmd/guardsim "$@"
}

cmd_build_docker() {
  echo "==> docker compose build"
  docker compose build "$@"
}

cmd_build_all() {
  cmd_build_ui
  cmd_build_backend
  cmd_build_cli
  cmd_build_docker "$@"
}

cmd_test() {
  echo "==> go test ./..."
  go test ./...

  if [[ -d tests ]] && command -v pytest >/dev/null 2>&1; then
    echo "==> pytest"
    pytest
  elif [[ -d tests ]]; then
    echo "==> skip pytest (install: pip install -r requirements-test.txt)"
  fi
}

cmd_run() {
  echo "==> docker compose up"
  docker compose up "$@"
}

main() {
  local cmd="${1:-}"
  shift || true

  case "$cmd" in
    build-ui)     cmd_build_ui "$@" ;;
    build-docker) cmd_build_docker "$@" ;;
    build)        cmd_build_backend "$@" ;;
    build-sim)    cmd_build_sim "$@" ;;
    build-cli)    cmd_build_cli "$@" ;;
    build-all)    cmd_build_all "$@" ;;
    sim)          cmd_sim "$@" ;;
    cli)          cmd_cli "$@" ;;
    test)         cmd_test "$@" ;;
    run)          cmd_run "$@" ;;
    help|--help|-h)
      usage
      ;;
    "")
      usage >&2
      exit 1
      ;;
    *)
      echo "Unknown command: $cmd" >&2
      echo >&2
      usage >&2
      exit 1
      ;;
  esac
}

main "$@"
