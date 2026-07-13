# Security Policy

## Supported versions

Security fixes are applied to the current development branch and to the latest
maintained stable release when a backport is practical.

| Version | Supported |
| --- | --- |
| `main` | Development fixes |
| Latest tagged release | Yes |
| Older tagged releases | No |

Deployments should pin both application images to the same release and apply
updates promptly. See [the deployment guide](docs/DEPLOYMENT.md) for the
production hardening checklist.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Submit a private
report through [GitHub Security Advisories](https://github.com/Click-Hype/NooviCrew-Excalidash/security/advisories/new).
If private reporting is unavailable, contact the Click-Hype organization
maintainers through GitHub and ask for a confidential reporting channel before
sharing technical details.

Include, when applicable:

- affected version, commit, and deployment mode;
- impact and required privileges;
- minimal reproduction steps or a proof of concept;
- relevant sanitized configuration and logs;
- suggested remediation, if known.

Never include live passwords, API keys, tokens, cookies, private drawings,
database dumps, `.env` files, or customer data. Revoke or rotate any credential
that may have been exposed before sending the report.

The maintainers will acknowledge the report, assess severity and affected
versions, coordinate a fix, and publish an advisory when disclosure is safe.
Timelines depend on severity and reproducibility; reporters will receive status
updates through the private advisory.

## Security-sensitive areas

Changes to authentication, OIDC identity binding, authorization, API keys,
sharing, file storage, Socket.IO collaboration, import/export, or the MCP agent
integration require focused tests and a security review. Production examples
must use placeholders rather than organization-specific endpoints or secrets.
