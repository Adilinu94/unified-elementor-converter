# Elconv Doctor Skill

Validate and diagnose converted Elementor JSON files.

## Trigger
Use when the user wants to check if a converted JSON file is valid and ready for deployment.

## Workflow

1. **Load JSON**
   - Parse the converted output file
   - Detect target version (V3 or V4)

2. **Run Guards**
   - V3 Guards: valid elTypes, widget types, no V4 contamination
   - V4 Guards: valid atomic types, $$type wrappers, no V3 contamination
   - Calculate score (100 = perfect, <85 = needs fixes)

3. **Structural Validation**
   - Check for duplicate IDs
   - Verify nesting depth
   - Validate required fields

4. **Report**
   - Score and pass/fail status
   - List of violations with severity
   - Suggested fixes

## Key Commands

```bash
# Validate a converted file
npx elconv doctor ./output/page.json

# Validate with verbose output
npx elconv doctor ./output/page.json --verbose

# Validate and auto-fix common issues
npx elconv doctor ./output/page.json --fix
```

## Guard Categories

### V3 Guards
- `G_V3_VALID_ELTYPE`: elType must be section/column/widget/container
- `G_V3_VALID_WIDGET`: widgetType must be in allowed list
- `G_V3_NO_V4`: No V4 types (e-flexbox, $$type, etc.)

### V4 Guards
- `G_V4_VALID_TYPE`: type must start with 'e-'
- `G_V4_HAS_STYLES`: containers must have styles object
- `G_V4_NO_V3`: No V3 types (section, column, text-editor, etc.)

## Scoring

- Start at 100
- Critical violation: -20 points
- Warning: -5 points
- Info: -1 point
- Threshold: 85 (below = fail)

## Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| V4 type in V3 output | Bridge not run | Use `--target v4` or run bridge |
| Missing $$type wrapper | Manual edit | Re-run conversion |
| Duplicate IDs | Copy-paste | Regenerate IDs |
| Invalid widget type | Unsupported widget | Map to closest equivalent |
