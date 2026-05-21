# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in `@scriptivox/mcp-server`, please
**do not open a public GitHub issue**. Instead, report it privately so we can
investigate and ship a fix before the issue becomes widely known.

**Preferred contact:** open a GitHub Security Advisory at
<https://github.com/SparkleOfficial/scriptivox-mcp-server/security/advisories/new>

**Alternative:** email <sparkleofficialmain@gmail.com> with the subject
`scriptivox-mcp-server security advisory` and a description of the issue.

## What to include

- A clear description of the vulnerability and its impact.
- Steps to reproduce, ideally with a minimal proof of concept.
- The version of `@scriptivox/mcp-server` you tested against.
- Whether the issue is exploitable through the MCP client, the API call layer,
  or both.

## What to expect

- Acknowledgement within 3 business days.
- An initial assessment (confirmed / not reproducible / out of scope) within
  7 business days.
- A coordinated disclosure timeline if the report is confirmed.

## Scope

In scope:

- Code published in this repository (the MCP server itself).
- Configuration that ships in the published Docker image and npm package.

Out of scope:

- The upstream Scriptivox API itself (api.scriptivox.com) — please report
  those at <https://www.scriptivox.com/contact>.
- Issues that require the user to deliberately misconfigure their API key.
- Denial-of-service via unbounded transcription submissions (the API itself
  is the cost gate).
