// Minimal semver for the release engine. Plugins version as plain MAJOR.MINOR.PATCH;
// we deliberately use straight semver bump semantics (not Changesets' 0.x special
// casing) so a bump is obvious from the file alone. Pure, no deps.

export type Bump = "major" | "minor" | "patch";

/** patch < minor < major. */
const ORDER: Bump[] = ["patch", "minor", "major"];

export function bumpRank(b: Bump): number {
  return ORDER.indexOf(b);
}

/** The larger of two bumps — how overlapping changesets for one plugin combine. */
export function maxBump(a: Bump, b: Bump): Bump {
  return bumpRank(a) >= bumpRank(b) ? a : b;
}

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
}

/** Strict MAJOR.MINOR.PATCH — the release engine's version floor, deliberately
 *  narrower than the wire floor. Prerelease/build identifiers (`1.0.0-rc.1`,
 *  `1.0.0+build`) are reserved for the OIDC/channel publish path (registry-core's
 *  permissive SEMVER accepts them over POST /v1/plugins); the bump engine refuses
 *  them rather than guessing bump semantics. A workspace plugin that should be
 *  bumpable must carry a plain X.Y.Z version. */
export function parseVersion(v: string): SemVer {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v.trim());
  if (!m) throw new Error(`invalid semver "${v}" (expected MAJOR.MINOR.PATCH)`);
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

export function bumpVersion(version: string, bump: Bump): string {
  const { major, minor, patch } = parseVersion(version);
  switch (bump) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
  }
}
