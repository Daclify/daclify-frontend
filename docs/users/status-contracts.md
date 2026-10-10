# Exploring contract authorities

Open **Status → Contracts**, or use **Explore contract map** in Overview. The checked timestamp applies to the platform snapshot, including release hashes and public permissions.

Contract cards show the account, module, artifact verification and resource use. Browse the cards with the arrow controls, horizontal scrolling, touch or keyboard. Open a card to reveal its permission summary and select it in the map; **Show resources** returns to the front.

In the map, contributors appear on the left and the selected account's permissions on the right. Select a permission to see its threshold and contributor weights. Select a public key to see every returned permission listing that key, including permissions on other contracts. Select a delegated permission to see where it contributes weight. Connected cards are highlighted. Select an observed connection to inspect its contract.

`owner` is the root; `active` normally has `owner` as its parent. Each permission has its own authority definition. A parent may satisfy a child's minimum permission; an active signer does not gain owner authority through that hierarchy. A shared key can separately contribute to both authorities, but their thresholds still apply. `eosio.code` represents authorization contributed by deployed contract execution. Delay entries contribute weight after the stated transaction delay.

The explorer shows observed relationships. External delegated account authorities may not be expanded, action links are not included in the platform snapshot, and contracts may impose additional checks. A release hash match identifies an artifact; it does not certify its safety. Use the bundled **Permission guide** for worked governance and module examples.

Use zoom and scrolling to explore the map, or **List** for a compact reading layout. Map nodes, list contributors, cards and inspector connections are keyboard buttons. Full keys, hashes and the original authority records remain available in the inspector.

RAM and NET are bytes; CPU is microseconds. These are contract-account totals, shared by hosted DAOs, rather than per-DAO charges or transaction estimates. The CPU/NET meters show reported used capacity; resource limits can change. Unlimited, unknown, zero capacity and over-capacity are labelled explicitly.

Resource readings are separate public RPC reads. The app first checks the RPC chain ID and rejects account-name mismatches. A failed resource read leaves permission data available, labels CPU/NET unavailable and retains RAM from the marked platform snapshot. **Refresh resources** retries those reads; **Refresh status** refreshes platform permissions and resources. Refresh preserves the selected contract and disclosures where available. Changing deployment clears old data, and late responses are discarded.

The explorer reads public metadata. It cannot change authorities or sign a transaction.
