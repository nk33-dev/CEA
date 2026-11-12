import { uiText } from './uiI18n.ts';
export function reuseThemeOptions() {
  return [
    { value: 'original', label: uiText("沿用原配色") },
    { value: 'light', label: uiText("浅色") },
    { value: 'dark', label: uiText("深色") },
    { value: 'both', label: uiText("浅色 + 深色") },
  ];
}
