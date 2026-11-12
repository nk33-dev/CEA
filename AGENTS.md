# CEA Maintenance

## Repository Boundary

- Keep collected components, prompts, media, databases and backups in the external library, not in this repository.
- Do not add bundled materials or asset-specific source-rewriting migrations to the application.
- Use small synthetic fixtures in unit tests. Never read or modify the user's real library in unit tests.
- CEA application code uses PolyForm Noncommercial 1.0.0. Third-party dependencies and imported assets retain their own licenses.

## Preview And Reuse

- Read `docs/themes.md` before changing theme, preview-background, or AI-target behavior.
- A framework has one canonical implementation. Do not duplicate or rewrite source files to generate theme variants.
- Keep stage background and component appearance in `usePreviewSession`; leaving the page discards them. Do not persist them or read legacy `cea:theme` / `cea:component-theme` preferences.
- Website preferences use `PREF_UI_THEME` / `PREF_UI_LOCALE`, separate from preview state and asset content language. Configuration v2 preserves these keys; importing v1 must not overwrite website preferences.
- Syntax highlighting is presentation work, not database loading. Render readable source before highlighting; copy/export always use the complete original text.

## Content Languages

- Read `docs/i18n.md` before adding a language or changing language behavior.
- Add translated copy to `shared/i18n/<locale>.ts`, typed as `LocaleInfo`, and register it in `shared/locales.ts`.
- Reuse `locale`, `localeChain`, `translatedValue`, `pickText`, `useContentLocale`, and `LanguageControl`. Do not add language-specific branches in pages or components.
- Keep application UI language, asset content language, and component source text independent. A content-language switch must not rewrite source code or reload a preview.
- Preserve valid language-tagged user data even when its language pack is not installed. Do not bulk translate or migrate existing assets to add a language.
- Run `npm run typecheck`, `npm test`, and `npm run build`. `tests/i18n.test.ts` guards the shared entry points and language boundaries.
