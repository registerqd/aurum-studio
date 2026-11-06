# Project Notes

## Internationalization

- Every user-facing copy change must update the internationalization messages in `lib/i18n.tsx` in the same change.
- Do not add hard-coded user-facing strings to components. Use `useI18n()` and `t()` instead.
- English is the source and fallback language. Keep translations for all locales in `SUPPORTED_LOCALES` aligned when adding, changing, or removing copy.
- Include visible labels, status and error messages, dialogs, tooltips, accessibility labels, and empty states in internationalization coverage.
- Preserve locale auto-detection, the persisted `medal-forge-locale` preference, and the global language switcher when changing application layout.

## Material Preset Workflow

When adding or renaming a material preset:

- Add or update the preset in `lib/materials.ts`.
- Every preset must include a `previewSrc` that points to a committed preview asset.
- Store built-in material preview assets in `public/material-previews/`.
- Preview assets should render a small sphere-like material swatch that visually reflects the material color, roughness, metalness, and finish.
- Keep preview filenames stable and kebab-case, for example `brushed-gold.svg`.
- If a future feature generates new materials, generate and save the matching preview asset at creation time, then persist the material record with its preview path.
- Do not leave a material preset without a preview image; the custom material dropdown depends on it.
