# Status contract map

The user wants Status and Contracts to explain account relationships visually, especially how owner and active keys relate, and to display RAM, CPU and NET. Their latest correction replaces reversible cards with a diagram showing only contract names. Selecting a name switches one **Contract Account Details** panel containing resources and the permission tree. The tree has no list alternative or duplicate public-authority disclosure. The supplied UI/UX brief and repository instructions authorize implementation inline with review afterward.

## Experience

- Keep the Status route and six existing sections. Contracts contains a connection diagram above the selected account details and a link to the existing permission guide.
- Each diagram node is a native button showing only its contract account name. Directed solid amber lines represent reported cross-contract permission delegation; dashed green lines represent reported linked actions. Multiple action links between the same accounts share one line. Do not infer calls or all-pairs dependencies from a shared public key. Preserve separate accounts with no reported link. Selecting a name switches the detail panel and clears the previous authority selection; selection survives status refresh when the account remains available.
- **Contract Account Details** includes the selected account's name/module, release match, exact RAM/CPU/NET readings, permission tree and a release hash disclosure. Move resources out of the selector. Remove the blank Follow the authority panel, repeated contributor definitions and Public permission authorities disclosure.
- The user's screenshot establishes a nested permission tree. Owner appears above active; custom permissions appear beneath their actual parents with connecting lines. Each row contains its threshold badge and all public keys/delegated permissions/delays with inline weights. Keys repeat within each authority that lists them; selection still shares one contributor identity. Label `eosio.code` as code authority. Reported action chips sit beside contributors when space permits. Show three chips initially, with a native keyboard disclosure and bounded scrolling for longer lists.
- Selecting a permission highlights its contributors. Selecting an authority highlights every matching permission and contract name and exposes only useful observed connections beneath the tree. A delegated permission can be followed to its returned definition. The tree remains the sole authority definition; connection details do not repeat its keys or threshold lists.
- Explain that owner is the root, active is its child, each has its own authority, a parent may satisfy a child's minimum permission, and a child does not gain its parent's authority. Shared public keys are one signer appearing in multiple authorities; multisignature thresholds and contract checks still apply.
- Native buttons, visible focus and 44px targets support keyboard navigation. Responsive diagram nodes and tree rows wrap at narrow widths and with enlarged text. Clear selection resets highlights. Keep unknown, failed, mismatched and unavailable states explicit.

## Data and boundaries

Consume the pinned canonical `PlatformStatus` for contracts, permissions and release checks. Use the installed WharfKit `APIClient` and typed account responses for live CPU/NET/RAM and optional action links. Verify the RPC chain ID and returned account name. Fetch while Contracts is open; abort and discard stale requests on status/deployment changes and unmount. Requests carry no credentials.

Resource values preserve 64-bit precision using bigint. CPU is microseconds; NET and RAM are bytes. Unlimited (`-1`), unknown, zero capacity and over-capacity have distinct labels and valid meters. Resource readings have their own timestamp/failure/retry feedback and may be later than the permission snapshot. Action links appear only when permission name, parent and full authority match that snapshot. Missing/mismatched readings must never imply a link or the absence of links. Failed reads do not hide the tree or imply zero use.

No permission edits, signing, dependency additions, copied backend models, production release or authority handover belong to this task. A missing external delegated account remains unexpanded.

## Implementation choices

Builder choices: retain Vue/TypeScript and existing tokens; render the contract diagram with responsive HTML buttons and measured SVG arrows; arrange accounts around the configured runtime using reported connections. Use semantic nested lists for the screenshot's permission hierarchy. Keep selection and RPC lifecycle in the explorer. No graph dependency is needed.

## Acceptance

Browser regressions cover name-only diagram selection, resources and tree in one selected account panel, both connection kinds, owner/active hierarchy, weights, shared-key highlighting, delegated definition navigation, matched action links, failures/mismatches/retry, stale responses, exact large integers, unlimited/zero capacity, keyboard/mobile/enlarged text and Axe. Existing Status tabs and diagnostics remain passing. Run lint, formatting, full units, Vue/type checks and build; inspect actual ten-contract testnet screenshots.

Primary references: [Antelope accounts and permissions](https://docs.antelope.io/docs/latest/protocol/accounts_and_permissions/), [WharfKit APIClient](https://wharfkit.com/docs/antelope/api-client), installed WharfKit source, canonical platform schema and bundled contract-permissions guide.
