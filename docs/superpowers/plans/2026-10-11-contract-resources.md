# Contract resources implementation plan

> **For agentic workers:** Use superpowers:executing-plans inline. No sub-agent delegation is authorized. Track results here and in docs/evidence/2026-10-11-contract-resources.json.

**Goal:** Inspect aggregate and individual contract resources and prepare bounded Anchor RAM purchases and CPU/NET delegations from a selected wallet.

**Architecture:** A focused resource helper validates external chain reads, computes integer amounts and prepares system actions. A modal Vue component consumes existing explorer readings and the existing Anchor signing flow. No backend interface or contract changes.

**Tech Stack:** Existing Vue 3, TypeScript, Zod, WharfKit, Vitest and Playwright.

**Spec:** ../specs/2026-10-11-contract-resources-design.md

## Global constraints

- Preserve unrelated dirty files; work and commit on dev. No live transaction or deployment.
- RAM 100% = current quota; 200% = double. CPU/NET percentages scale stake rather than promise capacity.
- Money uses integer units. RAM spend is fixed; delegation uses transfer=false.
- USD requires a positive rate observed no more than 900 seconds ago. Quote lifetime is 60 seconds.
- Use pinned public Daclify schemas/pricing and the existing Anchor session. No new dependency.

## Review focus

- Missing/unlimited accounts cannot create misleading aggregate totals or usable purchase amounts.
- Rate expiry, malformed market reserves and unsupported external ABIs must remain visible and disable unavailable estimates/actions.
- Wallet/context changes during signing or the final RPC check must prevent broadcast.
- Insufficient balance and uncertain submission must not cause automatic retries or an apparent confirmed purchase.
- Mobile layout, Escape/focus restoration and screen-reader labels must work throughout the card.

### Task 1: Resource math and external system boundary

**Files:** Create src/content/contract-resources.ts and tests/unit/contract-resources.test.ts.

**Interfaces:** `capacityIncrease(capacity: bigint, percent: number): bigint`; `resourceTotal(contracts, readings, kind)`; `readResourceMarket(client)`; `resourceUsd(units, rate, now)`; `resourceSystemAction(purchase, identity, abi): Action`.

- [x] Write tests for 100/125/200%, rounding and large integer quotas, invalid percentages, partial totals, zero-code exclusions, stale/future rates, exact fixed-debit RAM data and payer-owned CPU/NET stakes.
- [x] Run `npm test -- tests/unit/contract-resources.test.ts`; observe missing behavior, then implement helpers and rerun to pass.
- [x] Reject malformed reserves and incompatible system action fields. Test the real encoded/decoded action payloads.

### Task 2: Wallet resource execution

**Files:** Modify src/auth/telos-zero.ts and tests/unit/native-wallet.test.ts.

**Interfaces:** `nativeResourcePurchase(purchase, checkContext): Promise<string>`; signing context checks may be asynchronous.

- [x] Add failing tests for bounded system actions, insufficient balance, changed chain/system hashes, wallet/account changes during signing and changes during final checks.
- [x] Implement the existing signing path's asynchronous checks and the resource purchase's final validation, explicit broadcast and receipt confirmation.
- [x] Run `npm test -- tests/unit/native-wallet.test.ts tests/unit/contract-resources.test.ts`; expect accepted signed payloads and zero broadcast for rejected contexts.

### Task 3: Modal card and complete browser journey

**Files:** Create src/components/ContractResources.vue and tests/e2e/contract-resources.spec.ts. Modify src/components/ContractExplorer.vue, docs/users/status-contracts.md and docs/releases/requirements.json. Add docs/evidence/2026-10-11-contract-resources.json.

**Interfaces:** Consume chain, readings, failures, busy, checkedAt and active from the explorer; emit refresh. Consume Task 1 helpers and Task 2 wallet execution.

- [x] Write and run failing browser tests for the Resources button/modal, totals and partial reads, slider preview, CPU/NET semantics, wallet controls, modal cancellation, mobile layout and accessibility.
- [x] Implement the card, market/rate freshness, previews and prepared transaction controls; wire its parent refresh and context cancellation.
- [x] Update the user guide and requirement register. Review the final diff inline and record limitations.
- [x] Run `npm run verify`, `npm run build`, formatting checks for changed files and the affected status/resource browser suites on desktop and mobile.
- [x] Commit only this feature's files and push dev. Record checks and commits; leave live wallet/provider signing unverified if no real signing is performed.

## Execution ledger

Implemented inline on `dev`, preserving unrelated work. The standing continuous-session authorization and the user's explicit slider reply permit implementation without another design approval. Workspace instructions prohibit delegated review; the transaction path, helper, callers, tests and final layout were reviewed inline.

- Resource math and action tests first failed with the missing helper and wallet entry point; those behaviors now pass. Follow-up regressions caught RAM-market failure disabling independent CPU/NET staking, uncertain-submission acknowledgement retaining old capacity, and an ABI-only system account being accepted without deployed code. All three were corrected and verified.
- The pinned core public schema, integer RAM pricing helper and existing Anchor session remain authoritative inputs. No new dependency, contract, backend interface or release pin is needed.
- Browser transactions use a disposable signing fixture and simulated RPC receipts. The fixture decodes both uncompressed and WharfKit's default zlib-compressed transactions and checks the actual binary action data. These checks do not establish live Anchor integration or native chain execution.
- The purchase panel sits beside account readings on desktop and comes first on mobile; its recipient selector keeps all accounts accessible without scrolling past the list. Native modal focus, Escape, screen-reader labels, accessibility and mobile overflow were checked.
- Final `npm run verify` passed: lint policy, Vue/TypeScript checks and 264 unit tests in 40 files. The production build passed with the existing large-chunk warning. The final resource browser run passed all 20 cases across desktop/mobile; an earlier combined run passed another 48 existing Status cases.
- A read-only live testnet smoke showed 17,170,373 used bytes across eight contract accounts, 19,794,833 allocated bytes and a $17.42 replacement-cost reference (983.6635 testnet TLOS). Two zero-code service accounts were listed separately. No mutation, wallet connection or signed transaction occurred. A local pass-through added localhost CORS response headers to real GET responses; deployment-origin CORS was not verified.
- Evidence, log hashes, source hashes and screenshots are recorded in `docs/evidence/2026-10-11-contract-resources.json`. The delivery commit includes this ledger and is identifiable with `git log -- docs/evidence/2026-10-11-contract-resources.json`; its hash is not embedded in its own contents.

Live Anchor approval, asset purchases and deployment remain unrun. CPU/NET limits remain dependent on network conditions; the sliders scale TLOS stake.
