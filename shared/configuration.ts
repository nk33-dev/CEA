import * as z from 'zod/mini';
import { FRAMEWORK_IDS } from './frameworks.ts';
import { normalizeLocale, UI_LOCALE } from './locales.ts';
import { DEVICE_VIEWPORTS } from './preview.ts';

export const deviceSizeSchema = z.strictObject({
  width: z.int().check(z.minimum(240), z.maximum(3840)),
  height: z.int().check(z.minimum(240), z.maximum(3840)),
});

export const devicePresetSchema = z.extend(deviceSizeSchema, {
  id: z.string().check(z.regex(/^user-[a-z0-9-]{1,80}$/)),
  name: z.string().check(z.trim(), z.minLength(1), z.maxLength(40)),
  device: z.enum(['desktop', 'phone']),
});

export const deviceSettingsSchema = z.strictObject({
  presets: z.array(devicePresetSchema).check(z.maxLength(100), z.refine(items => new Set(items.map(p => p.id)).size === items.length)),
  viewports: z.strictObject({ desktop: deviceSizeSchema, phone: deviceSizeSchema }),
});

export type DevicePreset = z.infer<typeof devicePresetSchema>;
export type DeviceSettings = z.infer<typeof deviceSettingsSchema>;
export const DEFAULT_DEVICE_SETTINGS: DeviceSettings = { presets: [], viewports: DEVICE_VIEWPORTS };

const preferencesSchema = z.strictObject({
  framework: z.string().check(z.refine(value => FRAMEWORK_IDS.includes(value))),
  locale: z.string().check(z.refine(value => normalizeLocale(value) !== null)),
});

const configurationBase = z.strictObject({
  format: z.literal('cea-settings'),
  exportedAt: z.string().check(z.maxLength(64)),
  devices: deviceSettingsSchema,
});

export const DEFAULT_UI_PREFERENCES = { theme: 'light' as const, locale: UI_LOCALE };

export const configurationSchema = z.extend(configurationBase, {
  version: z.literal(2),
  preferences: preferencesSchema,
  ui: z.optional(z.strictObject({
    theme: z.enum(['light', 'dark', 'system']),
    locale: z.string().check(z.refine(value => normalizeLocale(value) !== null)),
  })),
});

const legacyConfigurationSchema = z.extend(configurationBase, {
  version: z.literal(1),
  preferences: z.extend(preferencesSchema, {
    theme: z.enum(['light', 'dark']),
    componentTheme: z.enum(['light', 'dark']),
  }),
});

export type Configuration = z.infer<typeof configurationSchema>;

export function parseConfiguration(text: string): Configuration {
  if (text.length > 256 * 1024) throw new Error('配置文件不能超过 256 KB');
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error('配置文件不是有效的 JSON'); }
  const result = configurationSchema.safeParse(value);
  if (result.success) return result.data;
  const legacy = legacyConfigurationSchema.safeParse(value);
  if (!legacy.success) throw new Error('配置格式或版本不支持，请选择 CEA 导出的配置文件');
  return {
    ...legacy.data, version: 2,
    preferences: { framework: legacy.data.preferences.framework, locale: legacy.data.preferences.locale },
  };
}
