#!/bin/sh
# Run only with synthetic data, an isolated DSH home and no external network.
set -eu
plugin_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
image=${DSH_TEST_IMAGE:-ghcr.io/runzhliu/deepseek-harness:0.2.2-rc.1-r1-superagent.1}
if [ ! -d "$plugin_dir/node_modules/@deepseek-ai/schemastery" ]; then
  echo 'Run npm ci in plugins/dsh-welink first.' >&2
  exit 1
fi
docker run --rm --network none --user node --entrypoint /bin/sh \
  --env DSH_HOME=/tmp/welink-dsh-home --env HOME=/tmp \
  --env WELINK_URL=http://127.0.0.1:19088 \
  --env 'WELINK_ALLOWED_CONVERSATIONS=["synthetic"]' --env WELINK_ALLOW_MESSAGES=1 \
  --mount "type=bind,src=$plugin_dir,dst=/plugin,readonly" \
  --mount "type=bind,src=$plugin_dir/tests/dsh-probe,dst=/probe,readonly" \
  "$image" -c '
    dsh plugin --profile web add --ignore-scripts link:/plugin link:/probe >/tmp/install.log 2>&1 || { echo "DSH plugin installation failed" >&2; exit 1; }
    timeout 30 dsh web --no-open --port 0 >/tmp/start.log 2>&1; code=$?
    node -e '\''const t=require("fs").readFileSync("/tmp/start.log","utf8"); const lines=t.split("\n").filter(l=>/DSH_WELINK_PROBE_(OK|FAILED)/.test(l)); if(lines.length) console.log(lines.join("\n")); else console.error("DSH probe did not complete");'\''
    exit "$code"
  '
