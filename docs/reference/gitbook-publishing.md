# GitBook publishing

These docs are structured as GitBook-ready Markdown. `SUMMARY.md` defines the navigation
tree and each page is a standalone Markdown file under `docs/`.

There are two supported ways to publish: **Git Sync** (recommended for an ongoing docs site)
and the **GitBook MCP server** (for authoring and syncing from a development environment).
Both are described below, followed by the token-handling rules that keep either path safe.

## Local source

```text
docs/
  README.md      Space landing page
  SUMMARY.md     Navigation tree
  <section>/     One folder per top-level section
```

Keep `SUMMARY.md` in sync with the file tree. GitBook uses it as the authoritative
navigation source on import and sync.

## Option 1: Git Sync (recommended)

1. Create or open the Veilpay GitBook organization.
2. Create a docs space.
3. Connect the GitHub repository through GitBook's GitHub integration (installed as a
   GitHub App, not a personal token committed anywhere).
4. Set the docs root to `docs/`.
5. Select `SUMMARY.md` as the navigation source.
6. Review the sync preview and publish.

Git Sync is bidirectional and does not require storing a GitBook API token in this repo —
authorization is held by the GitHub App installation on the GitBook side.

## Option 2: GitBook MCP server

The GitBook MCP endpoint is:

```text
https://mcp.gitbook.com/mcp
```

Registered in this repo's MCP config as `gitbook` (HTTP transport). MCP tools load after the
client is restarted with the server enabled.

1. Restart the client so the `gitbook` MCP server is loaded.
2. Complete the interactive OAuth authorization when prompted. The MCP flow authenticates
   through your GitBook account in the browser — **no long-lived token is written to the repo
   or to config.** This is the preferred credential path.
3. Select the target organization and space.
4. Sync pages from the local `docs/` tree.
5. Review the generated navigation and publish.

## Safe API-token handling

Some automation (for example a CI publish step or a direct REST call to
`https://api.gitbook.com/v1`) uses a GitBook **personal access token** with Bearer auth:

```bash
curl -H "Authorization: Bearer $GITBOOK_API_TOKEN" https://api.gitbook.com/v1/user
```

A GitBook token carries **the same privileges as the account that created it** — GitBook does
not offer fine-grained per-space scopes. Treat it as a full-access secret, on the same footing
as the backend secrets in [Secrets and keys](../security/secrets-and-keys.md).

Rules:

- **Never commit the token.** Not in Markdown, not in `SUMMARY.md`, not in scripts, not in
  MCP config, not in `.env` files that are tracked.
- **Never put it in client-side code** or any `EXPO_PUBLIC_*` variable — those are bundled into
  the mobile app and are effectively public.
- **Store it as an environment variable** named `GITBOOK_API_TOKEN`, sourced from a secret
  manager (Doppler, as used elsewhere in this project) or the CI provider's encrypted secrets.
- **Prefer the MCP OAuth flow or Git Sync** over a stored token wherever possible; only mint a
  personal access token when a non-interactive script genuinely needs one.
- **Scope by account.** If token-based automation is required, create it under a dedicated
  service account with access to only the Veilpay docs organization, not a personal admin
  account.
- **Rotate on a schedule and revoke on exposure.** Personal access tokens are managed in
  GitBook Developer settings; if a token ever lands in a commit, a log, or a public page,
  revoke it immediately and rotate — do not just delete the leak.

## Pre-publish safety checklist

Before publishing to a public space, confirm the diff contains none of the following:

- [ ] Private keys, mnemonics, or raw signatures.
- [ ] Real API keys, JWT secrets, or provider credentials.
- [ ] A GitBook API token or any other access token.
- [ ] Internal-only hostnames, or real production endpoints that should stay private.
- [ ] Claims that testnet, gated, or planned features are production-live.

Examples in these docs use representative placeholders and must be adapted before production
use. When in doubt, publish to a private draft space first and review the rendered pages.
