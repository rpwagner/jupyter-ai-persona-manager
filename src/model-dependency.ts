/** Pure projection and reconciliation of private, per-message selections. */
import { ModelConfiguration, SettingConfiguration } from './awareness';
import { PersonaSettings } from './metadata';

/** Only the published configuration is needed, not a session registry. */
export type PersonaConfiguration = {
  model: ModelConfiguration;
  settings: SettingConfiguration[];
};

export function effectiveDependencyValue(
  persona: PersonaConfiguration,
  pending: PersonaSettings
): string | null {
  const id = persona.model.dependency?.setting_id;
  if (id === undefined) {
    return null;
  }
  return (
    pending.settings[id] ??
    persona.settings.find(setting => setting.id === id)?.current ??
    null
  );
}

/**
 * Project a pending domain without changing published session state. In the
 * active domain Default still means the current model; in a different domain
 * it means the default the persona will use after applying the setting.
 * Model settings belong to the active domain and are hidden outside it.
 */
export function projectModelConfiguration(
  persona: PersonaConfiguration,
  pending: PersonaSettings
): ModelConfiguration {
  const dependency = persona.model.dependency;
  const value = effectiveDependencyValue(persona, pending);
  if (
    !dependency ||
    value === null ||
    !Object.prototype.hasOwnProperty.call(dependency.values, value)
  ) {
    return persona.model;
  }
  const domain = dependency.values[value];
  const activeValue =
    persona.settings.find(setting => setting.id === dependency.setting_id)
      ?.current ?? null;
  const active = value === activeValue;
  return {
    ...persona.model,
    current: active ? persona.model.current : domain.default_model,
    options: domain.options,
    settings: active ? persona.model.settings : []
  };
}

/**
 * Reconcile both a control edit (same published configuration, new pending
 * values) and an incoming event (new configuration, same pending values).
 * Call before rendering or writing metadata. Unrelated settings are retained.
 */
export function reconcilePersonaSettings(
  previous: PersonaConfiguration,
  next: PersonaConfiguration,
  pending: PersonaSettings,
  previousPending: PersonaSettings = pending
): PersonaSettings {
  if (!next.model.dependency && !previous.model.dependency) {
    return pending;
  }
  let result = pending;
  const dependency = next.model.dependency;
  if (dependency) {
    const id = dependency.setting_id;
    const value = pending.settings[id];
    const setting = next.settings.find(setting => setting.id === id);
    if (
      value !== undefined &&
      value !== null &&
      !setting?.options.some(option => option.id === value)
    ) {
      result = { ...result, settings: { ...result.settings, [id]: null } };
    }
  }
  const model = projectModelConfiguration(next, result);
  if (
    result.modelId !== null &&
    !model.options.some(option => option.id === result.modelId)
  ) {
    result = { ...result, modelId: null };
  }
  const previousModel = projectModelConfiguration(previous, previousPending);
  const contextChanged =
    previous.model.dependency?.setting_id !== dependency?.setting_id ||
    effectiveDependencyValue(previous, previousPending) !==
      effectiveDependencyValue(next, result) ||
    (previousPending.modelId ?? previousModel.current) !==
      (result.modelId ?? model.current);
  const staleModelSetting = Object.entries(result.modelSettings).some(
    ([id, value]) =>
      value !== null &&
      !model.settings.some(
        setting =>
          setting.id === id &&
          setting.options.some(option => option.id === value)
      )
  );
  if (
    (contextChanged || staleModelSetting) &&
    Object.keys(result.modelSettings).length
  ) {
    result = { ...result, modelSettings: {} };
  }
  return result;
}
