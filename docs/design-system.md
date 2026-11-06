# Medal Forge Design System

The editor uses one compact, Figma-inspired visual system. Shared controls must be
implemented through `components/ui` rather than by adding a new global class.

## Foundations

Design tokens live in `app/design-system.css` and are scoped to `.app-shell`.
Light and dark themes redefine semantic tokens, not component selectors.

- Spacing uses the `--ds-space-*` scale.
- Interactive controls use `--ds-control-height` and `--ds-radius-control`.
- Cards use `--ds-radius-card` and `--ds-surface-subtle`.
- Text uses primary, secondary, and tertiary semantic colors.
- Focus always uses `--ds-focus`; components must not introduce colored focus rings.
- Primary actions use the neutral `--ds-action-primary` pair.

## Components

Reusable Inspector primitives live in `components/ui/inspector.tsx`, with encapsulated
styles in `components/ui/inspector.module.css`.

- `Button`: primary, secondary, ghost, and icon actions.
- `SegmentedControl`: mode or format selection.
- `InspectorSection`: top-level sidebar grouping.
- `InspectorStack`: standard vertical rhythm inside a section.
- `InspectorCard`: nested settings group.
- `FieldRow` and `FieldGrid`: label/control layout.
- `NumberField` and `Select`: standard inputs.
- `ScrubbableNumberField`: editor numeric input with pointer-drag adjustment.
- `MaterialSelect`: material picker with preview swatches.
- `InspectorSummary`: tertiary metadata and export estimates.

## Rules

1. Reuse a primitive before creating a new component.
2. Add a semantic token when a shared visual decision is missing; never copy a literal
   color, radius, height, or focus ring into another component.
3. Keep feature-specific layout next to the feature, but keep generic controls in
   `components/ui` with CSS Modules.
4. A new control variant must work in light and dark themes in the same change.
5. Do not reintroduce the retired global control classes checked by
   `npm run check:design-system`.
