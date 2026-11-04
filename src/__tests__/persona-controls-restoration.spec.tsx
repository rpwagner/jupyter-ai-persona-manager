import React from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor
} from '@testing-library/react';
import { Event } from '@jupyterlab/services';
import { Signal } from '@lumino/signaling';

import { PersonaControls } from '../persona-controls';
import {
  PERSONAS_EVENT_SCHEMA_ID,
  PERSONA_SELECTED_EVENT_SCHEMA_ID,
  PERSONA_STATE_EVENT_SCHEMA_ID,
  PersonaSessionRegistry
} from '../persona-events';

function toolbar() {
  const sender = {};
  const stream = new Signal<typeof sender, Event.Emission>(sender);
  const events = { stream, emit: jest.fn().mockResolvedValue(undefined) };
  const registry = new PersonaSessionRegistry(
    events as unknown as Event.IManager
  );
  const props = {
    chatModel: {
      id: 'chat-1',
      ready: Promise.resolve('chat-1'),
      disposed: new Signal<typeof sender, void>(sender)
    },
    model: { updateMetadata: jest.fn() },
    events,
    sessionRegistry: registry
  } as unknown as React.ComponentProps<typeof PersonaControls>;
  const publish = (schema: string, data: object) => {
    act(() => stream.emit({ schema_id: schema, chat_id: 'chat-1', ...data }));
  };
  const list = () =>
    publish(PERSONAS_EVENT_SCHEMA_ID, {
      personas: [{ id: 'p1', name: 'One', avatar_url: null, yjs_client_id: 0 }]
    });
  const state = () =>
    publish(PERSONA_STATE_EVENT_SCHEMA_ID, {
      persona_id: 'p1',
      model: {
        current: 'm1',
        options: [{ id: 'm1', name: 'Model One', description: null }],
        settings: []
      },
      settings: [
        {
          id: 'provider',
          name: 'Provider',
          current: 'local',
          description: null,
          options: [{ id: 'local', name: 'Local', description: null }]
        }
      ]
    });
  return { props, events, registry, list, state, publish };
}

describe('persona toolbar restoration', () => {
  // JSDOM has no layout; make both controls fit in the visible row.
  beforeEach(() => {
    jest
      .spyOn(HTMLElement.prototype, 'clientWidth', 'get')
      .mockReturnValue(1000);
  });

  afterEach(() => jest.restoreAllMocks());

  it('requests preparation again when the selected ID survives a list refresh', async () => {
    const t = toolbar();
    render(<PersonaControls {...t.props} />);
    t.list();
    await waitFor(() => expect(t.events.emit).toHaveBeenCalledTimes(1));
    t.events.emit.mockClear();

    // No state has arrived: this is the name-only recovery path. The fresh
    // list represents a replacement persona with the same stable ID.
    expect(screen.getByText('One')).toBeTruthy();
    expect(screen.queryAllByTitle('Model')).toHaveLength(0);
    for (let i = 1; i <= 3; i++) {
      t.list();
      await waitFor(() => expect(t.events.emit).toHaveBeenCalledTimes(i));
    }
    expect(t.events.emit).toHaveBeenLastCalledWith({
      schema_id: PERSONA_SELECTED_EVENT_SCHEMA_ID,
      version: '1',
      data: { chat_id: 'chat-1', persona_id: 'p1' }
    });
    t.state();
    expect(screen.getAllByTitle('Model')[0].textContent).toBe('Model One');
    expect(screen.getAllByTitle('Provider')[0].textContent).toBe('Local');
    // Per-persona updates must not create a selection/publication loop.
    expect(t.events.emit).toHaveBeenCalledTimes(3);
  });

  it.each(['list first', 'state first'])(
    'restores cached events with %s',
    async order => {
      const t = toolbar();
      if (order === 'list first') {
        t.list();
        t.state();
      } else {
        t.state();
        t.list();
      }
      const view = render(<PersonaControls {...t.props} />);
      await waitFor(() => expect(t.events.emit).toHaveBeenCalledTimes(1));
      expect(screen.getAllByTitle('Model')[0].textContent).toBe('Model One');
      view.unmount();
      // Reopening a toolbar for the same chat requests the current snapshot.
      render(<PersonaControls {...t.props} />);
      await waitFor(() => expect(t.events.emit).toHaveBeenCalledTimes(2));
    }
  );

  it('keeps a missing list distinct from a received persona state', async () => {
    const t = toolbar();
    render(<PersonaControls {...t.props} />);
    t.state();
    t.publish(PERSONAS_EVENT_SCHEMA_ID, {
      chat_id: 'other-chat',
      personas: []
    });
    expect(t.registry.get('chat-1').ready).toBe(false);
    expect(document.querySelector('[title="Loading personas"]')).toBeTruthy();
    expect(t.events.emit).not.toHaveBeenCalled();
  });

  it('preserves an explicit No one selection when the list is refreshed', async () => {
    const t = toolbar();
    render(<PersonaControls {...t.props} />);
    t.list();
    await waitFor(() => expect(t.events.emit).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByTitle('Choose which persona to message'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'No one' }));
    t.events.emit.mockClear();
    t.list();
    expect(t.events.emit).not.toHaveBeenCalled();
    expect(
      screen.getByTitle('Choose which persona to message').textContent
    ).toContain('No one');
  });
});
