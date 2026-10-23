import { expect, galata, test } from '@jupyterlab/galata';
import { FixturePersona, installPersonas, TestHelpers } from './test-helpers';

const TEST_DIR = 'model-dependency';
const PERSONAS = [FixturePersona.DependentModels, FixturePersona.Hello];

test.describe('pending model domains', () => {
  test.beforeAll(async ({ request }) => {
    await installPersonas(request, TEST_DIR, PERSONAS);
  });

  test('projects before send, invalidates metadata, preserves selections across persona switches, and applies in order', async ({
    page
  }) => {
    const controls = new TestHelpers({ dir: TEST_DIR, page });
    await controls.openChat();
    await controls.selectPersona(FixturePersona.DependentModels);
    await controls.waitForControls();
    await controls.setControl('Model', 'A2');
    await controls.setControl('Detail', 'high');
    await controls.setControl('Format', 'rich');
    await controls.setControl('Backend', 'B');
    expect(await controls.controlOptions('Model')).toEqual([
      'Default (B1)',
      'B1',
      'B2',
      'shared'
    ]);
    await expect(controls.control('Model')).toContainText('B1');
    expect(await controls.controlCount('Detail')).toBe(0);
    await controls.setControl('Model', 'B2');
    await controls.selectPersona(FixturePersona.Hello);
    await controls.selectPersona(FixturePersona.DependentModels);
    await expect(controls.control('Backend')).toContainText('B');
    await expect(controls.control('Model')).toContainText('B2');
    const reply = JSON.parse(await controls.sendMessage('apply configuration'));
    expect(reply.applied).toEqual(['backend:B', 'model:B2', 'format:rich']);
    expect(reply.backend).toBe('B');
    expect(reply.model).toBe('B2');
    expect(reply.metadata.model).toEqual({ id: 'B2', settings: {} });
    expect(reply.metadata.settings).toEqual({ backend: 'B', format: 'rich' });
    await expect(controls.control('Detail')).toBeVisible();
  });

  test('two clients retain private domains and refresh catches up to applied state', async ({
    baseURL,
    browser,
    page,
    tmpPath,
    waitForApplication
  }) => {
    const shared = `${TEST_DIR}/shared.chat`;
    await page.filebrowser.contents.uploadContent('{}', 'text', shared);
    const first = new TestHelpers({ dir: TEST_DIR, page });
    await first.openChat(shared);
    await first.selectPersona(FixturePersona.DependentModels);
    await first.waitForControls();
    const { page: guest } = await galata.newPage({
      baseURL: baseURL!,
      browser,
      tmpPath,
      waitForApplication,
      mockUser: {
        identity: {
          username: 'guest',
          name: 'guest',
          display_name: 'guest',
          initials: 'G',
          color: '#008080'
        }
      }
    });
    try {
      await guest.evaluate(() => {
        window.galata.on('dialog', dialog => {
          dialog?.resolve();
        });
      });
      const second = new TestHelpers({ dir: TEST_DIR, page: guest });
      await second.openChat(shared);
      await second.selectPersona(FixturePersona.DependentModels);
      await second.waitForControls();
      await second.setControl('Model', 'A2');
      await second.setControl('Detail', 'high');
      await first.setControl('Backend', 'B');
      await first.setControl('Model', 'B2');
      await expect(second.control('Backend')).toContainText('A');
      expect(await second.controlOptions('Model')).toEqual([
        'Default (A1)',
        'A1',
        'A2',
        'shared'
      ]);
      // Sending from the other client proves that merely clicking selectors
      // did not change the session's backend or model.
      const replyA = JSON.parse(
        await second.sendMessage('observe active state')
      );
      expect(replyA.backend).toBe('A');
      expect(replyA.model).toBe('A2');
      await expect(first.control('Model')).toContainText('B2');
      const replyB = JSON.parse(await first.sendMessage('apply pending state'));
      expect(replyB.applied).toEqual(['backend:B', 'model:B2']);
      await expect(second.control('Backend')).toContainText('B');
      await expect(second.control('Model')).toContainText('B2');
      const reconciled = JSON.parse(
        await second.sendMessage('use current state')
      );
      expect(reconciled.metadata.model).toEqual({ id: null, settings: {} });
      expect(reconciled.model).toBe('B2');
      await guest.reload();
      await guest.waitForLoadState('domcontentloaded');
      await expect(second.personaPicker).toBeVisible({ timeout: 30000 });
      await second.selectPersona(FixturePersona.DependentModels);
      await second.waitForControls();
      expect(await second.controlOptions('Model')).toEqual([
        'Default (B2)',
        'B1',
        'B2',
        'shared'
      ]);
    } finally {
      await guest.close();
      await page.filebrowser.contents.deleteFile(shared);
    }
  });
});
