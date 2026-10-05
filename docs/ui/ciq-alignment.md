# CIQ / MIQ visual alignment

Daclify uses the operational visual foundations supplied in
`Daclify/docs/CIQ & MIQ Design System Oct 26/`: its `readme.md`, CSS tokens,
components and dashboard/extension screenshots. This establishes visual
continuity with the related project; it does not imply an implemented CIQ
integration.

## Shared foundations

- Espresso background (`#08070a` to `#141012`) with subtle purple/ember washes.
- Brown-black panels, ivory text and amber primary actions. Lime indicates
  success; coral indicates errors and destructive actions.
- Locally bundled variable Inter for operational UI and Lucide line icons via
  the current Vue package. No external font request or React dependency.
- Pill actions/badges, 14px panels, 10px fields and 140ms interaction feedback.
- Semantic values in `src/styles/ciq-tokens.css`; shared components consume them
  through `src/styles.css`.

## Daclify adaptations

The existing Daclify identity, sidebar, dashboard grids, governance workspaces
and documentation layout remain. The reference's narrow meeting-capture width
and marketing serif typography are unsuitable for these operational screens.

Amber buttons use dark text. Input borders are stronger than decorative panel
borders. Filter buttons and standalone help links have 44px touch targets. Keyboard focus, skip navigation,
mobile safe areas and reduced-motion behavior are retained. Destructive controls
use readable coral text on tinted dark backgrounds in all shared variants.

## Verification

After core's documented sibling-repository development bootstrap, run:

```sh
npm run build
npm test
npm run format:check
npm run test:e2e -- theme.spec.ts
```

The theme browser suite covers touch targets, shared destructive-control
contrast, keyboard navigation, account form entry, 320px community/documentation
layouts and recoverable network errors with reduced motion. It runs in desktop
and mobile Chromium with axe accessibility scans.

Its read-only synthetic API fixtures are validated by the pinned public protocol
schemas. They do not establish real chain behavior, signing, custody, settlement,
provider availability or an integration with the related project. Actual commands
and outcomes are recorded in the [execution ledger](../superpowers/plans/2026-10-05-ciq-visual-alignment.md).
