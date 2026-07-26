// @elconv/core — Design-System (Token-Constraints, Modul S1)
// Constrains the builder to a curated, deduplicated token set (prevents drift).
export {
  buildConstraintSet,
  enforceColor,
  enforceColorsInSettings,
  type TokenDriftWarning,
  type TokenConstraintSet,
  type SpacingToken,
  type FontToken,
  type ColorMatch,
} from './token-constraint.js';
export { designTokensToConstraintSet } from './design-tokens-adapter.js';
