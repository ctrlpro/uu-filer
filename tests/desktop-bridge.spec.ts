import { test, expect } from '@playwright/test';
import { installDesktopFixture, ipcCalls } from './native-fixture';

test('content AI preserves consent and adds a base-name step without clearing ordinary rules', async ({
  page,
}) => {
  await installDesktopFixture(page);
  await page.goto('/');
  await page.getByRole('button', { name: '添加文件', exact: true }).first().click();
  await page.getByRole('button', { name: '添加规则：添加前缀', exact: true }).click();
  await page.getByLabel('前缀文字', { exact: true }).fill('项目_');
  await page.getByRole('combobox', { name: '所选文件隐私策略' }).selectOption('cloud');
  await page.getByRole('tab', { name: 'AI 助手', exact: true }).click();
  await page.getByRole('combobox', { name: 'AI 任务', exact: true }).selectOption('names');
  await page.getByRole('combobox', { name: '处理方式', exact: true }).selectOption('cloud');
  await page.getByRole('button', { name: '查看内容并生成', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '确认云端发送' })).toBeVisible();
  await expect(page.getByText('FILE_CONTENT_FIXTURE_FOR_CONSENT', { exact: false })).toBeVisible();
  expect(await ipcCalls(page, 'generate_ai')).toHaveLength(0);
  await page.getByRole('button', { name: '取消并清除内容', exact: true }).click();
  await expect.poll(async () => (await ipcCalls(page, 'discard_ai')).length).toBe(1);
  expect(await ipcCalls(page, 'generate_ai')).toHaveLength(0);
  await page.getByRole('button', { name: '查看内容并生成', exact: true }).click();
  await page.getByRole('button', { name: '同意发送以上内容', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'report 01.txt 的新名称' })).toHaveValue(
    '项目_整理 report.txt',
  );
  await expect(page.locator('.applied-rule')).toHaveCount(2);
  expect((await ipcCalls(page, 'generate_ai'))[0].args).toEqual({
    token: 'fixture-grant',
    cloudConsent: true,
  });
  await expect(page.getByRole('button', { name: '确认并执行', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '确认并执行', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '确认文件操作' })).toBeVisible();
  expect(await ipcCalls(page, 'execute')).toHaveLength(0);
  await page.getByRole('button', { name: '确认执行', exact: true }).click();
  await expect.poll(async () => (await ipcCalls(page, 'execute')).length).toBe(1);
  expect((await ipcCalls(page, 'execute'))[0].args).toEqual({
    changes: [{ id: 'fixture-1', name: '项目_整理 report.txt' }],
    operation: 'rename',
    destination: null,
  });
  await page.getByRole('button', { name: '历史 / 恢复', exact: true }).click();
  await page.getByRole('button', { name: '恢复 / 撤销', exact: true }).click();
  expect(await ipcCalls(page, 'undo')).toHaveLength(0);
  await page.getByRole('button', { name: '确认恢复', exact: true }).click();
  await expect.poll(async () => (await ipcCalls(page, 'undo')).length).toBe(1);
});

test('natural language references allowed list filenames, stages rules and never executes automatically', async ({
  page,
}) => {
  await installDesktopFixture(page, true);
  await page.goto('/');
  await page.getByRole('button', { name: '添加文件', exact: true }).first().click();
  await page.getByRole('button', { name: '添加规则：添加前缀', exact: true }).click();
  await page.getByLabel('前缀文字', { exact: true }).fill('已有_');
  await page.getByRole('checkbox', { name: '选择 PRIVATE_MARKER.txt', exact: true }).uncheck();
  await page.getByRole('tab', { name: 'AI 助手', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'AI 任务', exact: true })).toHaveValue('rules');
  await page.getByRole('combobox', { name: '参考文件名', exact: true }).selectOption('all');
  await page.getByRole('combobox', { name: '处理方式', exact: true }).selectOption('cloud');
  await page.getByRole('button', { name: '预览文件名并生成规则', exact: true }).click();
  const consent = page.getByRole('dialog', { name: '确认云端发送' });
  await expect(consent.locator('.payload-block').last()).toContainText('photo copy.JPG');
  await expect(consent.locator('.payload-block').last()).not.toContainText('PRIVATE_MARKER');
  await expect(consent.locator('.payload-block').last()).not.toContainText('report 01.txt');
  const options = (await ipcCalls(page, 'prepare_ai'))[0].args.options;
  expect(options.task).toBe('rules');
  expect(options.content).toBe(false);
  expect((await ipcCalls(page, 'prepare_ai'))[0].args.ids.slice().sort()).toEqual([
    'fixture-1',
    'fixture-2',
    'fixture-3',
  ]);
  await page.getByRole('button', { name: '同意发送以上内容', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'AI 规则草案' })).toBeVisible();
  await expect(page.locator('.applied-rule')).toHaveCount(1);
  expect(await ipcCalls(page, 'execute')).toHaveLength(0);
  await page.getByRole('button', { name: '加入应用区并预览', exact: true }).click();
  await expect(page.locator('.applied-rule')).toHaveCount(3);
  await expect(page.getByRole('textbox', { name: 'report 01.txt 的新名称' })).toHaveValue(
    '项目_A_已有_report_01.txt',
  );
  expect(await ipcCalls(page, 'execute')).toHaveLength(0);
  await page.getByRole('tab', { name: 'AI 助手', exact: true }).click();
  await page.getByRole('button', { name: '预览文件名并生成规则', exact: true }).click();
  await page.getByRole('button', { name: '同意发送以上内容', exact: true }).click();
  await page.getByRole('radio', { name: '替换整组规则', exact: true }).check();
  await expect(page.getByRole('button', { name: '加入应用区并预览', exact: true })).toBeDisabled();
  await page.getByRole('checkbox', { name: '确认替换当前 3 条规则', exact: true }).check();
  await page.getByRole('button', { name: '加入应用区并预览', exact: true }).click();
  await expect(page.locator('.applied-rule')).toHaveCount(2);
  await expect(page.getByRole('textbox', { name: 'report 01.txt 的新名称' })).toHaveValue(
    '项目_A_report_01.txt',
  );
  expect(await ipcCalls(page, 'execute')).toHaveLength(0);
});

test('invalid model rule output is rejected without changing the pipeline', async ({ page }) => {
  await installDesktopFixture(page);
  await page.goto('/');
  await page.getByRole('button', { name: '添加文件', exact: true }).first().click();
  await page.getByRole('button', { name: '添加规则：清除首尾空格', exact: true }).click();
  await page.evaluate(() => {
    (window as unknown as { fixtureRules: unknown }).fixtureRules = {
      rules: [{ kind: 'shell', params: { command: 'do-not-execute' } }],
      explanation: 'invalid fixture',
    };
  });
  await page.getByRole('tab', { name: 'AI 助手', exact: true }).click();
  await page.getByRole('combobox', { name: '所选文件隐私策略' }).selectOption('cloud');
  await page.getByRole('combobox', { name: '处理方式', exact: true }).selectOption('cloud');
  await page.getByRole('button', { name: '预览文件名并生成规则', exact: true }).click();
  await page.getByRole('button', { name: '同意发送以上内容', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('不支持的规则');
  await expect(page.locator('.applied-rule')).toHaveCount(1);
  expect(await ipcCalls(page, 'execute')).toHaveLength(0);
  await expect(page.getByRole('dialog', { name: 'AI 规则草案' })).toHaveCount(0);
});
