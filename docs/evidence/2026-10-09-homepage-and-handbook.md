# Homepage and grouped handbook

Development work on `dev`, 9 October 2026. No backend schema, dependency, contract or permission changes.

The app root is a branded welcome page with guest/signed-in shortcuts. The directory lives at `/hub`; old root filter bookmarks preserve query and hash when redirected. The brand returns Home. Static Home remains readable when network verification fails, while workspace routes and identity reads keep the fixed-network gate.

The handbook has six task-based groups. Native expandable contents sections and overview guide lists replace the flat menu and full handbook dump. Search opens matching groups; selected guides retain DAO context, version mismatch warnings, permission diagrams and generated references. Mobile overview cards replace the duplicate contents index. All current topics are assigned exactly once; future topics fall back to More guides.

## Verified

- Observed the missing-homepage browser failure and two grouping unit failures plus the absent-group browser failure before implementation.
- Final `npm run verify`: lint, Vue/TypeScript, 162 unit tests across 33 files passed.
- Final `npm run build`: static build passed.
- Homepage, handbook, permission diagram, theme, catalogue navigation, public people, DAO directory and purpose suites: 66 desktop/mobile cases passed. After the final mobile overview adjustment, the 22 handbook/diagram/theme cases passed again.
- Fixed deployment network suite: six desktop/mobile cases passed, including readable Home with wrong-network workspace/identity blocking.
- Selected account-shell and workspace navigation/help cases: six desktop/mobile cases passed. There are 78 distinct browser scenarios across these selections.
- Inspected desktop/mobile homepage and handbook screenshots. Accessibility scans and narrow-viewport overflow checks passed within the selected suites.
- Read-only browser smoke against `http://testnet.localhost:5198` and local API `0.9.0-alpha.5`: Home → Hub with Daclify DAO → handbook search → permission guide passed. API reported testnet and runtime `daclifycore1`.

## Limits

Most presentation scenarios use HTTP fixtures; selected documentation and shell cases read the existing local API. No real provider conversation/login, payment, chain mutation, native OS installation or hosted deployment was performed. Backend/native suites were not rerun for these frontend-only changes. Screenshots and logs remain local artifacts. Model/personality and Status changes requested afterward have their own execution record.
