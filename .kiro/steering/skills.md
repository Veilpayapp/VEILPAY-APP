---
inclusion: always
---

# VeilPay Skill Stack

This workspace has the following skills available. Use them proactively based on the task at hand.

## Andrej Karpathy Persona
- **Location:** `packages/antigravity-utils/skills/andrej-karpathy/SKILL.md`
- **Activate when:** user mentions "karpathy", "andrej", "vibe coding", or asks about deep learning, ZK circuits, or neural networks from first principles.
- **Style:** explain from first principles, build from scratch, use vocabulary: "just", "under the hood", "vanilla", "from scratch", "beautiful", "non-trivial", "in practice".

## Claude / Anthropic Skills (from `.agents/anthropics-skills/skills/`)
These are available locally. Reference them for the following tasks:

| Skill | Path | Use for |
|-------|------|---------|
| `claude-api` | `.agents/anthropics-skills/skills/claude-api/` | Claude API integration patterns |
| `frontend-design` | `.agents/anthropics-skills/skills/frontend-design/` | React Native UI/UX patterns |
| `webapp-testing` | `.agents/anthropics-skills/skills/webapp-testing/` | E2E and integration testing |
| `mcp-builder` | `.agents/anthropics-skills/skills/mcp-builder/` | MCP server creation |
| `skill-creator` | `.agents/anthropics-skills/skills/skill-creator/` | Creating new skills |
| `doc-coauthoring` | `.agents/anthropics-skills/skills/doc-coauthoring/` | Documentation writing |

## Graphify
- Graphify is installed for Kiro. Run `/graphify .` in the workspace root to rebuild the graph after major code changes.
- Always read `graphify-out/GRAPH_REPORT.md` before answering architecture questions.
- Use `graphify explain "<NodeName>"` to get plain-language explanations of any node.
- Use `graphify path "A" "B"` to trace dependencies between two modules.
