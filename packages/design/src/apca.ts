// APCA (Accessible Perceptual Contrast Algorithm) — ADVISORY only. The research is
// explicit: APCA was pulled from the normative WCAG 3 draft in 2023 and remains a
// draft/beta with NON-frozen thresholds, so it must never be a hard gate (gate on
// WCAG 2.2 in gate.ts; treat this as a forward-looking, dark-mode-aware check). It is
// worth computing because WCAG 2's math degrades below ~#a0a0a0 (unreliable for dark
// mode), where APCA's Lc model is better. This is the forward APCA-W3 0.1.x formula;
// the REVERSE direction (generating accessible scales by construction) is a P4
// generator concern, not here. Pure; never throws.

import type { TokenIssue } from "./schema";
import { toSrgb01 } from "./color";

// APCA-W3 0.1.x exponents/constants (beta — subject to change upstream).
const MAIN_TRC = 2.4;
const S_R = 0.2126729, S_G = 0.7151522, S_B = 0.072175;
const NORM_BG = 0.56, NORM_TXT = 0.57, REV_TXT = 0.62, REV_BG = 0.65;
const BLK_THRS = 0.022, BLK_CLMP = 1.414;
const SCALE = 1.14, LO_OFFSET = 0.027, LO_CLIP = 0.1, DELTA_Y_MIN = 0.0005;

function screenLuminance(value: unknown): number | null {
  const srgb = toSrgb01(value);
  if (!srgb) return null;
  const [r, g, b] = srgb;
  let y = S_R * r ** MAIN_TRC + S_G * g ** MAIN_TRC + S_B * b ** MAIN_TRC;
  if (y < BLK_THRS) y += (BLK_THRS - y) ** BLK_CLMP; // soft-clamp near black
  return y;
}

/** APCA lightness contrast (Lc). Sign encodes polarity (positive = dark text on
 *  light bg, negative = light text on dark bg). Returns null if a color is unsupported. */
export function apcaLc(textColor: unknown, bgColor: unknown): number | null {
  const txt = screenLuminance(textColor);
  const bg = screenLuminance(bgColor);
  if (txt == null || bg == null) return null;
  if (Math.abs(bg - txt) < DELTA_Y_MIN) return 0;

  let sapc: number;
  let output: number;
  if (bg > txt) {
    sapc = (bg ** NORM_BG - txt ** NORM_TXT) * SCALE;
    output = sapc < LO_CLIP ? 0 : sapc - LO_OFFSET;
  } else {
    sapc = (bg ** REV_BG - txt ** REV_TXT) * SCALE;
    output = sapc > -LO_CLIP ? 0 : sapc + LO_OFFSET;
  }
  return output * 100;
}

export interface ApcaPair {
  label: string;
  text: unknown;
  bg: unknown;
  /** Target |Lc| (APCA Bronze "simple mode" rough guide: body ~75, large ~45). */
  targetLc: number;
}

/** Advisory APCA check — WARNINGS only (never an error; APCA is not a frozen gate). */
export function checkApca(pairs: ApcaPair[]): TokenIssue[] {
  const issues: TokenIssue[] = [];
  for (const p of pairs) {
    const lc = apcaLc(p.text, p.bg);
    if (lc == null) {
      issues.push({ level: "warning", token: p.label, message: "could not compute APCA (unsupported color space)" });
      continue;
    }
    if (Math.abs(lc) < p.targetLc) {
      issues.push({ level: "warning", token: p.label, message: `APCA Lc ${Math.abs(lc).toFixed(1)} is below the advisory target ${p.targetLc}` });
    }
  }
  return issues;
}
