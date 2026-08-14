# Security Policy

## Supported versions

Until Quecord reaches `1.0.0`, security fixes are provided for the latest
published release. Users should upgrade to the newest available version before
reporting an issue that may already be fixed.

## Reporting a vulnerability

Please do not open a public GitHub issue for a suspected vulnerability. Report
it privately through [GitHub Security Advisories](https://github.com/IamLizu/quecord/security/advisories/new).

Include, when possible:

- A description of the vulnerability and its potential impact.
- A minimal reproduction or proof of concept.
- Affected Quecord, Node.js, MongoDB server, and MongoDB driver versions.
- Any known mitigations or suggested fixes.

You should receive an acknowledgement within seven days. Please allow time to
investigate and prepare a coordinated fix before public disclosure.

## Scope

Security-sensitive areas include atomic claim behavior, lease fencing,
cross-tenant claim filters, unsafe field-path configuration, denial of service,
and the exposure of job data or stored errors. Duplicate delivery by itself is
not a vulnerability: Quecord deliberately provides at-least-once execution, and
consumers must make external side effects idempotent.
