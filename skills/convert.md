# Elconv Convert Skill

Convert HTML/Framer designs to Elementor V3 or V4 format.

## Trigger
Use when the user wants to convert a design (HTML, Framer XML, or URL) to Elementor format.

## Workflow

1. **Identify Source**
   - HTML file/export → use `html-parser`
   - Framer XML → use `framer-xml` extractor
   - URL → scrape first, then parse HTML

2. **Select Target**
   - V3 (classic Elementor): `elconv convert --target v3`
   - V4 (Atomic): `elconv convert --target v4`

3. **Run Conversion**
   ```bash
   npx elconv convert <source> --target <v3|v4> --output <path>
   ```

4. **Validate Output**
   - Run guards: score must be ≥85
   - Check for contamination (V3 types in V4 output or vice versa)
   - Verify element count matches source

5. **Report Results**
   - Show guard score
   - List any warnings
   - Provide output file path

## Key Commands

```bash
# Convert HTML to V3
npx elconv convert ./design.html --target v3 --output ./output/page.json

# Convert Framer XML to V4
npx elconv convert ./design.xml --target v4 --output ./output/page.json

# Dry run (no output file)
npx elconv convert ./design.html --target v3 --dry-run
```

## Important Notes

- V3 uses `elType: 'section'|'column'|'widget'` with `widgetType`
- V4 uses `type: 'e-flexbox'|'e-heading'|'e-button'` with `$$type` wrapped styles
- NEVER mix V3 and V4 types in the same output
- Always run `elconv doctor` after conversion to validate
