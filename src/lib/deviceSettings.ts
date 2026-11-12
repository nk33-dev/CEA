import { useMemo } from 'react';
import { DEFAULT_DEVICE_SETTINGS, deviceSettingsSchema, type DeviceSettings } from '../../shared/configuration.ts';
import { usePref } from './prefs.ts';

export const DEVICE_SETTINGS_KEY = 'cea:devices:v1';
export const DEFAULT_DEVICE_JSON = JSON.stringify(DEFAULT_DEVICE_SETTINGS);

export function readDeviceSettings(text: string): DeviceSettings {
  try {
    const result = deviceSettingsSchema.safeParse(JSON.parse(text));
    return result.success ? result.data : DEFAULT_DEVICE_SETTINGS;
  } catch { return DEFAULT_DEVICE_SETTINGS; }
}

export function useDeviceSettings() {
  const [json, setJson] = usePref(DEVICE_SETTINGS_KEY, DEFAULT_DEVICE_JSON);
  const settings = useMemo(() => readDeviceSettings(json), [json]);
  return [settings, (next: DeviceSettings) => setJson(JSON.stringify(deviceSettingsSchema.parse(next)))] as const;
}
