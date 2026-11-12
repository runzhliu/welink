import { test, expect } from '@playwright/test';

const sample = [
  { date: '2024-01-01', time: '10:00', is_mine: true, type: 1, content: '虚构回复一' },
  { date: '2024-01-01', time: '10:01', is_mine: true, type: 1, content: '虚构回复二' },
];
test.beforeEach(async ({ page }) => {
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://127.0.0.1:4178') return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    if (url.pathname === '/api/preferences') return route.fulfill({ json: { llm_profiles: [{ id: 'p1', name: '模型一', provider: 'one' }, { id: 'p2', name: '模型二', provider: 'two' }] } });
    if (url.pathname === '/api/contacts/export') return route.fulfill({ json: sample });
    if (url.pathname === '/api/groups/export') return route.fulfill({ json: sample.map(m => ({ ...m, speaker: m.is_mine ? '我' : '虚构成员' })) });
    if (url.pathname === '/api/contacts/detail' || url.pathname === '/api/groups/detail') return route.fulfill({ json: { daily_heatmap: {} } });
    if (url.pathname === '/api/contacts/messages' || url.pathname === '/api/groups/messages') return route.fulfill({ json: sample });
    if (url.pathname === '/api/groups') return route.fulfill({ json: [] });
    if (url.pathname === '/api/ai/conversations') return route.fulfill({ json: { messages: [] } });
    if (url.pathname === '/api/ai/analyze') return route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: 'data: {"delta":"测试回答 [1]"}\n\ndata: {"done":true}\n\n' });
    throw new Error(`Unexpected API ${url.pathname}`);
  });
});

for (const view of ['analysis-contact', 'analysis-group']) test(`私聊群聊分析可查看引用（${view}）`, async ({ page }) => {
  await page.goto(`/tests/visual/fixture.html?view=${view}&theme=light`);
  await page.getByRole('button', { name: view === 'analysis-group' ? '群氛围' : '关系分析', exact: true }).click();
  await expect(page.getByText('查看引用的聊天记录（1）')).toBeVisible();
  await page.getByText('查看引用的聊天记录（1）').click();
  await expect(page.getByRole('button', { name: /\[1\].*虚构回复一/ })).toBeVisible();
});

test('回复助手的示例选择和确认', async ({ page }) => {
  await page.goto('/tests/visual/fixture.html?view=reply&theme=light');
  await page.getByLabel('选择参考联系人').selectOption('synthetic-1');
  await page.getByLabel(/虚构回复一/).check();
  await page.locator('textarea').first().fill('周末见吗');
  await page.getByRole('button', { name: '生成草稿' }).click();
  await expect(page.getByRole('dialog')).toContainText('虚构回复一');
  await page.getByRole('button', { name: '确认生成' }).click();
  await expect(page.getByLabel('回复草稿')).toHaveValue('测试回答 [1]');
});

test('分享预览的图片经过编辑并可下载', async ({ page }) => {
  await page.goto('/tests/visual/fixture.html?view=share&theme=light');
  await page.getByLabel('分享回答').fill('用于分享的合成内容');
  await page.getByRole('button', { name: '生成图片预览' }).click();
  await expect(page.getByAltText('分享图片预览')).toBeVisible({ timeout: 30000 });
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '下载预览图片' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^welink-share-.*\.png$/);
  await page.getByLabel('分享回答').fill('再次编辑');
  await expect(page.getByRole('button', { name: '下载预览图片' })).toHaveCount(0);
});

test('两种模型在确认后并排回答', async ({ page }) => {
  await page.goto('/tests/visual/fixture.html?view=home&theme=light');
  await page.getByRole('button', { name: /虚构联系人/ }).first().click();
  await page.getByLabel('输入分析问题').fill('请总结');
  await page.getByLabel('发送问题').click();
  await page.getByLabel('选择对比模型').selectOption('p2');
  await page.getByRole('button', { name: '确认发送给两个模型' }).click();
  await expect(page.getByRole('dialog', { name: '模型回答对比' })).toContainText('模型一');
  await expect(page.getByRole('dialog', { name: '模型回答对比' })).toContainText('模型二');
  await expect(page.getByText('测试回答 [1]')).toHaveCount(2);
});
