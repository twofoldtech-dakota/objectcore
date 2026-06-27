// Shared color math — the substrate for the deterministic contrast gate (gate.ts,
// WCAG 2.2) and the advisory perceptual one (apca.ts). Pure, zero-dep. Supports the
// forms the design layer actually authors in: hex strings and DTCG color objects in
// sRGB / OKLCH / OKLab (the perceptual space the SSOT is written in). Wide-gamut
// spaces (display-p3 etc.) return null — their luminance differs and is out of scope
// for a gate that must be exact, not approximate.

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

function hexToSrgb01(hex: string): [number, number, number] | null {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
}

/** OKLCH/OKLab → linear sRGB (the standard Björn Ottosson matrices). */
function oklabToLinearSrgb(L: number, a: number, b: number): [number, number, number] {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  return [
    clamp01(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    clamp01(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    clamp01(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

const gammaEncode = (c: number): number =>
  clamp01(c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** A resolved color value → gamma-encoded sRGB in [0,1], or null if unsupported. */
export function toSrgb01(value: unknown): [number, number, number] | null {
  if (typeof value === "string") return hexToSrgb01(value);
  if (!isObj(value)) return null;
  const space = value.colorSpace;
  const comps = value.components;
  if (typeof space === "string" && Array.isArray(comps) && comps.every((c) => typeof c === "number")) {
    const n = comps as number[];
    if (space === "srgb") return [clamp01(n[0]!), clamp01(n[1]!), clamp01(n[2]!)];
    if (space === "oklch") {
      const [L, C, H] = n;
      const hr = (H! * Math.PI) / 180;
      return oklabToLinearSrgb(L!, C! * Math.cos(hr), C! * Math.sin(hr)).map(gammaEncode) as [number, number, number];
    }
    if (space === "oklab") return oklabToLinearSrgb(n[0]!, n[1]!, n[2]!).map(gammaEncode) as [number, number, number];
  }
  if (typeof value.hex === "string") return hexToSrgb01(value.hex);
  return null;
}

const linearize = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** WCAG 2.x relative luminance of a color value, or null if unsupported. */
export function relativeLuminance(value: unknown): number | null {
  const srgb = toSrgb01(value);
  if (!srgb) return null;
  const [r, g, b] = srgb;
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

/** WCAG 2.x contrast ratio (1–21), or null if either color is unsupported. */
export function contrastRatio(fg: unknown, bg: unknown): number | null {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  if (l1 == null || l2 == null) return null;
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}
