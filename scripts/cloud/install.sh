#!/usr/bin/env bash
# Run only in the Cloud preparation VM. No host installation or secret files.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

[[ "$(uname -s)" == Linux ]] || { echo 'BLOCKED: run installation in a Linux Cloud environment.' >&2; exit 1; }
command -v node >/dev/null || { echo 'BLOCKED: provision Node 22 in Cloud setup.' >&2; exit 1; }
node --input-type=module -e '
  import fs from "node:fs";
  const config = JSON.parse(fs.readFileSync("scripts/cloud/environment.json", "utf8"));
  if (Number(process.versions.node.split(".")[0]) !== config.nodeMajor) {
    throw new Error(`Cloud setup requires Node ${config.nodeMajor}; found ${process.version}`);
  }
'

manager="$(node -p 'require("./package.json").packageManager')"
expected="${manager#pnpm@}"
if command -v pnpm >/dev/null && [[ "$(pnpm --version)" == "$expected" ]]; then
  pnpm_cmd=(pnpm)
elif command -v corepack >/dev/null; then
  corepack prepare "$manager" --activate
  pnpm_cmd=(corepack pnpm)
elif command -v npm >/dev/null; then
  npm install --global "$manager"
  pnpm_cmd=(pnpm)
else
  echo "BLOCKED: provision $manager or Corepack in Cloud setup." >&2
  exit 1
fi
[[ "$("${pnpm_cmd[@]}" --version)" == "$expected" ]] || {
  echo "BLOCKED: provision $manager from package.json; do not rewrite the lockfile." >&2
  exit 1
}

# Ubuntu exposes server tools outside PATH. Never connect to an existing DB.
if [[ -x /usr/lib/postgresql/16/bin/initdb ]]; then
  export PATH="/usr/lib/postgresql/16/bin:$PATH"
fi
command -v initdb >/dev/null && command -v pg_ctl >/dev/null || {
  echo 'BLOCKED: provision PostgreSQL 16 server binaries in Cloud setup (Ubuntu: postgresql-16).' >&2
  exit 1
}
[[ "$(initdb --version)" == *' 16.'* ]] || { echo 'BLOCKED: PostgreSQL 16 required.' >&2; exit 1; }
node --version
"${pnpm_cmd[@]}" --version
initdb --version
"${pnpm_cmd[@]}" install --frozen-lockfile
