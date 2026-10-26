#!/usr/bin/env bash
# A fresh cluster per invocation: no inherited DATABASE_URL, no private .env.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
[[ "$(uname -s)" == Linux ]] || { echo 'BLOCKED: this sandbox runner requires Linux Cloud.' >&2; exit 1; }
command -v node >/dev/null || { echo 'BLOCKED: Node 22 is missing.' >&2; exit 1; }
[[ "$(node -p 'process.versions.node.split(".")[0]')" == 22 ]] || { echo 'BLOCKED: Node 22 required.' >&2; exit 1; }
for file in .env .env.local .env.development .env.development.local; do
  [[ ! -e "$file" ]] || { echo "BLOCKED: private environment file present: $file. Use a clean Cloud checkout." >&2; exit 1; }
done
if [[ -x /usr/lib/postgresql/16/bin/initdb ]]; then
  export PATH="/usr/lib/postgresql/16/bin:$PATH"
fi
command -v initdb >/dev/null && command -v pg_ctl >/dev/null || { echo 'BLOCKED: PostgreSQL 16 server tools missing.' >&2; exit 1; }
[[ "$(initdb --version)" == *' 16.'* ]] || { echo 'BLOCKED: PostgreSQL 16 required.' >&2; exit 1; }

cluster="$(mktemp -d /tmp/ai-setter-cloud.XXXXXXXX)"
pg_user=()
if [[ "$(id -u)" == 0 ]]; then
  command -v runuser >/dev/null && id postgres >/dev/null 2>&1 || {
    echo 'BLOCKED: PostgreSQL cannot run as root; provision postgres OS user and runuser.' >&2
    rmdir "$cluster"
    exit 1
  }
  chown postgres "$cluster"
  pg_user=(runuser -u postgres --)
fi
cleanup() {
  "${pg_user[@]}" pg_ctl -D "$cluster/data" -m fast -w stop >/dev/null 2>&1 || true
  # Keep the generated cluster for inspection. It is disposable VM state and
  # never a directory supplied by the caller; a new invocation never reuses it.
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
"${pg_user[@]}" initdb -D "$cluster/data" -U cloud_fixture --auth=trust --encoding=UTF8 --no-locale >/dev/null
"${pg_user[@]}" pg_ctl -D "$cluster/data" -l "$cluster/postgres.log" \
  -o "-h 127.0.0.1 -p 55432 -k $cluster" -w -t 20 start >/dev/null

# All values below are public test placeholders, never production credentials.
export AI_SETTER_CLOUD_SANDBOX=disposable
export DATABASE_URL=postgresql://cloud_fixture@127.0.0.1:55432/ai_setter_cloud
export APP_BASE_URL=http://127.0.0.1:3000
export NODE_ENV=development WA_MOCK_ENABLED=true NEXT_TELEMETRY_DISABLED=1
export BETTER_AUTH_SECRET=synthetic-cloud-auth-placeholder-only
export ENCRYPTION_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=
export META_WEBHOOK_VERIFY_TOKEN=synthetic-cloud-verify-only META_APP_SECRET=
export META_GRAPH_BASE_URL=http://127.0.0.1:3000/api/dev/wa-mock
export OPENROUTER_BASE_URL=http://127.0.0.1:3000/api/dev/ai-mock
export OPENROUTER_API_TOKEN=synthetic-mock-only OPENROUTER_MODEL=synthetic-mock
export OPENROUTER_JUDGE_MODEL=synthetic-mock BOT_API_KEY=synthetic-cloud-bot-placeholder-only
export CHANNELS=whatsapp AGENDA= ATRIBUCION= ALLOW_SIGNUP=true AGENT_COALESCE_MS=0
export ZOOM_BASE_URL=http://127.0.0.1:3000/api/dev/zoom-mock
export ZOOM_OAUTH_BASE_URL=http://127.0.0.1:3000/api/dev/zoom-mock
export GOOGLE_CAL_BASE_URL=http://127.0.0.1:3000/api/dev/google-mock
export GOOGLE_OAUTH_BASE_URL=http://127.0.0.1:3000/api/dev/google-mock
export MEDIA_DIR="$cluster/media"
mkdir -p "$MEDIA_DIR"
"${pg_user[@]}" createdb -h 127.0.0.1 -p 55432 -U cloud_fixture ai_setter_cloud

# Explicit path: scripts/migrate.mjs otherwise looks under scripts/drizzle.
export MIGRATIONS_DIR="$PWD/drizzle"
node scripts/migrate.mjs
node scripts/migrate.mjs
node scripts/cloud/seed.mjs
node scripts/cloud/seed.mjs
if [[ $# -gt 0 ]]; then
  "$@"
else
  node node_modules/typescript/bin/tsc --noEmit --incremental false
  node node_modules/vitest/vitest.mjs run \
    tests/unit/simulated-*.test.ts tests/unit/first-outreach-prompt.test.ts \
    tests/unit/ai-lead-context.test.ts
fi
