import { test, expect, type Page } from '@playwright/test';
import { installDesktopFixture, ipcCalls } from './native-fixture';
async function setup(page: Page, multiple = false) {
  await installDesktopFixture(page, multiple);
  await page.goto('/');
  await page.getByRole('button', { name: '添加文件', exact: true }).first().click();
  await page.getByRole('button', { name: '添加规则：添加前缀', exact: true }).click();
  await page.getByLabel('前缀文字', { exact: true }).fill('归档_');
}
async function execute(page: Page) {
  await page.getByRole('button', { name: '确认并执行', exact: true }).click();
  await page.getByRole('button', { name: '确认执行', exact: true }).click();
}
async function fail(page: Page, cmd: string, error: string) {
  await page.evaluate(
    ({ cmd, error }) => {
      (window as any).fixtureFailures[cmd] = error;
    },
    { cmd, error },
  );
}

test('rename reports success and undo feedback stays visible inside the open history dialog', async ({
  page,
}, testInfo) => {
  await setup(page);
  await execute(page);
  await expect(page.getByRole('status').filter({ hasText: '重命名成功：1 个文件' })).toBeVisible();
  await page.getByRole('button', { name: '历史 / 恢复', exact: true }).click();
  await page.getByRole('button', { name: '恢复 / 撤销', exact: true }).click();
  await page.evaluate(() => {
    (window as any).fixtureHold = 'undo';
  });
  await page.getByRole('button', { name: '确认恢复', exact: true }).click();
  const history = page.getByRole('dialog', { name: '操作记录与恢复' });
  await expect(history.getByRole('status')).toHaveText('撤销并恢复文件…');
  await expect(history).not.toContainText('撤销成功');
  await page.evaluate(() => {
    (window as any).fixtureRelease();
  });
  await expect(history.getByRole('status')).toContainText('撤销成功：已恢复 1 项');
  await expect(history.getByRole('button', { name: '恢复 / 撤销', exact: true })).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath('undo-success-feedback.png') });
  await history.getByRole('button', { name: '关闭提示', exact: true }).click();
  await expect(history.locator('.feedback-toast')).toHaveCount(0);
});

for (const [op, label] of [
  ['copy', '复制'],
  ['move', '移动'],
]) {
  test(`${label} reports the operation and completed count`, async ({ page }) => {
    await setup(page);
    await page
      .getByRole('group', { name: '文件操作' })
      .getByRole('button', { name: label, exact: true })
      .click();
    await page.getByRole('button', { name: '选择目标目录', exact: true }).click();
    await execute(page);
    await expect(
      page.getByRole('status').filter({ hasText: `${label}成功：1 个文件` }),
    ).toBeVisible();
    expect((await ipcCalls(page, 'execute'))[0].args.operation).toBe(op);
  });
}

test('partial completion stays an error until dismissed, without claiming full success', async ({
  page,
}) => {
  await page.clock.install();
  await setup(page, true);
  await page.evaluate(() => {
    (window as any).fixtureExecutionResult = { completed: 1, error: '目标目录不可写' };
  });
  await execute(page);
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('重命名部分完成：已完成 1 项');
  await expect(alert).toContainText('目标目录不可写');
  await expect(alert).not.toContainText('重命名成功');
  await page.clock.fastForward(12000);
  await expect(alert).toBeVisible();
  await page.getByRole('button', { name: '关闭提示', exact: true }).click();
  await expect(alert).toHaveCount(0);
});

test('failed undo is visible in the dialog and leaves records available for recovery', async ({
  page,
}) => {
  await setup(page);
  await execute(page);
  await page.getByRole('button', { name: '历史 / 恢复', exact: true }).click();
  await fail(page, 'undo', '原文件已被外部修改');
  await page.getByRole('button', { name: '恢复 / 撤销', exact: true }).click();
  await page.getByRole('button', { name: '确认恢复', exact: true }).click();
  const history = page.getByRole('dialog', { name: '操作记录与恢复' });
  await expect(history.getByRole('alert')).toContainText('撤销并恢复文件失败');
  await expect(history.getByRole('alert')).toContainText('原文件已被外部修改');
  await expect(history.getByRole('button', { name: '恢复 / 撤销', exact: true })).toBeEnabled();
  await expect(history).not.toContainText('撤销成功');
});

test('a refresh failure after successful rename reports both facts and retains no stale file list', async ({
  page,
}) => {
  await setup(page);
  await fail(page, 'list_files', '列表读取失败');
  await execute(page);
  await expect(page.locator('.feedback-toast.warning')).toContainText('重命名成功：1 个文件');
  await expect(page.getByRole('alert')).toContainText('文件列表刷新失败');
  await expect(page.getByRole('alert')).not.toContainText('重命名失败');
  await expect(page.locator('tbody tr')).toHaveCount(0);
});

test('a history refresh failure does not hide successful undo or restore stale complete states', async ({
  page,
}) => {
  await setup(page);
  await execute(page);
  await page.getByRole('button', { name: '历史 / 恢复', exact: true }).click();
  await fail(page, 'history', '记录暂不可读');
  await page.getByRole('button', { name: '恢复 / 撤销', exact: true }).click();
  await page.getByRole('button', { name: '确认恢复', exact: true }).click();
  const history = page.getByRole('dialog', { name: '操作记录与恢复' });
  await expect(history.getByRole('alert')).toContainText('撤销成功：已恢复 1 项');
  await expect(history.getByRole('alert')).toContainText('操作记录刷新失败');
  await expect(history.getByRole('button', { name: '恢复 / 撤销', exact: true })).toBeDisabled();
});

test('success feedback pauses on hover then dismisses, and removal explicitly preserves disk files', async ({
  page,
}) => {
  await page.clock.install();
  await setup(page);
  await execute(page);
  const toast = page.locator('.feedback-toast.success');
  await expect(toast).toContainText('重命名成功');
  await toast.hover();
  await page.clock.fastForward(12000);
  await expect(toast).toBeVisible();
  await page.mouse.move(0, 0);
  await page.clock.fastForward(6000);
  await expect(toast).toHaveCount(0);
  // Use a fresh workspace for the list-only action after verifying dismissal.
  await page.reload();
  await page.getByRole('button', { name: '添加文件', exact: true }).first().click();
  await page.getByRole('button', { name: '移除所选文件', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '原文件未删除' })).toBeVisible();
  expect(await ipcCalls(page, 'execute')).toHaveLength(0);
});

test('failed permission updates keep the failure visible rather than overwriting it with success', async ({
  page,
}) => {
  await setup(page);
  await fail(page, 'set_policy', '权限保存失败');
  await page.getByRole('combobox', { name: '所选文件隐私策略' }).selectOption('cloud');
  await expect(page.getByRole('alert')).toContainText('权限保存失败');
  await expect(page.locator('.feedback-toast.success')).toHaveCount(0);
});
