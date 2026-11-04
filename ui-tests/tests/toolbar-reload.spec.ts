import { expect, galata, test } from '@jupyterlab/galata';
import { FixturePersona, installPersonas, TestHelpers } from './test-helpers';

const TEST_DIR = 'toolbar-reload';
const CHAT = `${TEST_DIR}/reload.chat`;

test.beforeAll(async ({ request }) => {
  // A sole persona is selected automatically, so reload assertions require
  // neither a picker click nor a message to trigger preparation.
  await installPersonas(request, TEST_DIR, [FixturePersona.PrepareConfig]);
  const contents = galata.newContentsHelper(request);
  expect(await contents.uploadContent('{}', 'text', CHAT)).toBe(true);
});

test('fresh open and repeated reload restore prepared controls before send', async ({
  page
}) => {
  const helpers = new TestHelpers({ dir: TEST_DIR, page });
  await helpers.openChat(CHAT);
  for (let cycle = 0; cycle < 3; cycle++) {
    await expect(helpers.personaPicker).toContainText('Prepare Config Persona');
    await expect(helpers.control('Model')).toContainText('Prepared One', {
      timeout: 30000
    });
    await expect(helpers.control('Thinking')).toContainText('Medium');
    if (cycle < 2) {
      // Galata's default readiness check waits for a launcher, but a restored
      // workspace has this chat active. Still wait for plugins and Galata.
      await page.reload({ waitForIsReady: false });
      await helpers.openChat(CHAT);
    }
  }
});
