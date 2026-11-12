import type { LocaleInfo } from './types.ts';

export const en: LocaleInfo = {
  id: 'en', label: 'EN', name: 'English', direction: 'ltr',
  intro: h => `Add the "${h.title}" component to my project.`,
  adapt: "Follow my project's conventions and preserve the component's interactions and motion.",
  demoOnly: 'Controls marked data-demo-only exist only for the asset preview. When integrating, remove only those controls, their dedicated styles and their manual-selection handlers. Fully preserve every business state, intensity level, rendering path, animation and business interaction, and trigger them from project data.',
  sections: { markup: 'Markup', style: 'Styles', script: 'Script (runs once after the markup)' },
  dependencies: 'Dependencies',
  theme: {
    labels: { original: 'Original colors', light: 'Light only', dark: 'Dark only', both: 'Light and dark' },
    goals: {
      light: 'Colors: light only.',
      dark: 'Colors: dark only.',
      both: 'Colors: light and dark, switchable.',
    },
    keepOnly: {
      light: 'The reference ships light and dark palettes; drop the dark one.',
      dark: 'The reference ships light and dark palettes; drop the light one.',
    },
    rewriteColors: (from, to) => {
      const names = { original: 'one fixed palette', light: 'light', dark: 'dark', both: 'light and dark' };
      return `The reference is ${names[from]}; ${to === 'both' ? 'add the missing palette' : 'recolor it for the target'}, keeping structure and motion.`;
    },
    singleRule: 'Put colors in CSS variables on the component root; do not follow the system color scheme.',
    dualRule: 'Put both palettes in CSS variables on the component root and switch them with data-theme or a class; a darker background alone is not dark mode.',
    ideaPriority: 'If the description below mentions other colors, this wins.',
  },
  notes: {
    heading: 'Usage notes', empty: 'No notes', motion: 'Motion', original: 'Original note', licenseLink: 'License',
    titles: { press: 'Press feedback', touch: 'Touch & pointer', credits: 'Credits', fonts: 'Fonts', requires: 'Requires', browser: 'Browser support', global: 'Global', note: 'Note', license: 'Icons & license' },
    legacyMotion: {},
  },
};
