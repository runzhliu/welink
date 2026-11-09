#!/usr/bin/env bash
# Provision a single-contact, read-only agent credential without printing it.
set -euo pipefail

if [[ $# -ne 3 ]]; then
  printf '用法: %s <WeLink 后端容器> <DSH 容器> <联系人或群聊 username>\n' "$0" >&2
  exit 2
fi
backend=$1
dsh=$2
username=$3
if [[ -z "$username" || "$username" == *$'\n'* ]]; then
  printf 'username 无效\n' >&2
  exit 2
fi

# Refuse to replace an existing policy. Revocation/rotation is an explicit
# operation, because changing the policy invalidates existing clients.
if docker exec "$backend" test -e /app/prefs/agent-access.json; then
  printf 'Agent 授权策略已存在，未覆盖。请先备份并撤销旧策略。\n' >&2
  exit 1
fi

printf '%s' "$username" | docker exec -i "$dsh" node -e '
  const fs = require("fs"), crypto = require("crypto");
  let username = "";
  process.stdin.on("data", b => username += b);
  process.stdin.on("end", () => {
    if (!username || username.trim() !== username || username.length > 128) throw Error("invalid username");
    const dir = "/home/node/.dsh/secrets";
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const token = crypto.randomBytes(32).toString("hex");
    fs.writeFileSync(dir + "/welink-agent-token", token, { flag: "wx", mode: 0o600 });
    process.stdout.write(JSON.stringify({
      token_sha256: crypto.createHash("sha256").update(token).digest("hex"),
      conversations: [username], actions: ["dates", "day", "search"],
      expires_at: new Date(Date.now() + 30 * 86400000).toISOString(),
    }));
  });
' | docker exec -i "$backend" sh -c '
  umask 077
  if test -e /app/prefs/agent-access.json; then exit 1; fi
  cat > /app/prefs/agent-access.json.tmp
  test -s /app/prefs/agent-access.json.tmp
  mv /app/prefs/agent-access.json.tmp /app/prefs/agent-access.json
'
printf '已创建 30 天有效的单会话只读授权；令牌保存在 DSH 容器的 /home/node/.dsh/secrets/welink-agent-token。\n'
