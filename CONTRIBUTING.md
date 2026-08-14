# Contributing to Quecord

Thank you for helping improve Quecord. Bug reports, documentation corrections,
tests, and focused pull requests are welcome.

## Before opening an issue

- Search existing issues to avoid duplicates.
- For usage questions, include the Quecord, Node.js, MongoDB server, and MongoDB
  driver versions involved.
- For bugs, provide a minimal reproduction and describe the expected and actual
  behavior.
- Do not report security vulnerabilities in public issues; follow
  [SECURITY.md](SECURITY.md) instead.

## Development setup

Quecord requires Node.js 20 or newer and uses the pnpm version declared in
`package.json`.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
npm pack --dry-run
```

The repository approves esbuild's install script through `pnpm-workspace.yaml`.
Do not approve additional dependency build scripts without explaining why they
are necessary.

## Pull requests

- Keep each pull request focused on one change.
- Add or update tests for observable behavior changes.
- Update the README and changelog when the public API or behavior changes.
- Preserve ESM, CommonJS, and TypeScript compatibility.
- Use Semantic Versioning when proposing public API changes.
- Make sure all CI jobs pass on the supported Node.js versions.

Quecord promises at-least-once execution. Changes involving claims, leases,
heartbeats, retries, or cancellation should consider stale workers, duplicate
delivery, atomicity, and idempotency explicitly.

## Releases

Maintainers publish through GitHub Releases. Release tags must be signed,
SemVer-compliant, optionally prefixed with `v`, and match the version in
`package.json`. Prereleases publish to npm under `next`; stable releases publish
under `latest`.

By contributing, you agree that your contribution is licensed under the MIT
License used by this repository.
