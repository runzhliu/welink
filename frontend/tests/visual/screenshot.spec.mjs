import { test, expect } from '@playwright/test';
import { PNG } from 'pngjs';
import { readFile } from 'node:fs/promises';

// All data are synthetic. Fail closed on unknown API calls and external hosts.
const contacts = [{
  username: 'synthetic-1', display_name: '一位用于验证长昵称换行与对齐的虚构联系人', avatar_url: '',
  total_hits: 100, my_hits: 48, their_hits: 52, categories: { emoji: 66, action: 25, endearment: 9 },
  first_date: '2020-01-01', last_date: '2025-10-01', top_quotes: [], mutual_score: 0.5,
}];
const social = [{
  username: 'synthetic-1', display_name: '用于检查超长联系人昵称是否会正确换行且不会覆盖右侧数字的虚构联系人', avatar_url: '',
  this_year: 120, last_year: 60, delta: 60, change_pct: 100, flow: 'newcomer', my_ratio_this: 0.5,
}];
const messages = Array.from({ length: 18 }, (_, i) => ({
  time: `${String(9 + Math.floor(i / 6)).padStart(2, '0')}:${String((i % 6) * 10).padStart(2, '0')}`,
  speaker: i % 2 ? '我' : '虚构群成员', content: `第 ${i + 1} 条虚构消息：这段文字用于检查换行、气泡与时间标记。😊`,
  is_mine: i % 2 === 1, type: 1,
}));

async function installFixtures(page) {
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://127.0.0.1:4178') return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    let data;
    if (url.pathname === '/api/labs/flirt-probe') {
      data = { total_contacts_with_hits: 1, total_hits: 100, mutual_pairs: 1, top_contacts: contacts, timeline: [], scanned_contacts: 1, excluded_usernames: [], generated_at: 1 };
    } else if (url.pathname === '/api/labs/social-flow') {
      data = { scanned_contacts: 1, anchor_month: '2025-10', newcomers: social, faded: [], revived: [], all: social, generated_at: 1 };
    } else if (url.pathname === '/api/contacts/active-dates') {
      data = { dates: ['2024-01-01'] };
    } else if (url.pathname === '/api/groups/messages' || url.pathname === '/api/contacts/messages') {
      data = messages;
    } else if (url.pathname === '/api/agent/access') {
      data = route.request().method() === 'POST' ? { token: 'synthetic-only-token', expires_at: '2026-12-01T00:00:00Z' } : { state: 'none' };
    } else {
      throw new Error(`Unexpected API request: ${url.pathname}`);
    }
    await route.fulfill({ json: data });
  });
}

async function downloadedPng(page, button, testInfo, name) {
  const [download] = await Promise.all([page.waitForEvent('download'), button.click()]);
  const path = await download.path();
  const bytes = await readFile(path);
  await testInfo.attach(name, { body: bytes, contentType: 'image/png' });
  return PNG.sync.read(bytes);
}

// Find a solid-color component, without relying on screenshot coordinates or OCR.
function colorBounds(image, color, tolerance = 2) {
  let left = image.width, top = image.height, right = -1, bottom = -1, count = 0;
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const i = (y * image.width + x) * 4;
    if (color.every((c, channel) => Math.abs(image.data[i + channel] - c) <= tolerance)) {
      left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y); count++;
    }
  }
  return { left, top, right, bottom, count };
}

function textBoundsIn(image, rect, color, tolerance = 50) {
  let top = image.height, bottom = -1, count = 0;
  // Exclude the number on the right, which is deliberately rendered with opacity.
  const textRight = rect.left + Math.floor((rect.right - rect.left) * 0.70);
  for (let y = rect.top; y <= rect.bottom; y++) for (let x = rect.left; x <= textRight; x++) {
    const i = (y * image.width + x) * 4;
    if (color.every((c, channel) => Math.abs(image.data[i + channel] - c) <= tolerance)) {
      top = Math.min(top, y); bottom = Math.max(bottom, y); count++;
    }
  }
  return { top, bottom, count };
}

function avatarTextBounds(image, avatar) {
  const width = avatar.right - avatar.left + 1;
  const height = avatar.bottom - avatar.top + 1;
  let top = image.height, bottom = -1, count = 0;
  // The inner half of the circle is entirely background, so white pixels here
  // belong to the initial rather than the white card surrounding the circle.
  for (let y = Math.ceil(avatar.top + height * 0.25); y <= avatar.top + height * 0.75; y++) {
    for (let x = Math.ceil(avatar.left + width * 0.25); x <= avatar.left + width * 0.75; x++) {
      const i = (y * image.width + x) * 4;
      if (image.data[i] > 220 && image.data[i + 1] > 220 && image.data[i + 2] > 220) {
        top = Math.min(top, y); bottom = Math.max(bottom, y); count++;
      }
    }
  }
  return { top, bottom, count };
}

test.beforeEach(async ({ page }) => { await installFixtures(page); });

for (const theme of ['light', 'dark']) {
  test(`暧昧探测标签文字在色块中居中（${theme}）`, async ({ page }, testInfo) => {
    await page.goto(`/tests/visual/fixture.html?view=flirt&theme=${theme}`);
    await expect(page.getByText('暧昧表情').first()).toBeVisible();
    const png = await downloadedPng(page, page.getByRole('button', { name: '截图' }), testInfo, `flirt-${theme}.png`);
    expect(png.width).toBe(1440);
    const badge = colorBounds(png, [254, 243, 199]); // amber-100
    expect(badge.count, '应当在导出图片中找到暧昧表情色块').toBeGreaterThan(100);
    const text = textBoundsIn(png, badge, [180, 83, 9]); // amber-700
    expect(text.count, '标签文字应当被绘制').toBeGreaterThan(10);
    const topGap = text.top - badge.top;
    const bottomGap = badge.bottom - text.bottom;
    expect(topGap, '文字不得触碰色块上边缘').toBeGreaterThan(1);
    expect(bottomGap, '文字不得触碰色块下边缘').toBeGreaterThan(1);
    expect(Math.abs(topGap - bottomGap), `标签文字与背景不居中：上 ${topGap}px，下 ${bottomGap}px`).toBeLessThanOrEqual(Math.max(8, (badge.bottom - badge.top) * 0.22));
  });
}

test('社交圈长昵称、状态和默认头像在导出图中完整呈现', async ({ page }, testInfo) => {
  await page.goto('/tests/visual/fixture.html?view=social');
  await page.getByRole('button', { name: '全员总览' }).click();
  await expect(page.getByText(social[0].display_name)).toBeVisible();
  await page.evaluate(name => {
    window.__captureLayout = null;
    new MutationObserver(() => {
      const wrapper = document.querySelector('[data-capture-id]');
      if (!wrapper || window.__captureLayout) return;
      requestAnimationFrame(() => {
        const spans = [...wrapper.querySelectorAll('span')];
        const title = spans.find(el => el.textContent === name && el.hasAttribute('data-capture-lift-text'));
        const badge = spans.find(el => el.textContent === '新晋核心' && el.hasAttribute('data-capture-lift-text'))?.parentElement;
        const metric = spans.find(el => el.textContent === '+100%' && el.hasAttribute('data-capture-lift-text'));
        if (!title || !badge || !metric) return;
        const range = document.createRange();
        range.selectNodeContents(title);
        const rect = r => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom });
        window.__captureLayout = { lines: [...range.getClientRects()].map(rect), badge: rect(badge.getBoundingClientRect()), metric: rect(metric.getBoundingClientRect()) };
      });
    }).observe(document.body, { childList: true });
  }, social[0].display_name);
  const png = await downloadedPng(page, page.getByRole('button', { name: '截图' }), testInfo, 'social-long-name.png');
  const layout = await page.evaluate(() => window.__captureLayout);
  expect(layout, '应读取实际截图副本的排版').not.toBeNull();
  expect(layout.lines.length, '长昵称应自动换行').toBeGreaterThan(1);
  for (const line of layout.lines) for (const adjacent of [layout.badge, layout.metric]) {
    const intersects = line.left < adjacent.right && line.right > adjacent.left && line.top < adjacent.bottom && line.bottom > adjacent.top;
    expect(intersects, '联系人名字不应覆盖标签或右侧数值').toBe(false);
  }
  expect(png.width).toBe(1440);
  expect(png.height).toBeGreaterThan(500);
  const avatar = colorBounds(png, [8, 127, 91]);
  expect(avatar.count, '默认头像应存在').toBeGreaterThan(100);
  // The center of the avatar must contain light pixels for the initial, not just a blank circle.
  const initial = avatarTextBounds(png, avatar);
  expect(initial.count, '默认头像中的文字应可见').toBeGreaterThan(5);
  expect(Math.abs((initial.top + initial.bottom) / 2 - (avatar.top + avatar.bottom) / 2), '默认头像文字应接近圆心').toBeLessThan((avatar.bottom - avatar.top) * 0.18);
});

for (const [label, width, height] of [
  ['iPhone 18 Pro Max', 1320, 2868],
  ['iPhone Duo 外屏', 1398, 2034],
  ['iPhone Duo 内屏', 1878, 2670],
]) {
  test(`群聊手机屏幕截图尺寸：${label}`, async ({ page }, testInfo) => {
    await page.goto('/tests/visual/fixture.html?view=wechat');
    await expect(page.getByText('虚构群成员').first()).toBeVisible();
    await page.getByRole('button', { name: '导出图片' }).click();
    await page.getByRole('combobox', { name: '选择手机屏幕尺寸' }).click();
    await page.getByRole('option', { name: new RegExp(label) }).click();
    await page.getByLabel('手机屏幕截图').check();
    const png = await downloadedPng(page, page.getByRole('button', { name: '下载 PNG' }), testInfo, `wechat-${width}.png`);
    expect([png.width, png.height]).toEqual([width, height]);
    expect(colorBounds(png, [237, 237, 237], 3).count, '聊天背景应被绘制').toBeGreaterThan(1000);
  });
}

test('群聊长图包含向下延伸的聊天内容', async ({ page }, testInfo) => {
  await page.goto('/tests/visual/fixture.html?view=wechat');
  await expect(page.getByText('虚构群成员').first()).toBeVisible();
  await page.getByRole('button', { name: '导出图片' }).click();
  const png = await downloadedPng(page, page.getByRole('button', { name: '下载 PNG' }), testInfo, 'wechat-long.png');
  expect(png.width).toBe(1320);
  expect(png.height).toBeGreaterThan(2868);
  const bubbles = colorBounds(png, [149, 236, 105]);
  expect(bubbles.count, '长图中应有本人消息气泡').toBeGreaterThan(1000);
  expect(bubbles.bottom, '聊天内容应延伸到长图接近底部的位置').toBeGreaterThan(png.height * 0.8);
});

test('私聊长图包含完整的上下聊天内容', async ({ page }, testInfo) => {
  await page.goto('/tests/visual/fixture.html?view=wechat-private');
  await expect(page.getByText('第 1 条虚构消息', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '导出图片' }).click();
  const png = await downloadedPng(page, page.getByRole('button', { name: '下载 PNG' }), testInfo, 'private-wechat-long.png');
  expect(png.width).toBe(1320);
  expect(png.height).toBeGreaterThan(2868);
  const bubbles = colorBounds(png, [149, 236, 105]);
  expect(bubbles.count, '私聊气泡应被绘制').toBeGreaterThan(1000);
  expect(bubbles.bottom, '末尾消息应出现在长图下方').toBeGreaterThan(png.height * 0.8);
});

for (const theme of ['light', 'dark']) {
  test(`Agent 授权移动端布局与确认流程（${theme}）`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/tests/visual/fixture.html?view=agent&theme=${theme}`);
    await expect(page.getByText('尚未授权')).toBeVisible();
    await page.getByRole('checkbox', { name: /虚构联系人/ }).check();
    await page.getByRole('button', { name: '检查并创建授权' }).click();
    const dialog = page.getByRole('dialog', { name: '确认 Agent 授权' });
    await expect(dialog).toContainText('将授权 1 个会话');
    await dialog.getByRole('button', { name: '确认创建' }).click();
    await expect(page.getByLabel('一次性 Agent 凭据')).toHaveAttribute('type', 'password');
    await expect(page.getByText('授权有效不代表 DSH 已连接。', { exact: false })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });
}
