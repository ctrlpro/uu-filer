import { test, expect } from '@playwright/test';
test('preview rules, filter, change privacy and save a reusable preset', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('浏览器演示模式：', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '载入示例' }).click();
  await expect(page.getByRole('textbox', { name: '采购合同_副本.pdf 的新名称' })).toHaveValue(
    '采购合同.pdf',
  );
  await page.getByPlaceholder('例如：项目_').fill('归档_');
  await expect(page.getByRole('textbox', { name: '采购合同_副本.pdf 的新名称' })).toHaveValue(
    '归档_采购合同.pdf',
  );
  await page.getByRole('combobox', { name: '所选文件隐私策略' }).selectOption('deny');
  await expect(page.getByText('禁止 AI', { exact: true })).toHaveCount(6);
  await page.getByLabel('搜索文件', { exact: true }).fill('采购');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await page.getByText('常用方案', { exact: true }).click();
  await page.getByRole('textbox', { name: '方案名称' }).fill('归档方案');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.reload();
  await page.getByText('常用方案', { exact: true }).click();
  await page.getByRole('combobox', { name: '加载命名方案' }).selectOption('归档方案');
  await expect(page.getByPlaceholder('例如：项目_')).toHaveValue('归档_');
});
test('AI and disk execution are explicitly unavailable in browser mode', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '载入示例' }).click();
  await expect(page.getByRole('button', { name: '确认并执行' })).toBeDisabled();
  await page.getByRole('button', { name: 'AI 智能命名' }).click();
  await expect(page.getByRole('button', { name: '生成命名建议' })).toBeDisabled();
  await page.getByRole('combobox', { name: '处理方式' }).selectOption('cloud');
  await expect(page.getByText('先查看内容，再授权发送', { exact: true })).toBeVisible();
});
test('settings dialog has focus, closes with Escape, and makes no network requests', async ({
  page,
}) => {
  const external: string[] = [];
  page.on('request', (r) => {
    if (!r.url().startsWith('http://127.0.0.1:4173')) external.push(r.url());
  });
  await page.goto('/');
  await page.getByRole('button', { name: '偏好与 AI 设置' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByLabel('API Key', { exact: true }).fill('not-a-real-secret');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: '偏好与 AI 设置' }).click();
  await expect(page.getByLabel('API Key', { exact: true })).toHaveValue('');
  expect(external).toEqual([]);
});
