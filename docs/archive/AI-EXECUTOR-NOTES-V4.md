# AI Executor Notes — Elementor V4 Atomic path

**Audience:** Weaker models implementing the V4 umbauplan or running Atomic builds.  
**Sister (V3, more complete playbook):** `../site-clone-to-v3/docs/AI-EXECUTOR-PLAYBOOK.md`

Works for **any** Framer/source → V4 page. No client brand hardcodes.

---

## Hard rules

1. V4 page ⇒ Atomic widgets only in the document you ship (`e-flexbox`, `e-heading`, … + Global Classes / Variables).  
2. Do **not** mix legacy V3 `container` trees as the final document on a V4 page.  
3. Styles live in Global Classes / Variables / `$$type` props — not random inline guesses.  
4. Successful MCP write ≠ visible result → clear Elementor caches + hard reload.  
5. WPCode: dual-write `post_content` **and** `wpcode_snippets` option when using WPCode for CSS/JS.  
6. Preflight before build: experiments, Unframer connectivity, XML/project match when applicable.  
7. Score guards ≥ configured threshold before deploy.  
8. Post-build: `framer-v4 qa` / section-compare — never “done” on write alone.

---

## Pipeline sketch

```
preflight → extract (Unframer/export) → tokens + global classes
  → convert tree → validate score
  → media patch → deploy (large-tree strategy if needed)
  → WPCode dual-write → qa (pixel + structural)
  → fix loop → report
```

---

## Shared product backlog with V3

Implement on V4 where it applies (qa CLI, WPCode sync, multi-viewport, CI golden):

See `../site-clone-to-v3/docs/PRODUCT-BACKLOG-P1-P10.md` (P2, P3, P6, P8, P9, P10 especially).

V4-only additions stay in Phase V7: Global Classes bound, no hybrid V3 widgets, `$$type` present.

---

## Anti-patterns

- Shipping V3 containers “temporarily” on a V4 document  
- Skipping Global Classes to go faster  
- Site-wide animation scripts without page guard  
- Trusting dry-run success without frontend verification  

---

## Related

- `UMBAUPLAN-V4-PIPELINE-HARDENING-2026-07.md`  
- `VISUAL-QA-IMPROVEMENTS-2026-07.md`  
- `novamira-skill/post-build-qa.md`  
- CHOCO / Atomic builder skills on the agent host  
