# Contract account resources

Add a Resources button beside Permission guide in Status → Contracts. It opens a modal card in the existing visual style. The user approved a RAM slider where 100% is the account's current capacity and 200% doubles it. Implementation continues inline under the workspace's standing authorization; no live purchases or deployment are authorized.

The card has RAM, CPU and NET views, aggregate contract-account readings and a row for every configured contract or service account. Each row shows used and free percentages, used/capacity amounts and an estimated value. Totals include contract accounts; known zero-code service accounts remain selectable and are identified separately. Missing reads cannot become zero usage or a complete total. Unlimited and zero capacities are explicit.

RAM value means the current estimated replacement cost of occupied bytes, including the system fee, rather than historical purchase spend or immediately sellable RAM. Use the public core protocol's existing `ramMarketCost` and integer token units. Dollar conversion uses fresh published Names or core rates, with the existing 900-second freshness limit. Testnet dollars are mainnet-price references; testnet tokens have no cash value. CPU/NET dollar figures value their TLOS stake, not processing time or bytes.

The selected Anchor session is the payer. Show its account, native balance, recipient, expected increase and fixed TLOS spend before asking Anchor to sign. A change-payer control opens the existing Anchor selection. Selecting a resource, account or amount invalidates a prepared purchase.

For RAM, the 100–200% slider previews a target quota and additional bytes. Prepare `eosio::buyram` with a fixed token quantity, never an unbounded `buyrambytes` debit. Actual acquired bytes depend on the market at execution; the slider previews an estimate. Sponsorship goes directly to the account and creates no DAO RAM credit or governance authority.

CPU/NET use `eosio::delegatebw`. Their 100–200% sliders increase the current TLOS stake, with a positive amount input for a known zero stake. Network conditions determine available capacity. Use `transfer=false`, preserving ownership of the delegated stake with the payer. No unstaking or RAM sales are added.

Use the existing WharfKit/Anchor integration with unchanged-action verification and explicit wallet approval. Validate the live external system ABI's action layouts, freeze its code/ABI hashes for the prepared purchase and recheck them, the chain, wallet, recipient, amount, balance and quote lifetime before broadcast. Closing the card, switching tabs/accounts/network or cancelling invalidates an outstanding signing request. Report uncertain broadcast results with the transaction ID and never retry automatically.

Reuse the explorer's live account reads and refresh path. Fetch market/ABI/rate only while the card is open; ignore aborted or superseded requests. Use a native dialog for keyboard focus, Escape and focus restoration. The card must fit mobile screens and pass accessibility checks.

No contract, backend API, package, release pin or dependency changes are required. External system ABI decoding is a frontend boundary adapter; Daclify models and RAM pricing come from the pinned public protocol.
