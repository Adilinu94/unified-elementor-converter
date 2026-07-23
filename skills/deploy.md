# Elconv Deploy Skill

Deploy converted Elementor pages to WordPress via MCP.

## Trigger
Use when the user wants to deploy a converted page to a WordPress site.

## Prerequisites
- WordPress site with Elementor installed
- MCP adapter configured (Novamira or compatible)
- Converted JSON output from `elconv convert`

## Workflow

1. **Preflight Checks**
   ```bash
   npx elconv deploy <json> --preflight
   ```
   - Verify WordPress connection
   - Check Elementor version compatibility
   - Validate target post/page exists or can be created

2. **Select Strategy**
   - `direct`: Small pages (<50KB) — single API call
   - `upload-php`: Medium pages (50-500KB) — PHP upload script
   - `split`: Large pages (>500KB) — chunked deployment

3. **Deploy**
   ```bash
   npx elconv deploy <json> --url <wp-url> --post-id <id>
   ```

4. **Verify**
   - Check deployment status
   - Run QA visual diff if enabled
   - Report success/failure

## Key Commands

```bash
# Deploy with auto strategy
npx elconv deploy ./output/page.json --url https://example.com --post-id 42

# Force specific strategy
npx elconv deploy ./output/page.json --strategy split

# Dry run (validate only, no deployment)
npx elconv deploy ./output/page.json --dry-run

# Deploy with transaction (rollback on failure)
npx elconv deploy ./output/page.json --transaction
```

## Transaction Layer

When `--transaction` is enabled:
- Creates a checkpoint before deployment
- Rolls back automatically on failure
- Provides detailed error reporting

## Chunked Deployment

For large pages, deployment is split into 20-element chunks:
- Each chunk is verified before proceeding
- Progress is reported per chunk
- Failed chunks can be retried independently
