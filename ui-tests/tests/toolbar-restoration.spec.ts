import { expect, galata, test } from '@jupyterlab/galata';
import * as fs from 'fs';
import * as path from 'path';
import { FixturePersona, installPersonas, TestHelpers } from './test-helpers';

const TEST_DIR = 'toolbar-restoration';
const PERSONAS = [FixturePersona.PrepareConfig, FixturePersona.Refresher];

test.beforeAll(async ({ request }) => {
  await installPersonas(request, TEST_DIR, PERSONAS);
});

test('refresh prepares the same selected persona and replaces its controls', async ({
  page,
  request
}) => {
  const helpers = new TestHelpers({ dir: TEST_DIR, page });
  const contents = galata.newContentsHelper(request);
  const source = fs.readFileSync(
    path.resolve(__dirname, '../fixtures/personas/prepare-config_persona.py'),
    'utf-8'
  );
  await helpers.openChat();

  for (const [index, model] of ['two', 'one'].entries()) {
    // The existing refresher fixture invokes the public refresh API when its
    // signal file appears. All messages go to deterministic local fixtures.
    await helpers.selectPersona(FixturePersona.Refresher);
    await helpers.sendMessage('arm');
    await helpers.selectPersona(FixturePersona.PrepareConfig);
    await helpers.waitForControls();

    // Change what the replacement reports so stale controls cannot satisfy
    // the assertion. Vary source length to invalidate Python's bytecode cache.
    const updated =
      source.replace(
        '_MODEL_CURRENT = "prepared-one"',
        `_MODEL_CURRENT = "prepared-${model}"`
      ) + `\n# Fixture revision ${'x'.repeat(index + 1)}\n`;
    // Galata's uploadContent only accepts 201 (new file), but replacing the
    // installed fixture correctly returns 200 from the Contents API.
    const fixtureUrl = `/api/contents/${TEST_DIR}/.jupyter/personas/prepare-config_persona.py`;
    const saved = await request.put(fixtureUrl, {
      data: { content: updated, format: 'text', type: 'file' }
    });
    expect(saved.status()).toBe(200);
    const readback = await request.get(fixtureUrl);
    expect(readback.status()).toBe(200);
    expect((await readback.json()).content).toBe(updated);
    expect(
      await contents.uploadContent('go', 'text', `${TEST_DIR}/go-refresh`)
    ).toBe(true);

    // Keep the same selection through the real server refresh. No reselection
    // or message to the replacement is allowed to cause its preparation.
    await expect(helpers.control('Model')).toContainText(
      model === 'two' ? 'Prepared Two' : 'Prepared One',
      { timeout: 30000 }
    );
    await expect(helpers.control('Thinking')).toContainText('Medium');
    await contents.deleteFile(`${TEST_DIR}/go-refresh`);
  }
});
