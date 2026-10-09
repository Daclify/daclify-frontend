# Standalone frontend packages — 9 October 2026

## Scope and result

Netlify cloned only the frontend `dev` branch, then failed during npm installation
because the two SDK dependencies pointed outside that checkout to ignored sibling
`.artifacts` directories. Both producer-owned public npm archives now live in
tracked frontend `vendor/`, and frontend's manifest and lockfile use those local
paths. No schemas or API services were copied into frontend source.

Core's ordinary and `--contracts` bootstrap paths use the same frontend staging
function: copy the public archives, refresh the explicit file dependencies and
lock integrities, then install. The ordinary bootstrap ran successfully. The
contract compilation path was updated to call that function but was not rerun in
this packaging task. No C++ source or generated ABI changed.

| Archive | Bytes | SHA-256 |
| --- | ---: | --- |
| `daclify-core-protocol-0.8.0-alpha.1.tgz` | 326230 | `37c78c5d0c9df8d7599bfe10413455f711f3ceb877acefa64e5cb87d90f7fee6` |
| `daclify-modules-0.8.0-alpha.1.tgz` | 166214 | `1bfd968a41d26394168705eea7fe0a2d34f6e3c28986c4fd9f1116f421fe5867` |

`package-lock.json` pins npm's SHA-512 integrity as well. These are unpublished
development packages, not qualified registry or production releases. The module
archive was regenerated from current source, including its current README; the
backend core's consuming lock integrity was refreshed accordingly.

## Verification actually run

- Before fixing dependencies, the new package regression failed for both old
  sibling paths. The passing regression now checks checkout-local paths, archive
  bytes against lock integrity, names/versions against installed SDK versions,
  permitted public archive entries, AGPL licensing, exact module/core peer
  compatibility and absence of install hooks/runtime file dependencies.
- `node tools/bootstrap.ts`: passed; both frontend archives staged, manifests and
  locks refreshed, all three repositories installed. Archive inspection found
  regular files only, with no private environment files or service directories.
- Frontend `npm run verify`: passed, **151 tests / 31 files**, lint and Vue template
  typechecking. Deployment environment values exposed 13 inherited-environment
  failures in the existing network fixture; clearing its four public env inputs
  before each test fixed that isolation issue. The targeted network/package run
  passed with testnet deployment env values set.
- Fresh standalone frontend copy: included only Git-tracked/nonignored source
  and the new package files, with no backend siblings, installed dependencies,
  build output or private environment files. Used an empty npm cache and empty
  npm user configuration, with registry/auth token env inputs removed.
  `npm ci --no-audit --no-fund`, Netlify-style `npm install --no-audit --no-fund`,
  `npm run verify` and `npm run build -- --mode testnet` all exited zero with
  `VITE_NETWORK=testnet` and `VITE_API_TESTNET=https://testnet.api.daclify.com`.
  The lockfile remained byte-identical and `dist/_redirects` was present.
- Frontend default `npm run build` and `npm run format:check`: passed.
- Core `npm run verify`: passed, **558 tests / 97 files**, lint, TypeScript and
  generated documentation checks. Its manifest still correctly reported
  `publication: refused`, `qualified: false`. Core `npm run build` and targeted
  formatting for `tools/bootstrap.ts`: passed.
- Modules `npm run verify`: passed, **144 tests / 27 files**, lint, TypeScript and
  generated documentation checks; `npm run build` ran through bootstrap.

Core's full `npm run format:check` still reports seven pre-existing files:
six resource/native evidence JSON files and `tests/native/archive-preview.test.ts`.
Those files were not changed by this task. Fresh standalone verification was on
macOS with Node 24.21.0/npm 11.19.0, not a hosted Netlify Linux runner.

## Deployment and remaining limits

Follow [the Netlify dev guide](../netlify-dev.md): dedicated testnet project,
production branch `dev`, root base directory, build command
`npm run build -- --mode testnet`, publish directory `dist`, and the two public
testnet build env values above. GitHub Actions remain manual-only. Registry
publication, hosted Netlify execution, provider callbacks and live API/chain
qualification were not performed. Private backend env files were untouched.
