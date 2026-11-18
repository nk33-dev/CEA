import type { Variant } from '../shared/types.ts';
import { resolveTheme } from '../shared/theme.ts';
import { bundle } from './bundler.ts';
import { bundlePlayPage, htmlPlayPage } from './play.ts';

export async function playbackDocument(key: string, title: string, variant: Variant, dependencyRoot?: string) {
  if (variant.framework === 'html') {
    const entry = variant.files.find(file => file.path === 'script.mjs' && file.content.trim());
    const result = entry ? await bundle('html', key, variant.files, entry.path, variant.resources, dependencyRoot) : null;
    return result?.error ? bundlePlayPage(title, '', result.error)
      : htmlPlayPage(title, variant.files, { theme: resolveTheme(variant) }, result?.code);
  }
  const result = await bundle(variant.framework, key, variant.files, variant.previewEntry ?? variant.entry, variant.resources, dependencyRoot);
  return bundlePlayPage(title, result.code, result.error, { theme: resolveTheme(variant) });
}
