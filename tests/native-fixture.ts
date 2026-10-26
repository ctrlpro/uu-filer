import type { Page } from '@playwright/test';
import { evaluateNative } from './engine-adapter';
export async function installDesktopFixture(
  page: Page,
  multiple = false,
  custom: Record<string, unknown>[] | null = null,
) {
  await page.exposeFunction('__evaluatePipeline', evaluateNative);
  await page.addInitScript(
    ({ multiple, custom }) => {
      const host = window as unknown as Record<string, any>;
      const initial = (custom ?? [
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
      ]) as {
        id: string;
        path: string;
        name: string;
        extension: string;
        size: number;
        modified: number;
        policy: string;
      }[];
      let files = structuredClone(initial),
        history: any[] = [];
      host.fixtureCalls = [];
      host.fixtureFailures = {};
      host.fixtureExecutionResult = null;
      host.fixtureHold = '';
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
          if (host.fixtureHold === cmd)
            await new Promise<void>((resolve) => {
              host.fixtureRelease = resolve;
            });
          if (host.fixtureFailures[cmd]) throw new Error(host.fixtureFailures[cmd]);
          if (cmd.startsWith('plugin:event|')) return 1;
          if (cmd === 'get_settings')
            return { endpoint: 'https://fixture.invalid/v1', model: 'fixture-model' };
          if (cmd === 'plugin:dialog|open')
            return args.options?.directory ? '/fixture/destination' : initial.map((f) => f.path);
          if (cmd === 'add_files' || cmd === 'list_files') return structuredClone(files);
          if (cmd === 'remove_files') {
            files = files.filter((f) => !args.ids.includes(f.id));
            return null;
          }
          if (cmd === 'evaluate_pipeline')
            return host.__evaluatePipeline({
              files: args.ids.map((id: string) => files.find((f) => f.id === id)),
              steps: args.steps,
              options: args.options,
              edits: args.edits,
              examples: args.examples,
            });
          if (cmd === 'set_policy') {
            files = files.map((f) => (args.ids.includes(f.id) ? { ...f, policy: args.policy } : f));
            return structuredClone(files);
          }
          if (cmd === 'preview')
            return args.changes.map((c: { id: string; name: string }) => {
              const file = files.find((f) => f.id === c.id)!;
              const parent = file.path.slice(0, file.path.lastIndexOf('/'));
              const target =
                (args.operation === 'rename' ? parent : args.destination) + '/' + c.name;
              const count = args.changes.filter((other: { id: string; name: string }) => {
                const f = files.find((f) => f.id === other.id)!;
                return (
                  (
                    (args.operation === 'rename'
                      ? f.path.slice(0, f.path.lastIndexOf('/'))
                      : args.destination) +
                    '/' +
                    other.name
                  ).toLowerCase() === target.toLowerCase()
                );
              }).length;
              return {
                id: c.id,
                name: c.name,
                source: file.path,
                target,
                error: count > 1 ? '目标名称重复' : null,
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
              reference_ids: accepted.map((f) => f.id),
              total_allowed: accepted.length,
              omitted: 0,
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
                        text: JSON.stringify({
                          instruction: args.options.instruction,
                          current_rules: args.options.current_rules,
                          examples: args.options.examples,
                        }),
                      },
                      {
                        type: 'text',
                        text: JSON.stringify(
                          accepted.map((f) =>
                            args.options.task === 'rules'
                              ? { id: f.id, name: f.name }
                              : {
                                  id: f.id,
                                  name: f.name,
                                  content: args.options.content
                                    ? 'FILE_CONTENT_FIXTURE_FOR_CONSENT'
                                    : null,
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
            const result = host.fixtureExecutionResult ?? {
              completed: args.changes.length,
              error: null,
            };
            history = args.changes.map((c: any, i: number) => ({
              id: 'h' + i,
              batch: 'batch-1',
              source: files.find((f) => f.id === c.id)!.path,
              target: (args.destination || '/fixture') + '/' + c.name,
              operation: args.operation,
              state: i < result.completed ? 'complete' : 'planned',
              created: 1792886400,
            }));
            if (args.operation !== 'copy' && !result.error) files = [];
            return { batch: 'batch-1', ...result };
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
    { multiple, custom },
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
