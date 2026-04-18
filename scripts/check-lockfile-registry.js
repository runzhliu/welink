#!/usr/bin/env node
/**
 * 检查 npm lockfile 里所有 "resolved" URL 的 host 是否都在公开 registry 白名单内。
 * 任何落在白名单外的 host（常见是公司内网私服）都会 fail CI，避免 runner 解析不了。
 *
 * 用法：node scripts/check-lockfile-registry.js <path/to/package-lock.json>
 */

const fs = require('fs');
const path = require('path');

const ALLOWED_HOSTS = new Set([
  'registry.npmjs.org',
  'registry.npmmirror.com',
  // 如果未来需要临时放行别的公开 mirror，加到这里
]);

const lockPath = process.argv[2];
if (!lockPath) {
  console.error('usage: node check-lockfile-registry.js <package-lock.json>');
  process.exit(2);
}

const abs = path.resolve(lockPath);
if (!fs.existsSync(abs)) {
  console.error(`lockfile not found: ${abs}`);
  process.exit(2);
}

const data = JSON.parse(fs.readFileSync(abs, 'utf8'));
const badHosts = new Map(); // host → sample package name

function walk(obj, pkgName) {
  if (!obj || typeof obj !== 'object') return;
  if (typeof obj.resolved === 'string') {
    try {
      const host = new URL(obj.resolved).host;
      if (host && !ALLOWED_HOSTS.has(host)) {
        if (!badHosts.has(host)) badHosts.set(host, pkgName || '?');
      }
    } catch { /* 非法 URL 忽略 */ }
  }
  if (obj.packages && typeof obj.packages === 'object') {
    for (const [k, v] of Object.entries(obj.packages)) walk(v, k);
  }
  if (obj.dependencies && typeof obj.dependencies === 'object') {
    for (const [k, v] of Object.entries(obj.dependencies)) walk(v, k);
  }
}
walk(data, '');

if (badHosts.size > 0) {
  console.error(`::error::${lockPath} 含非白名单 registry：`);
  for (const [host, pkg] of badHosts) {
    console.error(`  - ${host}  (来自依赖 "${pkg}")`);
  }
  console.error('');
  console.error('允许的 host：');
  for (const h of ALLOWED_HOSTS) console.error(`  - ${h}`);
  console.error('');
  console.error('常见原因：开发者全局 npm 配置指向了私服，安装新依赖时把其 URL 刻进 lockfile。');
  console.error('修复：cd frontend && rm -rf node_modules && npm install（仓库 .npmrc 会走白名单 registry）');
  process.exit(1);
}

console.log(`OK: ${lockPath} 所有 resolved URL 都在白名单内（${ALLOWED_HOSTS.size} 个允许的 host）`);
