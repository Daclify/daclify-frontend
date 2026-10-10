# Frontend audit — 2026-10-10

The [complete cross-repository report](https://github.com/Daclify/daclify-backend-core/blob/dev/docs/evidence/2026-10-10-three-repository-audit.md) contains findings and the login finding and its subsequent approved fix.

Reviewed workspace refresh/account guards, vault/private-content context, sign-in/pairing controls, member/profile presentation, module/fee screens, handbook/help and deployment tooling. The frontend continues to consume canonical core/module schemas and to rely on backend/contract authorization.

Reproduced and fixed empty workspace rendering for unknown URLs. The lazy recovery page reuses existing styles and provides Home/Hub navigation. Its desktop/mobile browser regression checks semantics, accessibility, overflow and successful navigation; both screenshots were inspected.

Removed obsolete manual workflow private-token/sibling/Docker rebuild steps. Verification installs the committed vendored SDK archives with `npm ci --ignore-scripts`. Remains manual-only; pushes do not start GitHub CI. Frontend/module SDK alpha.7 consume unchanged core alpha.6 and module contracts alpha.5. Removed the unreferenced module alpha.6 archive; installed archive integrity/peer checks pass.

Verified: `npm run verify` (33 files / 163 tests and Vue template checks), `npm run format:check`, `npm run build`; 20 desktop/mobile Playwright checks across recovery, homepage, Status and safe Daxi rendering; fresh standalone install/verification/testnet build without backend checkouts or a package token. Dependency audit reported zero advisories. Existing test formatting was corrected without changing behavior.

Remaining: lazy Docs/reference chunk warning, roughly 508 KB minified / 73 KB gzip. No threshold suppression or speculative chunk framework was added. Browser provider responses were fixtures; no live wallet/social/payment or actual Netlify/GitHub deployment was qualified. First-login identity binding was subsequently approved and implemented; see [the v3 follow-up](2026-10-10-login-key-binding.md). The results above describe the original audit checkpoint.
