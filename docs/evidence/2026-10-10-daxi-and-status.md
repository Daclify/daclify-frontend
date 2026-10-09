# Daxi and tabbed Status

Development on `dev`, 9–10 October 2026, frontend/public SDK/help **0.9.0-alpha.6**. The preceding [welcome page and grouped handbook](2026-10-09-homepage-and-handbook.md) are delivered with these changes. Backend implementation, sources, model evaluation and limitations are in the [core execution record](../../../daclify-backend-core/docs/evidence/2026-10-10-daxi-and-status.md).

## Implementation

Daxi's floating window and question suggestions cover Daclify, Telos and DAOs. Reviewed learning guides show HTTPS source links and dates. Safe text rendering, 100-message browser history, account/network isolation, dragging, resizing and minimizing remain. Older `{configured}` assistant responses remain accepted by the new client; deploy the updated client before an API returning the new profile metadata.

Status uses keyboard-accessible tabs with linked panels: Overview, Network, Contracts, Fees, Services and AI Daxi Help. AI settings show public scope, model names and knowledge version; failed AI metadata requests stay separate from platform failures and absent configuration. Existing network, authority, RAM, fee, resource and service fields remain available. Database migration listings leave the UI. Corrected obsolete creation-price headlines; old on-chain configuration is labelled separately rather than presented as a checkout quote.

The SDK-only update preserves module contract version 0.9.0-alpha.5. The frontend compatibility gate uses that contract release and still rejects older unsupported versions and wrong code hashes. Its regression failed before the fix. The two alpha.6 public archives replace unused alpha.5 archives; dependency lock integrity is refreshed from producer builds. No API services, private env files, install hooks or credentials are bundled.

Registering the new Status tests exposed an existing requirement-checker bug: regex comment removal interpreted URL globs as comments and missed real tests. The checker now uses the already-installed TypeScript parser, and rejects fake test calls inside strings. Its failing regression was observed before implementation.

## Actual verification

- Producer development bootstrap: locked builder/compiler, core public package, modules build/package, frontend archive copying and `npm ci` completed. No registry publication or deployment.
- Final `npm run verify`: lint, Vue/TypeScript and **163 tests / 33 files passed**. Final static build passed. Includes package integrity/content/compatibility checks and the strengthened module-version regression.
- Main selected browser run: **56 desktop/mobile cases passed** across Status, Daxi, handbook, people/workspace, homepage, permission diagram, theme and the changed account-shell navigation/help cases. HTTP fixtures exercise most UI flows; the shell cases read the local API.
- Dedicated `playwright.network-lock.config.ts`: **6 desktop/mobile cases passed** with its fixed testnet build, wrong-network blocking and preserved Home access.
- After fixing SDK-versus-contract comparison, catalogue-navigation and executive UI regressions: **22 desktop/mobile cases passed**. These are HTTP fixtures, not native permission changes. Across the final selections there are **84 distinct browser cases**. Keyboard, accessibility and narrow-viewport checks passed in their selected suites.
- An earlier incorrect combined invocation ran network-lock tests against the ordinary local frontend and a live-registration EVM pairing case against the wrong API origin: **56 passed / 8 failed**. The six network-lock cases passed with their required dedicated configuration. The unchanged EVM pairing test was excluded from the changed-shell selection; it needs its owned registration/API setup, and is not claimed as qualified here.
- Read-only real-browser flow against `http://testnet.localhost:5198` and local testnet API alpha.6: Home, actual runtime `daclifycore1`, Contracts and AI status, live Telos answer, `/docs/telos`, and its official source link passed. Early smoke-script source assertions used the wrong exact title; the canonical title is “Telos Zero toolkit” and the final flow passed with it. No chain writes, wallet signatures, payments or Telegram messages were sent.
- Reviewed desktop/mobile Status screenshots plus actual connected Status and Telos guide screenshots. Earlier homepage/handbook screenshots were reviewed in their own record. Local artifacts are not committed.

## Remaining qualification

Telegram chat is still disabled locally and real HTTPS webhook/group/direct delivery is unverified. The broadened web/bot implementation shares the same tested assistant, but that is not proof of Telegram delivery. Models remain probabilistic and the reviewed knowledge is not a live crawl. Responses remain safe plain text; occasional Markdown notation from the provider may appear literally.

The lazy handbook route produces Vite's existing 500 kB warning (approximately **508 kB minified / 73 kB gzip**); the build passes and the warning is not suppressed. No hosted deployment, native OS/wallet-client flow or new contract/permission deployment was performed.
