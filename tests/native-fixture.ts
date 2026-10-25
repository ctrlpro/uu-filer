import type { Page } from '@playwright/test';
export async function installDesktopFixture(page: Page, multiple = false) {
  await page.addInitScript(
    ({ multiple }) => {
      const host = window as unknown as Record<string, any>;
      const initial = [
        {
          id: 'fixture-1',
          path: '/fixture/report 01.txt',
          name: 'report 01.txt',
          extension: 'txt',
          size: 40,
          modified: 1,
          policy: 'local',
        },
        ...(multiple
          ? [
              {
                id: 'fixture-2',
                path: '/fixture/photo copy.JPG',
                name: 'photo copy.JPG',
                extension: 'jpg',
                size: 50,
                modified: 1,
                policy: 'cloud',
              },
              {
                id: 'fixture-3',
                path: '/fixture/PRIVATE_MARKER.txt',
                name: 'PRIVATE_MARKER.txt',
                extension: 'txt',
                size: 60,
                modified: 1,
                policy: 'deny',
              },
            ]
          : []),
      ];
      let files = structuredClone(initial),
        history: any[] = [];
      host.fixtureCalls = [];
      host.fixtureRules = {
        rules: [
          { kind: 'prefix', params: { text: '项目 A_' } },
          { kind: 'spaces', params: { separator: '_' } },
        ],
        explanation: '根据允许参考的文件名，先添加前缀，再替换空格。',
      };
      host.isTauri = true;
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
            return args.options?.directory ? '/fixture/destination' : initial.map((f) => f.path);
          if (cmd === 'add_files' || cmd === 'list_files') return structuredClone(files);
          if (cmd === 'set_policy') {
            files = files.map((f) => (args.ids.includes(f.id) ? { ...f, policy: args.policy } : f));
            return structuredClone(files);
          }
          if (cmd === 'preview')
            return args.changes.map((c: { id: string; name: string }) => {
              const file = files.find((f) => f.id === c.id)!;
              const target =
                (args.operation === 'rename' ? '/fixture' : args.destination) + '/' + c.name;
              return {
                id: c.id,
                name: c.name,
                source: file.path,
                target,
                error: null,
                changed: target !== file.path,
              };
            });
          if (cmd === 'prepare_ai') {
            const accepted = files.filter(
              (f) =>
                args.ids.includes(f.id) &&
                (args.options.route === 'cloud' ? f.policy === 'cloud' : f.policy !== 'deny'),
            );
            return {
              task: args.options.task,
              token: 'fixture-grant',
              route: args.options.route,
              endpoint: 'https://fixture.invalid/v1/chat/completions',
              model: 'fixture-model',
              count: accepted.length,
              skipped: files
                .filter((f) => args.ids.includes(f.id) && !accepted.includes(f))
                .map((f) => ({ name: f.name, reason: '隐私策略禁止本次处理' })),
              payload: {
                messages: [
                  {
                    role: 'system',
                    content: 'Only whitelisted rules or safe names; never execute files.',
                  },
                  {
                    role: 'user',
                    content: [
                      {
                        type: 'text',
                        text: JSON.stringify(
                          accepted.map((f) =>
                            args.options.task === 'rules'
                              ? { id: f.id, name: f.name }
                              : {
                                  id: f.id,
                                  name: f.name,
                                  content: 'FILE_CONTENT_FIXTURE_FOR_CONSENT',
                                },
                          ),
                        ),
                      },
                    ],
                  },
                ],
              },
            };
          }
          if (cmd === 'generate_ai')
            return [{ id: 'fixture-1', name: '整理 report.txt', reason: '来自测试标题' }];
          if (cmd === 'generate_rules') return host.fixtureRules;
          if (cmd === 'discard_ai') return null;
          if (cmd === 'execute') {
            history = args.changes.map((c: any, i: number) => ({
              id: 'h' + i,
              batch: 'batch-1',
              source: files.find((f) => f.id === c.id)!.path,
              target: (args.destination || '/fixture') + '/' + c.name,
              operation: args.operation,
              state: 'complete',
              created: 1792886400,
            }));
            if (args.operation !== 'copy') files = [];
            return { batch: 'batch-1', completed: args.changes.length, error: null };
          }
          if (cmd === 'history') return structuredClone(history);
          if (cmd === 'undo') {
            history = history.map((h) => ({ ...h, state: 'undone' }));
            files = structuredClone(initial);
            return history.length;
          }
          throw new Error('Unexpected IPC command ' + cmd);
        },
      };
    },
    { multiple },
  );
}
export function ipcCalls(page: Page, cmd: string) {
  return page.evaluate(
    (command) =>
      (window as unknown as { fixtureCalls: { cmd: string; args: any }[] }).fixtureCalls.filter(
        (c) => c.cmd === command,
      ),
    cmd,
  );
}
