import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DEVICE_SETTINGS, deviceSettingsSchema, parseConfiguration } from '../shared/configuration.ts';
import { exportConfiguration, importConfiguration } from '../src/lib/configuration.ts';
import { readDeviceSettings, DEVICE_SETTINGS_KEY } from '../src/lib/deviceSettings.ts';
import { PREF_UI_LOCALE, PREF_UI_THEME } from '../src/lib/prefs.ts';

afterEach(() => vi.unstubAllGlobals());

function storage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

describe('设备预设与配置迁移', () => {
  it('只有默认电脑和手机，自定义预设可以恢复；损坏的本机设置使用默认值', () => {
    expect(DEFAULT_DEVICE_SETTINGS.presets).toEqual([]);
    expect(readDeviceSettings('bad')).toEqual(DEFAULT_DEVICE_SETTINGS);
    expect(readDeviceSettings('{}')).toEqual(DEFAULT_DEVICE_SETTINGS);
    expect(deviceSettingsSchema.safeParse({
      presets: [{ id: 'user-my-phone', name: '我的手机', device: 'phone', width: 375, height: 812 }],
      viewports: { desktop: { width: 1440, height: 900 }, phone: { width: 375, height: 812 } },
    }).success).toBe(true);
  });

  it('预设名称去除首尾空格，拒绝未知字段和非整数尺寸', () => {
    const preset = { id: 'user-phone', name: '  Phone  ', device: 'phone', width: 390, height: 844 };
    const valid = { ...DEFAULT_DEVICE_SETTINGS, presets: [preset] };
    expect(deviceSettingsSchema.parse(valid).presets[0].name).toBe('Phone');
    for (const value of [{ ...preset, width: 390.5 }, { ...preset, extra: true }, { ...preset, name: '   ' }]) {
      expect(deviceSettingsSchema.safeParse({ ...valid, presets: [value] }).success).toBe(false);
    }
  });

  it('配置迁移保留尚未安装语言包的语言偏好', () => {
    const source = storage();
    source.setItem('cea:locale', 'pt-BR');
    const config = exportConfiguration(source);
    expect(parseConfiguration(JSON.stringify(config)).preferences.locale).toBe('pt-BR');
    expect(() => parseConfiguration(JSON.stringify({ ...config, preferences: { ...config.preferences, locale: '../pt' } }))).toThrow();
  });

  it('导出导入完整恢复尺寸、选中宽高和界面偏好，不复制草稿和本机路径', () => {
    const source = storage();
    const target = storage();
    const dispatchEvent = vi.fn();
    vi.stubGlobal('window', { dispatchEvent });
    source.setItem('cea:framework', 'vue');
    source.setItem('cea:locale', 'zh');
    source.setItem('cea:theme', 'dark');
    source.setItem(PREF_UI_THEME, 'system');
    source.setItem(PREF_UI_LOCALE, 'pt-BR');
    source.setItem(DEVICE_SETTINGS_KEY, JSON.stringify({
      presets: [{ id: 'user-my-phone', name: '我的手机', device: 'phone', width: 375, height: 812 }],
      viewports: { desktop: { width: 1440, height: 900 }, phone: { width: 812, height: 375 } },
    }));
    source.setItem('cea:draft:new:v2', 'private draft');
    source.setItem('libraryPath', 'E:/private-library');
    target.setItem('cea:draft:new:v2', 'keep this draft');
    const exported = exportConfiguration(source);
    const text = JSON.stringify(exported);
    expect(text).not.toContain('private');
    importConfiguration(text, target);
    expect(target.getItem('cea:framework')).toBe('vue');
    expect(target.getItem('cea:theme')).toBeNull();
    expect(target.getItem(PREF_UI_THEME)).toBe('system');
    expect(target.getItem(PREF_UI_LOCALE)).toBe('pt-BR');
    expect(exported.version).toBe(2);
    expect(text).not.toContain('componentTheme');
    expect(target.getItem('cea:draft:new:v2')).toBe('keep this draft');
    expect(JSON.parse(target.getItem(DEVICE_SETTINGS_KEY)!)).toEqual(exported.devices);
    expect(dispatchEvent).toHaveBeenCalledOnce();
  });

  it('旧配置不将预览配色迁移为网站主题，也不覆盖已保存的网站偏好', () => {
    const target = storage();
    target.setItem(PREF_UI_THEME, 'dark');
    target.setItem(PREF_UI_LOCALE, 'fr');
    vi.stubGlobal('window', { dispatchEvent: vi.fn() });
    const current = exportConfiguration(target);
    const { ui: _, ...base } = current;
    const legacy = { ...base, version: 1, preferences: {
      framework: 'vue', locale: 'zh', theme: 'dark', componentTheme: 'dark',
    } };
    const parsed = parseConfiguration(JSON.stringify(legacy));
    expect(parsed.version).toBe(2);
    expect(parsed.ui).toBeUndefined();
    importConfiguration(JSON.stringify(parsed), target);
    expect(target.getItem(PREF_UI_THEME)).toBe('dark');
    expect(target.getItem(PREF_UI_LOCALE)).toBe('fr');
    expect(target.getItem('cea:theme')).toBeNull();
    expect(target.getItem('cea:component-theme')).toBeNull();
    expect(target.getItem('cea:locale')).toBe('zh');
  });

  it('拒绝未来版本、非法尺寸、重复 ID 和额外字段，验证失败时不写入', () => {
    const target = storage();
    const valid = exportConfiguration(target);
    const invalids = [
      { ...valid, version: 99 },
      { ...valid, libraryPath: 'C:/private' },
      { ...valid, preferences: { ...valid.preferences, framework: 'not-a-framework' } },
      { ...valid, ui: { theme: 'invalid', locale: 'fr' } },
      { ...valid, ui: { theme: 'system', locale: '../fr' } },
      { ...valid, ui: { theme: 'dark', locale: 'fr', componentTheme: 'dark' } },
      { ...valid, devices: { ...valid.devices, viewports: { ...valid.devices.viewports, phone: { width: 0, height: 99999 } } } },
      { ...valid, devices: { ...valid.devices, presets: Array(2).fill({ id: 'user-same', name: 'Same', device: 'phone', width: 390, height: 844 }) } },
    ];
    for (const input of invalids) expect(() => importConfiguration(JSON.stringify(input), target)).toThrow();
    expect(target.values.size).toBe(0);
    expect(() => parseConfiguration('bad')).toThrow(/JSON/);
    expect(() => parseConfiguration(' '.repeat(256 * 1024 + 1))).toThrow(/256 KB/);
  });

  it('存储写入失败时恢复已修改的偏好，不报告成功', () => {
    const target = storage();
    target.setItem('cea:framework', 'html');
    const config = exportConfiguration(target);
    config.preferences.framework = 'vue';
    let writes = 0;
    const failing = { ...target, setItem: (key: string, value: string) => {
      if (++writes === 2) throw new Error('quota');
      target.setItem(key, value);
    } };
    expect(() => importConfiguration(JSON.stringify(config), failing)).toThrow('quota');
    expect(target.getItem('cea:framework')).toBe('html');
    expect(target.values.size).toBe(1);
  });
});
