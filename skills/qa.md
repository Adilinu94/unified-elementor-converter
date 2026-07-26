# Elconv QA Skill

Run visual QA checks on deployed Elementor pages.

## Trigger
Use when the user wants to verify a deployed page matches the original design.

## Workflow

1. **Capture Screenshots**
   - Desktop: 1440×900
   - Tablet: 768×1024
   - Mobile: 390×844

2. **Run Visual Diff**
   - Compare against reference (original design or previous version)
   - Calculate diff percentage per region
   - Classify severity: critical (>10%), warning (>3%), info (<3%)

3. **Structural Probes**
   - Check for shared/duplicate IDs
   - Verify element count
   - Validate nesting depth
   - Confirm widget types are valid for target

4. **Auto-Fix (if enabled)**
   - Generate fix actions for detected issues
   - Apply fixes via MCP (max 3 per round)
   - Re-measure after each round
   - Repeat until threshold met or max rounds reached

5. **Report**
   - Overall score (0-100)
   - Per-viewport breakdown
   - List of issues with severity
   - Applied fixes (if any)

## Key Commands

```bash
# Run QA on deployed page
npx elconv qa --url https://example.com/page --reference ./design.png

# QA with auto-fix
npx elconv qa --url https://example.com/page --auto-fix

# QA with custom threshold
npx elconv qa --url https://example.com/page --threshold 90

# QA specific viewport only
npx elconv qa --url https://example.com/page --viewport mobile
```

## Region-Aware Semantic Diff

Instead of raw pixel coordinates, reports use semantic regions:
- "Hero: Padding 12px zu klein" instead of "Region (200,400): 847 diff px"
- Regions: header, hero, content, footer, sidebar

## Priority Queue

Fixes are prioritized by:
1. Severity (critical > warning > info)
2. Area size (larger regions first)
3. Fix type weight (missing-element > layout-shift > color-mismatch)

Max 3 fixes per round to avoid cascading issues.
