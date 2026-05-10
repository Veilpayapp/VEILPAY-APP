# VeilPay Agent Guidance

This repo already includes the Antigravity skills pack under `packages/antigravity-utils/skills/`.
Use the local skills there as the source of truth instead of duplicating them into the app.

## Graphify

Read [GRAPHIFY.md](GRAPHIFY.md) before answering architecture or codebase questions.
Prefer `graphify-out/GRAPH_REPORT.md` and `graphify-out/graph.json` over raw search when they exist.
Use `graphify-out/wiki/index.md` for deeper questions.
If the graph is missing or stale, run `graphify .` or `graphify --update` first.

## Default skill stack for crypto work

When working on payment, wallet, chain, or on-chain data flows, prioritize these skills:

- `blockchain-developer` for blockchain, wallet, and chain integration design.
- `goldrush-api` for read-only on-chain data, balances, transactions, and prices.
- `api-security-best-practices` for request validation, webhook security, and auth boundaries.
- `cc-skill-security-review` for security-focused code review and crypto endpoint hardening.
- `spec-to-code-compliance` when the implementation must match a protocol, design doc, or payment spec.
- `e2e-testing-patterns` for wallet, invoice, webhook, and status-check coverage.

## Repo-wide defaults

- Treat `apps/backend` as the authoritative API surface for merchant, invoice, webhook, and health flows.
- Treat `apps/consumer-app` as the authoritative UI surface for wallet, balance, and transaction flows.
- Prefer read-only chain data access unless the user explicitly asks for signing, swapping, or sending funds.
- Never add or log secrets, private keys, mnemonics, or raw signatures.
- Validate webhook signatures, timestamp windows, and chain identifiers before any state-changing operation.
- Keep tests and docs aligned with any crypto or payment behavior change.

## Execution order for crypto changes

1. Identify the endpoint or flow.
2. Apply the relevant skill guidance.
3. Implement the smallest safe change.
4. Add or update focused tests.
5. Verify the change against the contract or spec.
