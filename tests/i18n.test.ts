import fs from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as languages from '../shared/locales.ts';
import { en } from '../shared/i18n/en.ts';
import type { LocaleInfo } from '../shared/i18n/types.ts';
import { localizedName, localizedTitle, translatedValue } from '../shared/contentLocale.ts';
import { buildIdeaPrompt, buildReplicaPrompt } from '../shared/prompt.ts';
import { themePrompt } from '../shared/theme.ts';
import { motionLabel, presentNote, splitTranslation } from '../shared/notePresentation.ts';
import { LanguageControl } from '../src/components/LanguageControl.tsx';

afterEach(() => vi.restoreAllMocks());

describe('语言包与回退', () => {
  it('登记的语言码唯一且规范，完整提供提示词、主题和说明文案', () => {
    expect(new Set(languages.LOCALE_IDS).size).toBe(languages.LOCALES.length);
    for (const pack of languages.LOCALES) {
      expect(languages.normalizeLocale(pack.id)).toBe(pack.id);
      expect(pack.label.trim()).not.toBe('');
      expect(pack.name.trim()).not.toBe('');
      expect(['ltr', 'rtl']).toContain(pack.direction);
      if (pack.fallback) expect(languages.LOCALE_IDS).toContain(pack.fallback);
      expect(Object.keys(pack.theme.labels).sort()).toEqual(['both', 'dark', 'light', 'original']);
      expect(Object.keys(pack.theme.goals).sort()).toEqual(['both', 'dark', 'light']);
      expect(Object.keys(pack.notes.titles).sort()).toEqual(Object.keys(en.notes.titles).sort());
      expect(pack.intro({ title: 'Sample' })).toContain('Sample');
      const checkCopy = (value: unknown) => {
        if (typeof value === 'string') expect(value.trim()).not.toBe('');
        else if (value && typeof value === 'object') Object.values(value).forEach(checkCopy);
      };
      checkCopy(pack);
      expect(pack.theme.rewriteColors('original', 'both').trim()).not.toBe('');
    }
  });

  it('规范地区、文字体系和数字地区码，拒绝路径与任意对象键', () => {
    expect(languages.normalizeLocale('pt-br')).toBe('pt-BR');
    expect(languages.normalizeLocale('ZH-hant')).toBe('zh-Hant');
    expect(languages.normalizeLocale('es-419')).toBe('es-419');
    for (const bad of ['../fr', '__proto__', 'en_US', 'x', 'fr<script>', '']) expect(languages.normalizeLocale(bad)).toBeNull();
    expect(languages.localeChain('zh-Hant-HK')).toEqual(['zh-Hant-HK', 'zh-Hant', 'zh', 'en']);
    expect(languages.localeChain('fr-CA-u-nu-latn')).toEqual(['fr-CA-u-nu-latn', 'fr-CA', 'fr', 'en']);
    expect(languages.locale('zh-Hant').id).toBe('zh');
    expect(languages.locale('fr-CA').id).toBe('en');
  });

  it('标题和标签只回退到父语言或原名，长文案按固定顺序回退', () => {
    expect(localizedName('Original', { fr: 'Carte', en: 'Map' }, 'fr-CA')).toBe('Carte');
    expect(localizedName('Original', { en: 'Map' }, 'fr')).toBe('Original');
    expect(localizedTitle({ title: 'Original', texts: { 'pt-BR': { title: 'Mapa', summary: '', idea: '' } } }, 'PT-br')).toBe('Mapa');
    const first = { zh: '中文', en: 'English' };
    const second = { en: 'English', zh: '中文' };
    expect(translatedValue(first, 'fr', text => text)).toBe('English');
    expect(translatedValue(second, 'fr', text => text)).toBe('English');
  });

  it('第三语言的主题、提示词和说明共用语言包入口，不走中英分支', () => {
    const pack: LocaleInfo = {
      ...en, id: 'fr', label: 'FR', name: 'Français',
      intro: ({ title }) => `Ajouter « ${title} ».`,
      theme: { ...en.theme, goals: { ...en.theme.goals, light: 'Clair uniquement' } },
      notes: { ...en.notes, titles: { ...en.notes.titles, note: 'Remarque' } },
    };
    vi.spyOn(languages, 'locale').mockReturnValue(pack);
    const asset = { title: 'Map', sourceUrl: '', sourceName: '', texts: { fr: { title: 'Carte', summary: '', idea: 'Dessiner une carte' } }, variants: [] };
    expect(buildReplicaPrompt(asset, { locale: 'fr', framework: 'html' })).toContain('Ajouter « Carte »');
    expect(themePrompt({ version: 1, mode: 'both', default: 'light', source: 'declared' }, 'light', 'fr')).toContain('Clair uniquement');
    expect(buildIdeaPrompt(asset, { locale: 'fr' })).toBe('Dessiner une carte\n');
    expect(presentNote('Note: Original', 'fr').title).toBe('Remarque');
  });

  it('注释译文支持文字体系与数字地区码，缺失译文保留原文', () => {
    const value = 'Speed | zh-Hant: 動畫速度 | es-419: Velocidad | fr: Vitesse';
    expect(motionLabel(value, 'zh-Hant-TW')).toBe('動畫速度');
    expect(motionLabel(value, 'es-419')).toBe('Velocidad');
    expect(splitTranslation(value, 'fr-CA').text).toBe('Vitesse');
    expect(motionLabel(value, 'ja')).toBe('Speed');
  });

  it('分主题思路先按语言回退，保留该语言的结构和交互说明', () => {
    const asset = { title: 'Map', sourceName: '', sourceUrl: '', variants: [], texts: {
      fr: { summary: '', idea: 'Carte interactive', themeIdeas: { light: 'Carte claire interactive' } },
      en: { summary: '', idea: 'English reference' },
    } };
    expect(buildIdeaPrompt(asset, { locale: 'fr-CA', targetTheme: 'light' })).toContain('Carte claire interactive');
    expect(buildIdeaPrompt(asset, { locale: 'fr-CA', targetTheme: 'dark' })).toContain('Carte interactive');
  });
});

describe('语言选择器', () => {
  it('少量语言保持分段，多个语言统一切换为下拉，现有数据语言也可选择', () => {
    const options = languages.contentLanguages(['fr', 'ar', 'pt-BR']);
    expect(options.map(o => o.id)).toContain('pt-BR');
    const render = (options: languages.LocaleOption[]) => renderToStaticMarkup(createElement(LanguageControl, {
      value: 'en', onChange: () => {}, options,
    }));
    expect(render(options.slice(0, 2))).toContain('role="radiogroup"');
    expect(render(options)).toContain('role="combobox"');
    expect(render(options)).not.toContain('role="radiogroup"');
  });
});

describe('语言维护边界', () => {
  it('业务与组件不自行判断中英分支', () => {
    const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
      entry.isDirectory() ? walk(path.join(dir, entry.name)) : /\.(ts|tsx)$/.test(entry.name) ? [path.join(dir, entry.name)] : []);
    const files = [...walk('src'), ...walk('shared').filter(file => !file.includes(`${path.sep}i18n${path.sep}`))];
    for (const file of files) {
      expect(fs.readFileSync(file, 'utf8'), file).not.toMatch(/\b(?:locale|textLocale|loc|l\.id)\s*===?\s*['"](?:en|zh)['"]/);
    }
  });
});
