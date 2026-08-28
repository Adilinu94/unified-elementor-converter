export * from './dark-mode.js';
export * from './components.js';
export * from './css-tokens.js';
export * from './forms.js';
export * from './interactions.js';
export * from './styles.js';
export * from './mcp-bridge.js';
export * from './setting-map.js';
export * from './component-resolver.js';
export * from './cms-resolver.js';
// The Unframer source-adapter chain: XML dialect parser -> style resolver ->
// VisualPageIR builder -> SourceAdapter implementation.
export * from './unframer-xml-parser.js';
export * from './unframer-style-resolver.js';
export * from './unframer-ir-builder.js';
export * from './unframer-source-adapter.js';
// Hybrid merge: structural IR (intent, no geometry) + live DOM (geometry and
// motion, no intent) -> one IR with evidence.methods from both sides.
export * from './hybrid-ir-merge.js';
// Node-level expansion: fills a component instance's empty subtree from the
// rendered DOM, because Unframer's getNodeXml cannot return a Component's
// children at all. Structure keeps identity, DOM supplies the values.
export * from './component-expansion.js';
// Anchor-based root alignment: pure index alignment blocks itself when the DOM
// carries roots the structural section detector never saw (header, footer).
export * from './section-root-alignment.js';
// The orchestrator that joins capture -> align -> merge -> expand. Owns a
// browser; everything it calls is pure.
export * from './live-capture.js';
