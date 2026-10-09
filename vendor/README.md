# Public SDK packages

These npm archives contain the producer-owned protocol, SDK, generated help,
contract headers and licenses from
[core](https://github.com/Daclify/daclify-backend-core) and
[modules](https://github.com/Daclify/daclify-backend-modules). They contain no API
services, private environment files, provider credentials or contract deployment
keys. The frontend imports their public exports; it does not maintain copied
schemas or edit compiled SDK code.

`package.json` names each archive and `package-lock.json` pins its version and
SHA-512 integrity. Keeping the archives inside this checkout lets `npm ci` work
on Netlify without sibling repositories or private package-registry tokens.
The package regression checks verify integrity, versions, module/core peer
compatibility, permitted archive contents and absence of install hooks.

To refresh the packages, use matching sibling development checkouts and run
`node tools/bootstrap.ts` from core. When contract sources change, use the
documented toolchain and `node tools/bootstrap.ts --contracts`. Both paths copy
the built packages here and refresh frontend dependencies and lock integrity.
Review and commit the two archives, frontend manifest/lockfile and any affected
producer source/lockfiles together. Run frontend verification and a build before
pushing. Do not edit archives by hand.

Current `0.8.0-alpha.1` archives are **unpublished development artifacts**, not a
qualified production release. Their exact bytes are pinned by the frontend Git
commit and lockfile. Registry publication and production release qualification
remain governed by core's release policy; this distribution path bypasses neither.
First-party package contents retain AGPL-3.0-only, with licensing files included
inside each archive.
