import { useState } from 'react';
import type { ComponentTheme } from '../../shared/theme.ts';

export function usePreviewSession() {
  const [background, setBackground] = useState<ComponentTheme>('light');
  const [componentTheme, setComponentTheme] = useState<ComponentTheme | null>(null);
  return { background, setBackground, componentTheme, setComponentTheme };
}
