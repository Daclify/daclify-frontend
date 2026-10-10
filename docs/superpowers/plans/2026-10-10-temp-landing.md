# Temporary production landing page

Goal: On the requested `temp-landing` branch, present Daclify's future production app and send visitors to `https://testnet.app.daclify.com` while production is coming soon.

Design: Reuse Daclify's espresso/ivory/amber tokens, bundled Inter, Lucide icons, brand and shared button styles. A full-width header leads into a two-column hero with a clearly labelled illustrative workspace, three product capabilities, a production status section, native FAQ disclosures and a footer. Mobile stacks the content. Do not invent launch dates, usage metrics or testimonials.

Architecture: Mount a standalone Vue landing view from `src/main.ts` on this temporary branch. Keep application source intact for the normal `dev` app. This page needs no router, accounts, network configuration, API calls or database. Existing hosting fallback serves the landing for old app paths as well. Do not offer installation of the placeholder as a PWA.

Scope: `src/main.ts`, `src/views/Landing.vue`, `index.html`, the landing browser test, requirement register and package command, README/changelog instructions and this evidence ledger. Dependencies, backend, application views, global tokens, hosting and production deployment are outside the change.

- [x] Inspect the repository and create `temp-landing` from clean `dev`.
- [x] Add and run a failing browser test for launch status and testnet links (expected landing title; received the original DAO workspace title).
- [x] Implement the landing and metadata; document its preview and build commands.
- [x] Verify production build, unit/lint checks, desktop/mobile browser behavior and accessibility.
- [x] Inspect the final diff and open a running local preview for user review.

This branch is a temporary alternative entry point, not a change to the real application's route behavior. Use the landing-specific browser suite; the preserved application browser suites target the real app on `dev`. No deployment or merge into `dev` is part of this task.

## Verification evidence (2026-10-10)

Final checks used the installed supported toolchain, Node **24.21.0** and npm **11.19.0**.

- `npm run build`: passed, including Vue template/TypeScript checking and the production Vite bundle.
- `npm run lint`: passed, 5 tests including the updated requirement register.
- `npm test`: passed, **168 tests in 33 files**. The final follow-up changed only scoped presentation CSS and the browser alignment check; no unit-tested application logic changed.
- `npm run test:e2e:landing`: passed, **6 tests** against the built production page served by `npx vite preview --host 127.0.0.1 --port 5178 --strictPort` (the existing Playwright configuration reuses this server).
- Desktop and mobile Chromium: launch notice, HTTPS testnet app links, no `/v1` requests with the API blocked, illustrative preview label, anchor navigation, keyboard skip link, native FAQ disclosure, axe scan with zero violations, 320px overflow and header/content alignment, and old app/callback URLs presenting the placeholder.
- Visual review caught inherited dashboard padding on `main`. A regression check failed at header x=60/content x=82 before the scoped override and passed afterward on desktop/mobile and at 320px.
- Changed HTML/TypeScript/Vue/JSON files passed targeted Prettier checks. `git diff --check` passed.
- Local preview returned HTTP 200 and was opened in Chrome. The testnet destination returned HTTP 200 to a HEAD request; that does not verify live app workflows.

Preview: **http://127.0.0.1:5178/**. The verified production preview is left running for user review. Recreate it with the Vite preview command above after building, or use `npm run dev` for edits. Screenshots are in ignored `.artifacts/landing-desktop.png` and `.artifacts/landing-mobile.png`.

Not performed: production deployment, remote branch push, Safari/Firefox checks, real device testing, full application browser suites or live authentication/governance/payment workflows. This branch must be deployed only as the production placeholder, never over the testnet app it links to.
