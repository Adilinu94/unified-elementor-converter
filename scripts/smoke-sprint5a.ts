import {
  McpAdapter,
  listAbilities,
  setupV4Foundation,
  listVariables,
  listGlobalClasses,
  listMedia,
} from '../src/mcp/mcp-adapter.js';

const MCP_URL = process.env.MCP_URL ?? 'https://test4.nick-webdesign.de/wp-json/mcp/novamira';
const AUTH = process.env.MCP_AUTH ?? 'Basic ' + Buffer.from('Adrian:QNAaqNtc3jKm3TM6yt7rBc9J').toString('base64');

async function main() {
  console.log('Sprint 5A — MCP-Adapter Live-Test (V4 Schema, MCP-indirected)');
  console.log('=============================================================');
  console.log(`MCP-URL: ${MCP_URL}`);

  const adapter = new McpAdapter({ baseUrl: MCP_URL, authHeader: AUTH });

  console.log('\n0. initialize() (Session-Handshake)');
  await adapter.initialize();
  console.log('   sessionId established');

  console.log('\n1. listAbilities()');
  const abilityNames = await listAbilities(adapter);
  console.log(`   ${abilityNames.length} abilities discovered`);
  const v4Abilities = abilityNames.filter((n) => n.includes('v4') || n.includes('atomic') || n.includes('batch-build') || n.includes('global-class') || n.includes('list-variables'));
  console.log(`   V4-related: ${v4Abilities.length}`);
  for (const n of v4Abilities.slice(0, 10)) {
    console.log(`     - ${n}`);
  }

  console.log('\n2. setupV4Foundation({ create_missing: false })');
  const foundation = await setupV4Foundation(adapter, { create_missing: false });
  console.log(`   base_classes: e-flexbox-base=${foundation.base_classes['e-flexbox-base']?.id} | e-div-block-base=${foundation.base_classes['e-div-block-base']?.id}`);
  console.log(`   variables.colors: ${Object.keys(foundation.variables.colors).length} entries -> ${Object.entries(foundation.variables.colors).slice(0, 4).map(([k, v]) => `${k}=${v}`).join(', ')}`);
  console.log(`   variables.fonts: ${Object.keys(foundation.variables.fonts).length} entries -> ${Object.entries(foundation.variables.fonts).slice(0, 4).map(([k, v]) => `${k}=${v}`).join(', ')}`);

  console.log('\n3. listVariables()');
  const variables = await listVariables(adapter);
  console.log(`   ${variables.length} variables total:`);
  for (const c of variables.slice(0, 8)) {
    console.log(`     - ${c.label} = ${c.value} (${c.type}, id=${c.id})`);
  }

  console.log('\n4. listGlobalClasses()');
  const classes = await listGlobalClasses(adapter);
  console.log(`   ${classes.length} global classes:`);
  for (const c of classes.slice(0, 5)) {
    console.log(`     - ${c.label} (id=${c.id}, ${c.variants.length} variants)`);
  }

  console.log('\n5. listMedia({ per_page: 5 })');
  const media = await listMedia(adapter, { per_page: 5 });
  console.log(`   ${media.length} media items:`);
  for (const m of media.slice(0, 3)) {
    console.log(`     - #${m.id} ${m.title} [${m.mime}] (${m.width}x${m.height})`);
  }

  console.log('\nALL 5 V4 MCP-CALLS GRÜN ✅');
}

main().catch((err) => {
  console.error('FAIL:', err);
  process.exit(1);
});
