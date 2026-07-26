export type Strictness = 'draft' | 'balanced' | 'pixel-perfect';

export type IssueSeverity = 'low' | 'medium' | 'high';

export interface StrictnessProfile {
  name: Strictness;
  minMatchPercent: number;
  maxRounds: number;
  maxFixesPerRound: number;
  severitiesToFix: IssueSeverity[];
  label: string;
  description: string;
}

export const STRICTNESS_PROFILES: Record<Strictness, StrictnessProfile> = {
  draft: {
    name: 'draft',
    minMatchPercent: 70,
    maxRounds: 1,
    maxFixesPerRound: 3,
    severitiesToFix: ['high'],
    label: 'Draft',
    description: 'Schnelles Iterieren. Nur High-Severity Fixes, max. 1 Runde. Final-Report listet alle Issues auf.',
  },
  balanced: {
    name: 'balanced',
    minMatchPercent: 85,
    maxRounds: 2,
    maxFixesPerRound: 5,
    severitiesToFix: ['high', 'medium'],
    label: 'Balanced',
    description: 'Empfohlenes Profil. High + Medium Severity Fixes, max. 2 Runden, max. 5 Fixes pro Runde.',
  },
  'pixel-perfect': {
    name: 'pixel-perfect',
    minMatchPercent: 95,
    maxRounds: 3,
    maxFixesPerRound: 20,
    severitiesToFix: ['high', 'medium', 'low'],
    label: 'Pixel-Perfect',
    description: 'Volle Coverage. Alle Severities, max. 3 Runden, max. 20 Fixes pro Runde. Auch Spacing/Font-Größen/Farbnuancen.',
  },
};

export function getProfile(strictness: Strictness): StrictnessProfile {
  const profile = STRICTNESS_PROFILES[strictness];
  if (!profile) {
    throw new Error(
      `Unknown strictness: ${strictness}. Valid: ${Object.keys(STRICTNESS_PROFILES).join(', ')}`,
    );
  }
  return profile;
}

export function listStrictnesses(): Strictness[] {
  return Object.keys(STRICTNESS_PROFILES) as Strictness[];
}

export function shouldFix(severity: IssueSeverity, strictness: Strictness): boolean {
  return getProfile(strictness).severitiesToFix.includes(severity);
}

export function passesTarget(matchPercent: number, strictness: Strictness): boolean {
  return matchPercent >= getProfile(strictness).minMatchPercent;
}
