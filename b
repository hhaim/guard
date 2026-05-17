#!/usr/bin/env bash
# Build, test, and run the guard stack from source.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

usage() {
  cat <<'EOF'
Usage: ./b <command> [options]

Commands:
  build       Build Go binaries and Docker images (docker compose build)
  test        Run Go unit tests and Python pytest suite
  run         Start the stack (docker compose up)
  help        Show this help (--help, -h)

Examples:
  ./b build
  ./b test
  ./b run
  ./b run --build          # pass extra args to docker compose up
EOF
}

cmd_build() {
  echo "==> go build ./..."
  go build ./...

  if [[ -f web/package.json ]]; then
    if command -v npm >/dev/null 2>&1; then
      echo "==> npm run build (web/)"
      (cd web && npm ci && npm run build)
    else
      echo "==> skip web npm build (npm not installed; Docker build will compile UI)"
    fi
  fi

  echo "==> docker compose build"
  docker compose build "$@"
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
    build) cmd_build "$@" ;;
    test)  cmd_test "$@" ;;
    run)   cmd_run "$@" ;;
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
