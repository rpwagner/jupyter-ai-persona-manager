import { configuration, option, setting } from './model-dependency-fixture';
import {
  buildMessageMetadata,
  emptyPersonaSettings,
  PersonaSettings
} from '../metadata';
import {
  effectiveDependencyValue,
  projectModelConfiguration,
  reconcilePersonaSettings
} from '../model-dependency';
import { buildControls } from '../persona-controls';

const pending = (
  backend: string | null = 'B',
  modelId: string | null = 'B2'
): PersonaSettings => ({
  modelId,
  modelSettings: { detail: 'high' },
  settings: { backend, format: 'rich' }
});

describe('model dependency', () => {
  it('projects a pending domain without mutating published state', () => {
    const state = configuration();
    const projection = projectModelConfiguration(state, pending());
    expect(projection.options.map(o => o.id)).toEqual(['B1', 'B2', 'shared']);
    expect(projection.current).toBe('B1');
    expect(projection.settings).toEqual([]);
    expect(state.model.current).toBe('A1');
    expect(state.settings[0].current).toBe('A');
    expect(buildControls(state, pending())[0].options.map(o => o.id)).toEqual([
      'B1',
      'B2',
      'shared'
    ]);
  });

  it('uses published setting and actual current model for null or absent pending values', () => {
    const state = configuration('A', 'A2');
    for (const selection of [emptyPersonaSettings(), pending(null, null)]) {
      expect(effectiveDependencyValue(state, selection)).toBe('A');
      expect(projectModelConfiguration(state, selection).current).toBe('A2');
      expect(projectModelConfiguration(state, selection).settings).toEqual(
        state.model.settings
      );
    }
  });

  it('falls back when the setting or mapping is unavailable', () => {
    const state = configuration();
    expect(projectModelConfiguration(state, pending('unmapped'))).toBe(
      state.model
    );
    expect(
      projectModelConfiguration(
        { ...state, settings: [] },
        emptyPersonaSettings()
      )
    ).toBe(state.model);
  });

  it.each(['shared', 'B2'])(
    'preserves an exact valid model ID %s on domain change',
    model => {
      const state = configuration();
      const before = pending('A', model);
      const after = reconcilePersonaSettings(
        state,
        state,
        pending('B', model),
        before
      );
      expect(after.modelId).toBe(model);
      expect(after.modelSettings).toEqual({});
      expect(after.settings.format).toBe('rich');
      expect(before.modelSettings).toEqual({ detail: 'high' });
    }
  );

  it('clears an invalid model and settings atomically on domain change', () => {
    const state = configuration();
    const result = reconcilePersonaSettings(
      state,
      state,
      pending('B', 'A2'),
      pending('A', 'A2')
    );
    expect(result).toEqual({
      modelId: null,
      modelSettings: {},
      settings: { backend: 'B', format: 'rich' }
    });
    expect(buildMessageMetadata('configurable', result)).toEqual({
      to_persona: 'configurable',
      model: { id: null, settings: {} },
      settings: { backend: 'B', format: 'rich' }
    });
  });

  it('clears settings when the explicit model changes within a domain', () => {
    const state = configuration();
    expect(
      reconcilePersonaSettings(
        state,
        state,
        pending('A', 'A2'),
        pending('A', 'A1')
      ).modelSettings
    ).toEqual({});
  });

  it('clears settings when returning the dependent setting to Default', () => {
    const state = configuration();
    const result = reconcilePersonaSettings(
      state,
      state,
      pending(null, 'B2'),
      pending()
    );
    expect(result.modelId).toBeNull();
    expect(result.modelSettings).toEqual({});
  });

  it('preserves valid pending dependency and model across independent session changes', () => {
    const before = configuration();
    const selection = { ...pending(), modelSettings: {} };
    const after = reconcilePersonaSettings(
      before,
      configuration('B'),
      selection
    );
    expect(after).toBe(selection);
  });

  it('reconciles a removed dependency option without clearing unrelated settings', () => {
    const before = configuration();
    const next = { ...before, settings: [setting('backend', 'A', ['A'])] };
    const result = reconcilePersonaSettings(before, next, pending());
    expect(result.settings).toEqual({ backend: null, format: 'rich' });
    expect(result.modelId).toBeNull();
    expect(result.modelSettings).toEqual({});
  });

  it('reconciles a changed catalog even if the pending dependency value is valid', () => {
    const before = configuration();
    const next = configuration('B');
    next.model.dependency!.values.B.options = [option('B1')];
    const result = reconcilePersonaSettings(before, next, pending());
    expect(result.settings.backend).toBe('B');
    expect(result.modelId).toBeNull();
    expect(result.modelSettings).toEqual({});
  });

  it('clears default model settings when another user changes the active context', () => {
    const selection = {
      ...emptyPersonaSettings(),
      modelSettings: { detail: 'high' },
      settings: { format: 'rich' }
    };
    const result = reconcilePersonaSettings(
      configuration(),
      configuration('B'),
      selection
    );
    expect(result.modelSettings).toEqual({});
    expect(result.settings).toEqual({ format: 'rich' });
  });

  it('clears settings on a model-only published change or invalid setting options', () => {
    const before = configuration();
    const selection = { ...pending('A', null) };
    expect(
      reconcilePersonaSettings(before, configuration('A', 'A2'), selection)
        .modelSettings
    ).toEqual({});
    const next = configuration();
    next.model.settings[0].options = [option('low')];
    expect(
      reconcilePersonaSettings(before, next, selection).modelSettings
    ).toEqual({});
  });

  it('preserves model settings for unrelated partial events and unchanged contexts', () => {
    const before = configuration();
    const selection = pending('A', 'A2');
    const next = before.withUpdate({ processing: true });
    expect(reconcilePersonaSettings(before, next, selection)).toBe(selection);
    expect(next.model.dependency).toEqual(before.model.dependency);
  });

  it('does not mutate a second user or shared option objects', () => {
    const state = configuration();
    const second = pending('A', 'A2');
    reconcilePersonaSettings(state, state, pending(), second);
    expect(second).toEqual(pending('A', 'A2'));
    expect(state).toEqual(configuration());
  });

  it('leaves legacy selections and model configuration unchanged without a dependency', () => {
    const state = configuration();
    delete state.model.dependency;
    const selection = pending();
    expect(reconcilePersonaSettings(state, state, selection)).toBe(selection);
    expect(projectModelConfiguration(state, selection)).toBe(state.model);
  });

  it('accepts empty option IDs and does not read inherited mapping entries', () => {
    const state = configuration();
    state.model.dependency!.values[''] = {
      default_model: 'B1',
      options: [option('B1')]
    };
    expect(projectModelConfiguration(state, pending('')).current).toBe('B1');
    expect(projectModelConfiguration(state, pending('__proto__'))).toBe(
      state.model
    );
  });
});
