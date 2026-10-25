import { test, expect } from '@playwright/test';

test('rules, search, privacy and user presets survive the compact layout', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('浏览器演示', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '载入示例', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '采购合同_副本.pdf 的新名称' })).toHaveValue(
    '采购合同.pdf',
  );
  await page.getByPlaceholder('例如：项目_').fill('归档_');
  await expect(page.getByRole('textbox', { name: '采购合同_副本.pdf 的新名称' })).toHaveValue(
    '归档_采购合同.pdf',
  );
  await page.getByRole('combobox', { name: '所选文件隐私策略' }).selectOption('deny');
  await expect(page.locator('.policy.deny')).toHaveCount(6);
  await page.getByRole('textbox', { name: '搜索文件', exact: true }).fill('采购');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('textbox', { name: '方案名称' }).fill('归档方案');
  await page.getByRole('dialog').getByRole('button', { name: '保存', exact: true }).click();
  await page.reload();
  await page.getByRole('combobox', { name: '加载命名方案' }).selectOption('归档方案');
  await expect(page.getByPlaceholder('例如：项目_')).toHaveValue('归档_');
});

test('all twelve built-ins generate real previews and survive inspector tab changes', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '载入示例', exact: true }).click();
  await page.getByRole('tab', { name: '内置规则', exact: false }).click();
  await expect(page.locator('.preset-item')).toHaveCount(12);
  await page.getByRole('button', { name: '连续编号', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '采购合同_副本.pdf 的新名称' })).toHaveValue(
    '采购合同_副本_001.pdf',
  );
  await page.getByRole('tab', { name: 'AI 命名', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '采购合同_副本.pdf 的新名称' })).toHaveValue(
    '采购合同_副本_001.pdf',
  );
  await page.getByRole('tab', { name: '规则', exact: true }).click();
  await page.getByLabel('起始数字', { exact: true }).fill('9');
  await expect(page.getByRole('textbox', { name: '采购合同_副本.pdf 的新名称' })).toHaveValue(
    '采购合同_副本_009.pdf',
  );
  await page.getByRole('tab', { name: '内置规则', exact: false }).click();
  await page.getByLabel('搜索内置规则', { exact: true }).fill('日期');
  await expect(page.locator('.preset-item')).toHaveCount(1);
});

test('browser AI and disk execution stay disabled and settings clear the key on Escape', async ({
  page,
}) => {
  const external: string[] = [];
  page.on('request', (r) => {
    if (!r.url().startsWith('http://127.0.0.1:4173')) external.push(r.url());
  });
  await page.goto('/');
  await page.getByRole('button', { name: '载入示例', exact: true }).click();
  await expect(page.getByRole('button', { name: '确认并执行', exact: true })).toBeDisabled();
  await page.getByRole('tab', { name: 'AI 命名', exact: true }).click();
  await expect(page.getByRole('button', { name: '查看内容并生成', exact: true })).toBeDisabled();
  await page.getByRole('combobox', { name: '处理方式', exact: true }).selectOption('cloud');
  await expect(page.getByText('逐次授权云端发送', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '偏好与 AI 设置', exact: true }).click();
  await page.getByRole('tab', { name: 'AI 服务', exact: true }).click();
  await page.getByLabel('API Key', { exact: true }).fill('not-a-real-secret');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: '偏好与 AI 设置', exact: true }).click();
  await page.getByRole('tab', { name: 'AI 服务', exact: true }).click();
  await expect(page.getByLabel('API Key', { exact: true })).toHaveValue('');
  expect(external).toEqual([]);
});

test('palette accepts arbitrary HEX, rejects invalid input and persists all appearance settings', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '载入示例', exact: true }).click();
  await page.getByRole('button', { name: '全局外观', exact: true }).click();
  const hex = page.getByRole('textbox', { name: '强调色 HEX', exact: true });
  await hex.fill('#c9a23b');
  await expect(page.locator('html')).toHaveCSS('--accent', '#c9a23b');
  await hex.fill('#oops');
  await expect(hex).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('html')).toHaveCSS('--accent', '#c9a23b');
  await hex.fill('#19a78e');
  await page.getByRole('button', { name: '深色', exact: true }).click();
  await page.getByRole('combobox', { name: '列表密度', exact: true }).selectOption('compact');
  await page.getByRole('slider', { name: '操作面板宽度', exact: true }).fill('405');
  await page.keyboard.press('Escape');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-density', 'compact');
  await expect(page.locator('tbody tr').first()).toHaveCSS('height', '30px');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('html')).toHaveCSS('--accent', '#19a78e');
  await expect(page.getByRole('complementary', { name: '操作面板' })).toHaveCSS('width', '405px');
  await page.getByRole('button', { name: '全局外观', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '强调色 HEX', exact: true })).toHaveValue(
    '#19a78e',
  );
  const palette = page.getByRole('button', { name: '调色板：饱和度与亮度', exact: true });
  await palette.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('html')).not.toHaveCSS('--accent', '#19a78e');
});

test('system theme follows OS, and panels collapse without losing rules', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: '载入示例', exact: true }).click();
  await page.getByPlaceholder('例如：项目_').fill('KEEP_');
  await page.getByRole('button', { name: '收起操作面板', exact: true }).click();
  await expect(page.getByRole('complementary', { name: '操作面板' })).toHaveCount(0);
  await page.getByRole('button', { name: '展开操作面板', exact: true }).click();
  await expect(page.getByPlaceholder('例如：项目_')).toHaveValue('KEEP_');
  await page.getByRole('separator', { name: '调整操作面板宽度' }).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('complementary', { name: '操作面板' })).toHaveCSS('width', '344px');
});

test('selection applies to filtered files and conflicting names are marked', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '载入示例', exact: true }).click();
  await page.getByRole('textbox', { name: '搜索文件', exact: true }).fill('采购');
  await page.getByRole('checkbox', { name: '选择所有可见文件', exact: true }).uncheck();
  await page.getByRole('textbox', { name: '搜索文件', exact: true }).fill('');
  await expect(
    page.getByRole('checkbox', { name: '选择 采购合同_副本.pdf', exact: true }),
  ).not.toBeChecked();
  await page.getByRole('checkbox', { name: '选择所有可见文件', exact: true }).check();
  await page.getByRole('textbox', { name: '采购合同_副本.pdf 的新名称' }).fill('duplicate.txt');
  await page.getByRole('textbox', { name: '项目计划_副本.txt 的新名称' }).fill('duplicate.txt');
  await expect(page.locator('.state-tag.error')).toHaveCount(2);
  await page.getByRole('button', { name: '仅看更改', exact: true }).click();
  await page.getByRole('textbox', { name: '搜索文件', exact: true }).focus();
  await page.keyboard.press('Control+a');
  await expect(page.getByRole('checkbox', { name: '选择所有可见文件', exact: true })).toBeChecked();
});

test('large file lists are virtualized and the final row is reachable', async ({ page }) => {
  await page.goto('/');
  await page
    .locator('input[type=file]')
    .first()
    .setInputFiles(
      Array.from({ length: 600 }, (_, i) => ({
        name: `sample-${String(i).padStart(4, '0')}.txt`,
        mimeType: 'text/plain',
        buffer: Buffer.from('fixture'),
      })),
    );
  await expect(page.getByText('600 个文件 · 显示 600 项', { exact: true })).toBeVisible();
  expect(await page.locator('tbody tr').count()).toBeLessThan(100);
  await page.locator('.table-scroll').evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect(page.getByText('sample-0599.txt', { exact: true })).toBeVisible();
  expect(await page.locator('tbody tr').count()).toBeLessThan(100);
});
