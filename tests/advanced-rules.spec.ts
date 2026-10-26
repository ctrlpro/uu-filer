import { test, expect, type Page } from '@playwright/test';
import { installDesktopFixture, ipcCalls } from './native-fixture';
import { readFileSync } from 'node:fs';
const schema = JSON.parse(
  readFileSync(new URL('../src-tauri/rule-schema.json', import.meta.url), 'utf8'),
);
function expressionDefaults(op: string): Record<string, unknown> {
  const def = schema.find((d: { op: string }) => d.op === op);
  return {
    op,
    ...Object.fromEntries(
      def.fields.map((f: { key: string; default: unknown }) => [f.key, structuredClone(f.default)]),
    ),
  };
}
function expression(op: string, updates: Record<string, unknown> = {}) {
  return { kind: 'expression', params: { ...expressionDefaults(op), ...updates } };
}
const files = [
  {
    id: 'contract-1',
    path: '/fixture/华星-20260105-HT003.pdf',
    name: '华星-20260105-HT003.pdf',
    extension: 'pdf',
    size: 42,
    modified: 1_704_067_200_000_000_000,
    policy: 'cloud',
  },
];
async function setup(page: Page, entries = files) {
  await installDesktopFixture(page, false, entries);
  await page.goto('/');
  await page.getByRole('button', { name: '添加文件', exact: true }).first().click();
}
async function add(page: Page, name: string) {
  await page.getByRole('tab', { name: '规则库', exact: false }).click();
  await page.getByRole('button', { name: `添加规则：${name}`, exact: true }).click();
}
async function ai(page: Page, rules: unknown) {
  await page.evaluate((r) => {
    (window as unknown as { fixtureRules: unknown }).fixtureRules = r;
  }, rules);
  await page.getByRole('tab', { name: 'AI 助手', exact: true }).click();
  await page.getByLabel('处理方式', { exact: true }).selectOption('cloud');
}
async function generate(page: Page) {
  await page.getByRole('button', { name: '预览文件名并生成规则', exact: true }).click();
  await page.getByRole('button', { name: '同意发送以上内容', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'AI 规则草案' })).toBeVisible();
}

test('manual extract, date field and template use the native engine and expose captures', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1320, height: 860 });
  await setup(page);
  await add(page, '正则提取字段');
  await expect(page.locator('.capture-fields')).toContainText('华星');
  await add(page, '日期识别与转换');
  await page.getByLabel('日期来源', { exact: true }).selectOption('field');
  await page.getByLabel('输出方式', { exact: true }).selectOption('field');
  await add(page, '模板重组');
  await page.getByLabel('命名模板', { exact: true }).fill('{日期}_{客户}_{编号}');
  await expect(page.getByRole('textbox', { name: '华星-20260105-HT003.pdf 的新名称' })).toHaveValue(
    '2026-01-05_华星_HT003.pdf',
  );
  await expect(page.getByTestId('changed-count')).toHaveText('1');
  await page.screenshot({ path: testInfo.outputPath('advanced-pipeline.png') });
  expect(await ipcCalls(page, 'execute')).toHaveLength(0);
  await page.getByRole('button', { name: '确认并执行', exact: true }).click();
  expect(await ipcCalls(page, 'execute')).toHaveLength(0);
  await page.getByRole('button', { name: '确认执行', exact: true }).click();
  await expect.poll(async () => (await ipcCalls(page, 'execute')).length).toBe(1);
  expect((await ipcCalls(page, 'execute'))[0].args.changes[0].name).toBe(
    '2026-01-05_华星_HT003.pdf',
  );
});
test('AI designs extraction and templates beyond the old catalog, validates all targets before adoption', async ({
  page,
}, testInfo) => {
  await setup(page);
  await ai(page, {
    rules: [expression('extract'), expression('template', { text: '{编号}_{客户}_{日期}' })],
    explanation: '从三段文件名提取并重排字段',
  });
  await generate(page);
  await expect(page.getByRole('region', { name: 'AI 方案试算' })).toContainText(
    'HT003_华星_20260105.pdf',
  );
  await expect(page.locator('.applied-rule')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('ai-expression-draft.png') });
  await page.getByRole('button', { name: '加入应用区并预览', exact: true }).click();
  await expect(page.locator('.applied-rule')).toHaveCount(2);
  await expect(page.getByRole('textbox', { name: '华星-20260105-HT003.pdf 的新名称' })).toHaveValue(
    'HT003_华星_20260105.pdf',
  );
  expect(await ipcCalls(page, 'execute')).toHaveLength(0);
});
test('AI semantic filename mappings require draft review and remain excluded from reusable presets', async ({
  page,
}) => {
  await setup(page);
  await add(page, '添加前缀');
  await page.getByLabel('前缀文字', { exact: true }).fill('归档_');
  await ai(page, {
    rules: [],
    suggestions: [
      { id: 'contract-1', name: '华星采购合同.pdf', reason: '仅整理原名中的客户及合同类别' },
    ],
    explanation: '仅根据文件名给出逐文件建议',
  });
  await generate(page);
  await expect(page.getByRole('textbox', { name: '华星-20260105-HT003.pdf 的新名称' })).toHaveValue(
    '归档_华星-20260105-HT003.pdf',
  );
  await page.getByRole('button', { name: '加入应用区并预览', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '华星-20260105-HT003.pdf 的新名称' })).toHaveValue(
    '归档_华星采购合同.pdf',
  );
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByLabel('方案名称').fill('不保存文件映射');
  await page.getByRole('dialog').getByRole('button', { name: '保存', exact: true }).click();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('uu-presets')!));
  expect(saved[0].steps).toHaveLength(1);
  expect(saved[0].steps[0].rule.kind).toBe('prefix');
  expect(saved[0].version).toBe(3);
  expect(await ipcCalls(page, 'execute')).toHaveLength(0);
});
test('missing fields block adoption until draft parameters are corrected, discard keeps existing rules', async ({
  page,
}) => {
  await setup(page);
  await ai(page, {
    rules: [expression('template', { text: '{不存在}' })],
    explanation: 'invalid missing field',
  });
  await generate(page);
  await expect(page.getByRole('region', { name: 'AI 方案试算' })).toContainText('缺少模板字段');
  await expect(page.getByRole('button', { name: '加入应用区并预览', exact: true })).toBeDisabled();
  await page
    .getByRole('dialog', { name: 'AI 规则草案' })
    .getByText('编辑规则参数', { exact: true })
    .click();
  await page
    .getByRole('dialog', { name: 'AI 规则草案' })
    .getByLabel('命名模板', { exact: true })
    .fill('{original}_归档');
  await expect(page.getByRole('button', { name: '加入应用区并预览', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '放弃草案', exact: true }).click();
  await expect(page.locator('.applied-rule')).toHaveCount(0);
  expect(await ipcCalls(page, 'execute')).toHaveLength(0);
});
test('examples constrain continuation, current rules are explicitly included, replacing requires confirmation', async ({
  page,
}) => {
  await setup(page);
  await add(page, '添加前缀');
  await page.getByLabel('前缀文字', { exact: true }).fill('旧_');
  await ai(page, {
    rules: [{ kind: 'prefix', params: { text: '新_' } }],
    explanation: '按要求调整原方案，请选择替换整组',
  });
  await page.getByText('目标示例与当前方案', { exact: true }).click();
  await page.getByRole('checkbox', { name: '参考当前已启用规则', exact: true }).check();
  await page.getByRole('button', { name: '添加目标示例', exact: true }).click();
  await page.getByLabel('示例1期望名称', { exact: true }).fill('新_华星-20260105-HT003.pdf');
  await page
    .getByLabel('命名要求', { exact: true })
    .fill('把当前方案的旧_前缀改为新_，保留其他要求');
  await page.getByRole('button', { name: '预览文件名并生成规则', exact: true }).click();
  const consent = page.getByRole('dialog', { name: '确认云端发送' });
  await expect(consent).toContainText('新_华星-20260105-HT003.pdf');
  expect((await ipcCalls(page, 'prepare_ai'))[0].args.options.current_rules).toEqual([
    { kind: 'prefix', params: { text: '旧_' } },
  ]);
  await page.getByRole('button', { name: '同意发送以上内容', exact: true }).click();
  await expect(page.getByRole('region', { name: 'AI 方案试算' })).toContainText(
    '目标示例 1：未满足',
  );
  await expect(page.getByRole('button', { name: '加入应用区并预览', exact: true })).toBeDisabled();
  await page.getByRole('radio', { name: '替换整组规则', exact: true }).check();
  await page.getByRole('checkbox', { name: '确认替换当前 1 条规则', exact: true }).check();
  await expect(page.getByRole('region', { name: 'AI 方案试算' })).toContainText('目标示例 1：通过');
  await page.getByRole('button', { name: '加入应用区并预览', exact: true }).click();
  await expect(page.locator('.applied-rule')).toHaveCount(1);
  expect(await ipcCalls(page, 'execute')).toHaveLength(0);
});
test('conditional rule editor exposes editable branch parameters and avoids repeated prefixes', async ({
  page,
}) => {
  await setup(page);
  await add(page, '条件与分支');
  await expect(page.getByRole('textbox', { name: '华星-20260105-HT003.pdf 的新名称' })).toHaveValue(
    '项目_华星-20260105-HT003.pdf',
  );
  await page.locator('.nested-rule summary').first().click();
  await page.getByLabel('名称文字', { exact: true }).fill('项目_归档_');
  await expect(page.getByRole('textbox', { name: '华星-20260105-HT003.pdf 的新名称' })).toHaveValue(
    '项目_归档_华星-20260105-HT003.pdf',
  );
  await page.getByRole('button', { name: '复制第1条规则', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '华星-20260105-HT003.pdf 的新名称' })).toHaveValue(
    '项目_归档_华星-20260105-HT003.pdf',
  );
});
test('natural ordering and compound extension policy are saved with a reusable scheme', async ({
  page,
}) => {
  const entries = ['10.tar.gz', '2.tar.gz', '1.tar.gz'].map((name, i) => ({
    ...files[0],
    id: String(i),
    name,
    path: '/fixture/' + name,
    extension: 'gz',
  }));
  await setup(page, entries);
  await add(page, '分组与步长编号');
  await page.getByText('方案选项 · 导入顺序 · 复合扩展名', { exact: true }).click();
  await page.getByLabel('编号与列表排序', { exact: true }).selectOption('natural');
  await expect(page.getByRole('textbox', { name: '1.tar.gz 的新名称' })).toHaveValue(
    '1_001.tar.gz',
  );
  await expect(page.getByRole('textbox', { name: '10.tar.gz 的新名称' })).toHaveValue(
    '10_003.tar.gz',
  );
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByLabel('方案名称').fill('自然编号');
  await page.getByRole('dialog').getByRole('button', { name: '保存', exact: true }).click();
  await page.reload();
  await page.getByLabel('加载命名方案').selectOption('自然编号');
  await page.locator('.scheme-options summary').click();
  await expect(page.getByLabel('编号与列表排序', { exact: true })).toHaveValue('natural');
});
test('invalid regex visibly blocks execution while parameters can still be corrected', async ({
  page,
}) => {
  await setup(page);
  await add(page, '高级查找替换');
  await page.getByLabel('正则模式', { exact: true }).check();
  await page.getByLabel('查找表达式', { exact: true }).fill('(?<=x)y');
  await expect(page.getByRole('alert')).toContainText('不支持环视');
  await expect(page.getByRole('button', { name: '确认并执行', exact: true })).toBeDisabled();
  await page.getByLabel('查找表达式', { exact: true }).fill('华星');
  await page.getByLabel('替换内容', { exact: true }).fill('天河');
  await expect(page.getByRole('textbox', { name: '华星-20260105-HT003.pdf 的新名称' })).toHaveValue(
    '天河-20260105-HT003.pdf',
  );
  await expect(page.getByRole('button', { name: '确认并执行', exact: true })).toBeEnabled();
});
test('duplicate draft targets block adoption and sequential manual typing remains stable', async ({
  page,
}) => {
  const second = {
    ...files[0],
    id: 'contract-2',
    name: '另一合同.pdf',
    path: '/fixture/另一合同.pdf',
  };
  await setup(page, [...files, second]);
  await ai(page, {
    rules: [expression('template', { text: '统一名称' })],
    explanation: '两个文件会重名',
  });
  await generate(page);
  await expect(page.getByRole('region', { name: 'AI 方案试算' })).toContainText('2 问题');
  await expect(page.getByRole('button', { name: '加入应用区并预览', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '放弃草案', exact: true }).click();
  const name = page.getByRole('textbox', { name: '华星-20260105-HT003.pdf 的新名称' });
  await name.fill('');
  await name.pressSequentially('手动名称.pdf', { delay: 20 });
  await expect(name).toHaveValue('手动名称.pdf');
  await expect(page.getByRole('button', { name: '确认并执行', exact: true })).toBeEnabled();
  expect(await ipcCalls(page, 'execute')).toHaveLength(0);
});
test('AI-requested sorting options are previewed before adoption and applied with the rules', async ({
  page,
}) => {
  const entries = ['10.pdf', '2.pdf'].map((name, i) => ({
    ...files[0],
    id: String(i),
    name,
    path: '/fixture/' + name,
  }));
  await setup(page, entries);
  await ai(page, {
    rules: [expression('sequence')],
    options: { sort: 'natural', descending: false, extensionMode: 'compound' },
    explanation: '按自然排序编号',
  });
  await generate(page);
  const preview = page.getByRole('region', { name: 'AI 方案试算' });
  await expect(preview).toContainText('2_001.pdf');
  await expect(preview).toContainText('10_002.pdf');
  await page.getByRole('button', { name: '加入应用区并预览', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '2.pdf 的新名称' })).toHaveValue('2_001.pdf');
  await page.locator('.scheme-options summary').click();
  await expect(page.getByLabel('编号与列表排序', { exact: true })).toHaveValue('natural');
  expect(await ipcCalls(page, 'execute')).toHaveLength(0);
});
