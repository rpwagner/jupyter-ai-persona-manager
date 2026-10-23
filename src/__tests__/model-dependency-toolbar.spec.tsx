import React from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Signal } from '@lumino/signaling';
import { PersonaControls } from '../persona-controls';
import { PersonaSessionRegistry } from '../persona-events';
import { configuration } from './model-dependency-fixture';

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  jest
    .spyOn(HTMLElement.prototype, 'clientWidth', 'get')
    .mockReturnValue(10000);
});

afterAll(() => jest.restoreAllMocks());

function setup() {
  const registry = new PersonaSessionRegistry({
    stream: { connect: jest.fn() }
  } as any);
  const manager = registry.get('chat');
  manager.updateBackendPersonas([
    { id: 'configurable', name: 'Configurable', avatar_url: null },
    { id: 'other', name: 'Other', avatar_url: null }
  ]);
  manager.updatePersonaState('configurable', configuration());
  const input = { updateMetadata: jest.fn() };
  const chat = {
    id: 'chat',
    ready: Promise.resolve('chat'),
    disposed: new Signal<object, void>({})
  };
  const events = { emit: jest.fn().mockResolvedValue(undefined) };
  const view = render(
    <PersonaControls
      {...({
        model: input,
        chatModel: chat,
        events,
        sessionRegistry: registry
      } as any)}
    />
  );
  const user = userEvent.setup();
  const button = (title: string): HTMLElement =>
    view.container.querySelector(
      `.jp-jai-personaControls-controls > button[title="${title}"]`
    )!;
  const select = async (title: string, value: string) => {
    await user.click(button(title));
    fireEvent.click(screen.getByRole('menuitem', { name: value }));
  };
  const persona = async (name: string) => {
    await user.click(
      view.container.querySelector('.jp-jai-personaControls-persona-btn')!
    );
    fireEvent.click(screen.getByRole('menuitem', { name }));
  };
  const metadata = () =>
    input.updateMetadata.mock.calls[
      input.updateMetadata.mock.calls.length - 1
    ][0];
  return {
    registry,
    manager,
    input,
    events,
    view,
    select,
    persona,
    button,
    metadata
  };
}

it('projects immediately and atomically writes reconciled metadata without a setting event', async () => {
  const fixture = setup();
  await fixture.persona('Configurable');
  await fixture.select('Model', 'A2');
  await fixture.select('detail', 'high');
  await fixture.select('format', 'rich');
  const eventCount = fixture.events.emit.mock.calls.length;
  await fixture.select('backend', 'B');
  expect(fixture.button('Model').textContent).toContain('B1');
  expect(fixture.button('detail')).toBeNull();
  expect(fixture.metadata()).toEqual({
    to_persona: 'configurable',
    model: { id: null, settings: {} },
    settings: { backend: 'B', format: 'rich' }
  });
  expect(fixture.events.emit).toHaveBeenCalledTimes(eventCount);
  expect(fixture.manager.getPersona('configurable')!.settings[0].current).toBe(
    'A'
  );
  await fixture.select('Model', 'B2');
  await fixture.persona('Other');
  await fixture.persona('Configurable');
  expect(fixture.button('Model').textContent).toContain('B2');
});

it('reconciles an inactive cache before restamping on return and retains unrelated settings', async () => {
  const fixture = setup();
  await fixture.persona('Configurable');
  await fixture.select('Model', 'A2');
  await fixture.select('detail', 'high');
  await fixture.select('format', 'rich');
  await fixture.persona('Other');
  act(() =>
    fixture.manager.updatePersonaState('configurable', configuration('B', 'B2'))
  );
  const start = fixture.input.updateMetadata.mock.calls.length;
  await fixture.persona('Configurable');
  await waitFor(() =>
    expect(fixture.button('Model').textContent).toContain('B2')
  );
  for (const [metadata] of fixture.input.updateMetadata.mock.calls.slice(
    start
  )) {
    expect(metadata.model).toEqual({ id: null, settings: {} });
    expect(metadata.settings).toEqual({ format: 'rich' });
  }
});

it('two toolbar instances keep pending selections private and reconcile published changes', async () => {
  const first = setup();
  await first.persona('Configurable');
  const input = { updateMetadata: jest.fn() };
  const secondView = render(
    <PersonaControls
      {...({
        model: input,
        chatModel: {
          id: 'chat',
          ready: Promise.resolve('chat'),
          disposed: new Signal<object, void>({})
        },
        sessionRegistry: first.registry
      } as any)}
    />
  );
  const user = userEvent.setup();
  await user.click(
    secondView.container.querySelector('.jp-jai-personaControls-persona-btn')!
  );
  fireEvent.click(screen.getByRole('menuitem', { name: 'Configurable' }));
  await first.select('backend', 'B');
  await first.select('Model', 'B2');
  expect(
    input.updateMetadata.mock.calls[
      input.updateMetadata.mock.calls.length - 1
    ][0].model
  ).toEqual({
    id: null,
    settings: {}
  });
  expect(
    secondView.container.querySelector('button[title="backend"]')!.textContent
  ).toContain('A');
  act(() =>
    first.manager.updatePersonaState('configurable', configuration('B', 'B2'))
  );
  await waitFor(() =>
    expect(
      secondView.container.querySelector('button[title="backend"]')!.textContent
    ).toContain('B')
  );
  expect(first.metadata().model.id).toBe('B2');
  expect(
    input.updateMetadata.mock.calls[
      input.updateMetadata.mock.calls.length - 1
    ][0].model.id
  ).toBeNull();
});
