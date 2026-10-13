# Testnet portal connection correction

13 October 2026. Frontend deployment configuration correction; no application source, protocol, database or native contract change.

The initial alpha27 static release lacked `VITE_NETWORK` and `VITE_API_TESTNET`. Its compiled network configuration fell back to the local-mode network file. API requests therefore used the portal origin, and the browser displayed “The request could not be completed.” Direct API checks and static page/layout checks had passed, but those checks did not establish a working browser connection.

The existing `npm run test:testnet-public` reproduced the failure at its first Testnet badge assertion. The same clean frontend source (`86412538bf4eb37237bf97bb81c17da2fb28795f`) was rebuilt with:

```sh
VITE_NETWORK=testnet VITE_API_TESTNET=https://testnet.api.daclify.com npm run build -- --mode testnet
```

Vue/TypeScript and Vite build passed. Before publication, the compiled candidate was served to the browser at the portal origin while retaining real live API requests. Eight checks covered `/`, `/hub`, `/account` and `/create` at desktop/mobile widths. They verified successful network and DAO reads, the Testnet lock despite a saved Production preference, reload, loaded DAO data, absent retry/error state, layout and no page exceptions or misplaced API requests.

The corrected entry was published atomically with existing hashed assets preserved. The same eight checks then passed against the actual hosted files. The network unit suite passed all 31 tests. The entry SHA-256 is `04ec5fb82b59cb156f6968a10083d33c69cbeadb7202b6c11c66d5f099e54503`; it supersedes the initial `260cd2503d00cbfa67c0abbc16fe96cec4c647210761936489da6e0fd79d9129` build. Frontend version remains alpha27 because the application source and SDK cohort are unchanged.

The private build/deployment/browser packet is `/data/daclify-runtime/testnet-connection-20261013`. API restart, database changes, chain writes and production deployment were unnecessary. Authenticated provider sign-in and the full public journey suite were not requalified by these connection checks.
