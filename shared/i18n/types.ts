export type ThemeName = 'original' | 'light' | 'dark' | 'both';
export type NoteKind = 'press' | 'touch' | 'credits' | 'fonts' | 'requires' | 'browser' | 'global' | 'note' | 'license';

export interface LocaleInfo {
  id: string;
  label: string;
  name: string;
  direction: 'ltr' | 'rtl';
  fallback?: string;
  intro: (head: { title: string }) => string;
  adapt: string;
  demoOnly: string;
  sections: { markup: string; style: string; script: string };
  dependencies: string;
  theme: {
    labels: Record<ThemeName, string>;
    goals: Record<Exclude<ThemeName, 'original'>, string>;
    keepOnly: Record<'light' | 'dark', string>;
    rewriteColors: (from: ThemeName, to: Exclude<ThemeName, 'original'>) => string;
    singleRule: string;
    dualRule: string;
    ideaPriority: string;
  };
  notes: {
    heading: string;
    empty: string;
    motion: string;
    original: string;
    licenseLink: string;
    titles: Record<NoteKind, string>;
    legacyMotion: Record<string, string>;
    legacyPress?: string;
    legacyTouch?: string;
  };
}
