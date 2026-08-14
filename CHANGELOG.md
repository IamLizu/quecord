# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-08-14

### Changed

- Promoted `0.1.0-beta.0` to the first stable release after successful validation
  in a production consumer.
- No public API or behavior changes were made between the beta and stable release.

## [0.1.0-beta.0] - 2026-08-14

### Added

- MongoDB-native durable work queues that claim existing domain records in place.
- Atomic claims with lease-owner and fencing-token protection.
- Configurable concurrency, polling, lease duration, claim filters, field paths,
  state values, and claim ordering.
- Explicit completion, failure, retry, deferral, and heartbeat controls.
- Automatic retries with exponential backoff and jitter.
- Optional expired-lease reclamation and application-managed cancellation.
- Graceful worker shutdown that drains active handlers.
- Recommended MongoDB claim-index definitions.
- ESM and CommonJS entry points with bundled TypeScript declarations.
- Support for Node.js 20, 22, and 24 and MongoDB driver 6 and 7.

[Unreleased]: https://github.com/IamLizu/quecord/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/IamLizu/quecord/compare/v0.1.0-beta.0...v0.1.0
[0.1.0-beta.0]: https://github.com/IamLizu/quecord/releases/tag/v0.1.0-beta.0
