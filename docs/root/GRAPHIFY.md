# Graphify Guidance

This repo uses Graphify as the shared navigation layer for Copilot, Kilo Code, and any other agent that reads project instructions.

## Always-on rule

- Before answering architecture or codebase questions, read `graphify-out/GRAPH_REPORT.md` if it exists.
- If `graphify-out/wiki/index.md` exists, use it for deeper questions.
- Prefer `graphify-out/graph.json` and `graphify-out/GRAPH_REPORT.md` over raw grep or broad file scanning when the graph exists.
- If the graph is missing or stale, run `graphify .` or `graphify --update` before doing deep analysis.

## Shared outputs

- `graphify-out/graph.json` for structured queries and shared graph access.
- `graphify-out/GRAPH_REPORT.md` for the high-level summary.
- `graphify-out/wiki/index.md` for wiki-style navigation when present.
