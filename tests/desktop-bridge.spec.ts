import { test, expect } from '@playwright/test';

test('desktop UI preserves cloud consent, AI suggestions, execution confirmation and undo', async ({
  page,
}) => {
  // Mock IPC only. Filesystem safety is exercised separately by the real Rust tests.
  await page.addInitScript(() => {
    const host = window as unknown as Record<string, any>;
    host.fixtureCalls = [];
    host.isTauri = true;
    let files = [
      {
        id: 'fixture-1',
        path: '/fixture/report.txt',
        name: 'report.txt',
        extension: 'txt',
        size: 40,
        modified: 1,
        policy: 'local',
      },
    ];
    host.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
    host.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
      transformCallback: () => 1,
      unregisterCallback: () => {},
      invoke: async (cmd: string, args: Record<string, any> = {}) => {
        host.fixtureCalls.push({ cmd, args });
        if (cmd.startsWith('plugin:event|')) return 1;
        if (cmd === 'get_settings')
          return { endpoint: 'https://fixture.invalid/v1', model: 'fixture-model' };
        if (cmd === 'plugin:dialog|open')
          return args.options?.directory ? '/fixture/destination' : ['/fixture/report.txt'];
        if (cmd === 'add_files' || cmd === 'list_files') return files;
        if (cmd === 'set_policy') {
          files = files.map((f) => ({ ...f, policy: args.policy }));
          return files;
        }
        if (cmd === 'preview')
          return args.changes.map((c: { id: string; name: string }) => ({
            id: c.id,
            name: c.name,
            source: files[0].path,
            target: '/fixture/' + c.name,
            error: null,
            changed: c.name !== files[0].name,
          }));
        if (cmd === 'prepare_ai')
          return {
            token: 'fixture-grant',
            route: args.options.route,
            endpoint: 'https://fixture.invalid/v1/chat/completions',
            model: 'fixture-model',
            count: 1,
            skipped: [],
            payload: {
              messages: [
                { role: 'system', content: 'Keep extensions; return names only.' },
                {
                  role: 'user',
                  content: [{ type: 'text', text: 'FILE_CONTENT_FIXTURE_FOR_CONSENT' }],
                },
              ],
            },
          };
        if (cmd === 'generate_ai')
          return [{ id: 'fixture-1', name: '整理_report.txt', reason: '来自测试标题' }];
        if (cmd === 'discard_ai') return null;
        if (cmd === 'execute') {
          files = [];
          return { batch: 'batch-1', completed: 1, error: null };
        }
        if (cmd === 'history')
          return [
            {
              id: 'h1',
              batch: 'batch-1',
              source: '/fixture/report.txt',
              target: '/fixture/整理_report.txt',
              operation: 'rename',
              state: 'complete',
              created: 1792886400,
            },
          ];
        if (cmd === 'undo') return 1;
        throw new Error('Unexpected IPC command ' + cmd);
      },
    };
  });
  const calls = (cmd: string) =>
    page.evaluate(
      (command) =>
        (
          window as unknown as { fixtureCalls: { cmd: string; args: unknown }[] }
        ).fixtureCalls.filter((c) => c.cmd === command),
      cmd,
    );
  await page.goto('/');
  await page.getByRole('button', { name: '添加文件', exact: true }).first().click();
  await expect(page.getByRole('textbox', { name: 'report.txt 的新名称' })).toBeVisible();
  await page.getByRole('combobox', { name: '所选文件隐私策略' }).selectOption('cloud');
  await page.getByRole('tab', { name: 'AI 命名', exact: true }).click();
  await page.getByRole('combobox', { name: '处理方式', exact: true }).selectOption('cloud');
  await page.getByRole('button', { name: '查看内容并生成', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '确认云端发送' })).toBeVisible();
  await expect(page.getByText('FILE_CONTENT_FIXTURE_FOR_CONSENT', { exact: true })).toBeVisible();
  expect(await calls('generate_ai')).toHaveLength(0);
  await page.getByRole('button', { name: '取消并清除内容', exact: true }).click();
  await expect.poll(async () => (await calls('discard_ai')).length).toBe(1);
  expect(await calls('generate_ai')).toHaveLength(0);
  await page.getByRole('button', { name: '查看内容并生成', exact: true }).click();
  await page.getByRole('button', { name: '同意发送以上内容', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'report.txt 的新名称' })).toHaveValue(
    '整理_report.txt',
  );
  expect((await calls('generate_ai'))[0].args).toEqual({
    token: 'fixture-grant',
    cloudConsent: true,
  });
  await page.getByRole('tab', { name: '规则', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'report.txt 的新名称' })).toHaveValue(
    '整理_report.txt',
  );
  await expect(page.getByRole('button', { name: '确认并执行', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '确认并执行', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '确认文件操作' })).toBeVisible();
  expect(await calls('execute')).toHaveLength(0);
  await page.getByRole('button', { name: '确认执行', exact: true }).click();
  await expect.poll(async () => (await calls('execute')).length).toBe(1);
  expect((await calls('execute'))[0].args).toEqual({
    changes: [{ id: 'fixture-1', name: '整理_report.txt' }],
    operation: 'rename',
    destination: null,
  });
  await page.getByRole('button', { name: '历史 / 恢复', exact: true }).click();
  await page.getByRole('button', { name: '恢复 / 撤销', exact: true }).click();
  expect(await calls('undo')).toHaveLength(0);
  await page.getByRole('button', { name: '确认恢复', exact: true }).click();
  await expect.poll(async () => (await calls('undo')).length).toBe(1);
});
