# Exploring contract accounts

Open **Status → Contracts**, or use **Explore contract map** in Overview. The checked timestamp applies to the platform snapshot, including release hashes and public permissions.

The contract diagram shows account names. Click a name, or focus it and press Enter, to switch **Contract Account Details** below it. That panel contains the selected account's RAM, CPU and NET, its permission tree and its release details.

Solid amber arrows point from an account delegating authority to the contract account whose permission it uses. Dashed green arrows point from an account permission to another contract whose actions are linked to that permission. These are reported permission relationships; they do not establish that a contract has called another contract. Hover or focus a contract for the specific permission/action descriptions. Accounts without a reported connection remain visible without invented lines.

The permission tree nests each child beneath its actual parent. Each row shows the permission name, a threshold badge and its contributors with +weight labels. Full public keys stay visible inside their permission rows; the same key can appear in both owner and active. Selecting a permission highlights its contributors. Selecting a public key highlights every permission listing it and the corresponding names in the contract diagram. The connection details below the tree let you inspect a matching permission on another account. Selecting a delegated permission lets you follow its definition when that contract and permission were returned.

`owner` is the root; `active` normally has `owner` as its parent. Each permission has its own authority definition. A parent may satisfy a child's minimum permission; an active signer does not gain owner authority through that hierarchy. A shared key can separately contribute to both authorities, but their thresholds still apply. `eosio.code` represents authorization contributed by deployed contract execution. Delay entries contribute weight after the stated transaction delay.

External delegated account authorities may not be expanded, and contracts may impose additional checks. Linked-action chips such as `eosio::claimrewards` appear when the public RPC reports them and its parent and authority match the status permission. `contract::*` represents a reported wildcard link. Up to three action chips are visible; use **more actions** to expand longer lists with touch or keyboard. These links come from the separately checked account reading; absent chips or lines do not establish that no action links exist. A release hash match identifies an artifact; it does not certify its safety. Use the bundled **Permission guide** for worked governance and module examples.

The tree is the single authority view. **Clear selection** resets signer and permission highlights. Contract names, permissions, contributors and observed connections are keyboard buttons. Rows adapt to narrow screens and enlarged text. Open **Release details** for full code hashes and release pins.

RAM and NET are bytes; CPU is microseconds. These are contract-account totals, shared by hosted DAOs, rather than per-DAO charges or transaction estimates. The CPU/NET meters show reported used capacity; resource limits can change. Unlimited, unknown, zero capacity and over-capacity are labelled explicitly.

Resource readings are separate public RPC reads. The app first checks the RPC chain ID and rejects account-name mismatches. A failed resource read leaves permission data available, labels CPU/NET unavailable and retains RAM from the marked platform snapshot. **Refresh resources** retries those reads; **Refresh status** refreshes platform permissions and resources. Refresh preserves the selected contract and release disclosure where available. Changing deployment clears old data, and late responses are discarded.

The explorer reads public metadata. It cannot change authorities or sign a transaction.
