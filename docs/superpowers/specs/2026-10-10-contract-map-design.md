# Status contract map

The user wants Status and Contracts to explain relationships visually, especially how owner and active keys relate, and to display RAM, CPU and NET. Contract cards should reveal a second face when opened. The supplied UI/UX brief and repository instructions authorize implementation inline with review afterward.

## Experience

- Keep the Status route and six existing sections. Make Contracts a focused explorer, with a compact explanation and link to the existing permission guide.
- A scrollable row of contract cards shows account/module, release verification, RAM, CPU and NET. Arrow buttons, touch, horizontal scrolling and keyboard access keep larger deployments browsable without pushing the map far down the page. Clicking a card reveals its authority summary and selects it in the map. A visible button returns to the resource face. Selected contracts remain selected during refresh when still present.
- The map has two lanes: public keys/delegated account permissions/delays, and the selected contract's permissions. Solid hierarchy arrows point from parent to child; weighted authority arrows point from each signer to the permission it contributes to. `eosio.code` is distinctly labelled as code authority.
- Selecting a permission highlights its contributors and parent relationship. Selecting an authority highlights every permission in that contract using it and lists other observed contracts using the same key or delegated permission. Direct delegations to the selected contract are also discoverable. These are observed permission relationships, not inferred contract calls or proof of effective control.
- Explain that owner is the root, active is its child, each has its own authority, a parent may satisfy a child's minimum permission, and a child does not inherit its parent's authority. Shared public keys are one signer appearing in multiple authorities. Show thresholds and weights without claiming that any one signer meets a multisignature threshold. Contract code may impose additional checks.
- Zoom controls and a scrollable map support exploration; a readable list view provides the same selection and relationship details on narrow screens and with enlarged text. Every node is a native keyboard button. Motion is brief and respects reduced-motion preferences.
- Keep full code hashes, release pins, public authorities and RAM diagnostics available in the selected contract inspector. Keep unknown, failed, mismatched and unavailable states explicit.

## Data and boundaries

Consume the pinned canonical `PlatformStatus` for contracts, permissions and release checks. Use the already installed WharfKit `APIClient` and its typed account responses for live CPU/NET/RAM. Verify the RPC chain ID before reading accounts. Fetch resource data only while Contracts is first opened or an opened explorer receives refreshed status. Abort and discard stale requests on status/deployment changes and unmount.

Resource values preserve 64-bit precision using bigint. CPU is measured in microseconds; NET and RAM in bytes. Unlimited (`-1`), unknown, zero capacity and over-capacity have distinct labels and valid meters. Resource readings have their own checked timestamp and failure/retry feedback; they are later reads than the platform permission snapshot. Failed resource reads do not hide the map or imply zero usage.

No permission edits, signing, new dependency, copied backend model, account mutation, production release or authority handover belongs to this task. No resource request should transmit credentials. A missing external delegated account remains labelled as an unexpanded authority.

## Implementation choices

These are builder choices: retain Vue/TypeScript and existing tokens, implement a deterministic two-lane graph with HTML buttons and SVG edges, keep contract relationships in the inspector rather than cramming all accounts into one graph, and use a face switch rather than a prolonged 3D animation. No graph dependency is needed.

## Acceptance

Browser regressions cover card face switching, owner/active hierarchy, weighted contributors, shared keys, cross-account delegation, code authority, failed/mismatched resources, retry, network changes, exact large integers, unlimited and zero capacity, keyboard selection, mobile/enlarged text and Axe. Existing Status refresh and diagnostics remain passing. Run lint, Vue/TypeScript checks, unit suite and build; inspect actual rendered map screenshots.

Primary references: [Antelope accounts and permissions](https://docs.antelope.io/docs/latest/protocol/accounts_and_permissions/), [WharfKit APIClient](https://wharfkit.com/docs/antelope/api-client), installed WharfKit source, canonical platform schema and bundled contract-permissions guide.
