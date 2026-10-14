# Use one wallet across your DAOs

Open **Your account > Access & recovery > Approval setup**. Choose Telos Zero or Telos EVM, connect your paired wallet, and select the DAOs in which you want to use it. The screen shows existing authorizations and wallet replacements before you approve. **Approve selected DAOs** saves the default and enables the selected memberships; your roles and voting power stay the same. Select at most 20 at a time.

If this wallet is not paired yet, pair it on the same screen. When the selected DAOs need your existing account keys, the primary button becomes **Unlock account to continue**. It opens **Account keys and recovery** inside the setup card. Unlock the saved kit, use a paired sign-in with full access enabled, approve this device from an unlocked device, or restore your original encrypted kit. Cancelling or completing kit recovery keeps the DAO selections. After unlocking, choose **Approve selected DAOs** to finish; recovery itself never enables a wallet. Then use **Return to your DAO or setup**.

Pairing alone does not let a wallet unlock your original Daclify keys. If none of your paired sign-ins has full access enabled, setup offers another unlocked device or your encrypted kit. You can enable full access explicitly in Sign-in methods after recovering the keys. Already enabled wallets can approve public actions while those keys remain locked.

The default is remembered for this account, operator and network on this browser. On another browser/device, choose your paired wallet again. A saved preference never grants signing authority. Each action checks the current DAO authorization and asks for the wallet signature.

After creating a DAO, an account with no ready approval method opens this same setup for the new membership. Join instructions and unready action cards lead here too. Already enabled wallets can approve public documents without unlocking Daclify keys. Private content additionally needs your encryption keys and the DAO's permitted access grant.

If a selected approval fails, the screen stops and retains the selected DAOs. Retry checks current state and skips authorizations already confirmed. Cancelling does not revoke completed authorizations or recreate the DAO.

If Anchor's signing preview stays blank or reports **Network Error**, cancel the pending request. On Telos testnet, check **Anchor > Tools > Smart Contracts**, enter `daclifycore1`, and choose **Load Contract**. This reads the contract ABI without signing. If that also fails, check **Manage Blockchains > Telos (Testnet) > gear > Default node for this blockchain**. Record the previous URL before trying `https://testnet.telos.net` or `https://telostestnet.greymass.com`.

After changing the node, fully quit and reopen Anchor before retrying **Load Contract**. Once the contract loads, return to Daclify and start a fresh **Approve selected DAOs** request. Confirm that the selected membership becomes **Already enabled**. A successful connection or contract read alone does not confirm wallet authorization.
