# Security Policy

## Supported Versions

This project ships from `main`. The latest tagged release on `main` is the supported version. Older tags receive no fixes.

| Version | Supported |
| ------- | --------- |
| latest `vX.Y.Z` | Yes |
| older tags | No |

## Reporting a Vulnerability

If you find a security issue, **do not** open a public GitHub issue. Instead, use one of:

1. GitHub's [private vulnerability reporting](https://github.com/Blackout-Industries/kpod/security/advisories/new) (preferred).
2. Email: `nikolas.lucansky@gmail.com` with subject `[security][kpod] <short summary>`.

Please include:

- Affected version / commit SHA
- Steps to reproduce or PoC
- Impact assessment (what an attacker can do)
- Any suggested fix

## Response Targets

- **Acknowledgement:** within 5 business days.
- **Triage + severity assessment:** within 10 business days.
- **Fix and release:** depends on severity. Critical issues get a patch release out of band; lower-severity issues roll into the next regular release.

After a fix lands, the advisory is published and the reporter is credited unless they ask to stay anonymous.

## Scope

In scope:

- Code in this repository
- Dockerfile and shipped container images
- CI/CD workflows that affect release artifacts

Out of scope:

- Issues only reproducible against forks or modified builds
- DoS via excessive client-side YAML input (this is a browser tool — bring your own resource limits)
- Findings purely about transitive dependencies for which no patched version exists yet (track via Dependabot instead)
