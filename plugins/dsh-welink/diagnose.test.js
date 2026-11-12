import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { diagnose } from './diagnose.js';

test('DSH 环境诊断只查询授权日期，不返回凭据或日期', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'welink-diagnose-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'token'); await writeFile(file, 'test-secret');
  let request;
  const result = await diagnose({ WELINK_URL: 'http://127.0.0.1:8088', WELINK_TOKEN_FILE: file, WELINK_ALLOWED_CONVERSATIONS: '["fake"]' }, async (url, options) => {
    request = { url, options }; return new Response(JSON.stringify({ dates: ['2020-01-01'], has_more: false }));
  });
  assert.deepEqual(JSON.parse(request.options.body), { action: 'dates', username: 'fake', offset: 0, max_items: 1, max_chars: 500 });
  assert.equal(request.options.headers.Authorization, 'Bearer test-secret');
  assert.doesNotMatch(result, /test-secret|2020-01-01|fake/);
});

test('诊断缺少凭据或会话时不发请求', async () => {
  let called = false;
  await assert.rejects(diagnose({ WELINK_ALLOWED_CONVERSATIONS: '[]' }, async () => { called = true; }), /WELINK_TOKEN_FILE/);
  await assert.rejects(diagnose({ WELINK_TOKEN_FILE: '/tmp/unused', WELINK_ALLOWED_CONVERSATIONS: '[]' }, async () => { called = true; }), /白名单为空/);
  assert.equal(called, false);
});
