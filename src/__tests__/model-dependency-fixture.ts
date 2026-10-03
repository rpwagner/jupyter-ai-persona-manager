import { ModelOption, SettingConfiguration } from '../awareness';
import { PersonaSessionState } from '../persona-events';

export const option = (id: string): ModelOption => ({
  id,
  name: id,
  description: null
});
export const setting = (
  id: string,
  current: string,
  values: string[]
): SettingConfiguration => ({
  id,
  current,
  name: id,
  description: null,
  options: values.map(option)
});

export function configuration(
  backend = 'A',
  model = `${backend}1`
): PersonaSessionState {
  return new PersonaSessionState('configurable', {
    model: {
      current: model,
      options: [`${backend}1`, `${backend}2`, 'shared'].map(option),
      settings: [setting('detail', 'low', ['low', 'high'])],
      dependency: {
        setting_id: 'backend',
        values: {
          A: {
            default_model: 'A1',
            options: ['A1', 'A2', 'shared'].map(option)
          },
          B: {
            default_model: 'B1',
            options: ['B1', 'B2', 'shared'].map(option)
          }
        }
      }
    },
    settings: [
      setting('backend', backend, ['A', 'B', 'unmapped']),
      setting('format', 'plain', ['plain', 'rich'])
    ]
  });
}
