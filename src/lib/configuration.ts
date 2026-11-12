import { configurationSchema, DEFAULT_UI_PREFERENCES, parseConfiguration, type Configuration } from '../../shared/configuration.ts';
import { DEFAULT_LOCALE } from '../../shared/locales.ts';
import { PREFERENCE_EVENT, PREF_FRAMEWORK, PREF_LOCALE, PREF_UI_LOCALE, PREF_UI_THEME } from './prefs.ts';
import { DEFAULT_DEVICE_JSON, DEVICE_SETTINGS_KEY, readDeviceSettings } from './deviceSettings.ts';

export function exportConfiguration(storage: Pick<Storage, 'getItem'> = localStorage): Configuration {
  return configurationSchema.parse({
    format: 'cea-settings', version: 2, exportedAt: new Date().toISOString(),
    preferences: {
      framework: storage.getItem(PREF_FRAMEWORK) ?? 'html',
      locale: storage.getItem(PREF_LOCALE) ?? DEFAULT_LOCALE,
    },
    ui: {
      theme: storage.getItem(PREF_UI_THEME) ?? DEFAULT_UI_PREFERENCES.theme,
      locale: storage.getItem(PREF_UI_LOCALE) ?? DEFAULT_UI_PREFERENCES.locale,
    },
    devices: readDeviceSettings(storage.getItem(DEVICE_SETTINGS_KEY) ?? DEFAULT_DEVICE_JSON),
  });
}

export function importConfiguration(text: string, storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = localStorage) {
  const config = parseConfiguration(text);
  const entries = [
    [PREF_FRAMEWORK, config.preferences.framework], [PREF_LOCALE, config.preferences.locale],
    [DEVICE_SETTINGS_KEY, JSON.stringify(config.devices)],
    ...(config.ui ? [[PREF_UI_THEME, config.ui.theme], [PREF_UI_LOCALE, config.ui.locale]] : []),
  ];
  const keys = entries.map(([key]) => key);
  const previous = keys.map(key => storage.getItem(key));
  try {
    entries.forEach(([key, value]) => storage.setItem(key, value));
  } catch (error) {
    keys.forEach((key, i) => {
      try { if (previous[i] === null) storage.removeItem(key); else storage.setItem(key, previous[i]!); } catch { /* 存储不可用时尽量恢复已写入的项目。 */ }
    });
    throw error;
  }
  window.dispatchEvent(new Event(PREFERENCE_EVENT));
}

export function downloadConfiguration() {
  const blob = new Blob([JSON.stringify(exportConfiguration(), null, 2) + '\n'], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'cea-settings.json';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
