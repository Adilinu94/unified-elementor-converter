# Architecture

## Package dependency graph

```mermaid
flowchart TD
  CLI["@elconv/cli"]
  CORE["@elconv/core"]
  EXT["@elconv/extractors"]
  V3["@elconv/target-v3"]
  V4["@elconv/target-v4"]
  MCP["@elconv/mcp"]
  QA["@elconv/qa"]

  CLI --> CORE
  CLI --> EXT
  CLI --> V3
  CLI --> V4
  CLI --> MCP
  CLI --> QA
  EXT --> CORE
  V3 --> CORE
  V4 --> CORE
  V4 --> V3
  MCP --> CORE
  QA --> CORE
```

## Pipeline stages

```mermaid
flowchart LR
  A[Preflight] --> B[Extraction]
  B --> C[Classification]
  C --> D[Build V3/V4]
  D --> E[Deploy MCP]
  E --> F[QA / Healing]
```

## Extraction stack

1. **Playwright** — live DOM, hydration wait, lazy scroll
2. **Computed styles** — curated CSS walk for widget mapping
3. **Section detector** — layout regions
4. **Font / asset pipeline** — rate-limited downloads + manifest
5. **Recon** — SPA framework + mutation observer

## Isolation rules

- V3 and V4 trees are **branded** (`__v3Brand` / `__v4Brand`)
- Contamination guards reject cross-target widgets
- Deploy strategy chooses full vs chunked by payload size
