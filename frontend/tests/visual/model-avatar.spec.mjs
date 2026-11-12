import { test, expect } from '@playwright/test';
import { PNG } from 'pngjs';

test('ChatGPT 订阅和其他模型图标显示品牌形状，不是实心方块', async ({ page }) => {
  await page.goto('/tests/visual/fixture.html?view=model-avatars&theme=light');
  const openai = page.getByLabel('openai 模型');
  await expect(openai).toHaveCount(2);
  await expect(page.getByLabel('deepseek 模型')).toHaveCount(1);
  await expect(page.getByLabel('AI 助手')).toHaveCount(1);
  for (const avatar of [openai.nth(0), openai.nth(1), page.getByLabel('deepseek 模型')]) {
    await expect(avatar.locator('svg path')).toHaveCount(1);
    const icon = avatar.locator('span');
    const box = await icon.boundingBox();
    expect(box.width).toBeCloseTo(18, 0);
    expect(box.height).toBeCloseTo(18, 0);
    const png = PNG.sync.read(await icon.screenshot());
    let light = 0, colored = 0;
    for (let i = 0; i < png.data.length; i += 4) {
      if (png.data[i] > 245 && png.data[i + 1] > 245 && png.data[i + 2] > 245) light++;
      else colored++;
    }
    expect(light, '图标中应有空白，避免显示为实心色块').toBeGreaterThan(20);
    expect(colored, '图标的品牌形状应可见').toBeGreaterThan(20);
  }
});
