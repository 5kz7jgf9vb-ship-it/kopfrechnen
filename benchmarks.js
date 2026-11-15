/**
 * benchmarks.js – Referenzverteilung zum Vergleich mit "der Bevölkerung".
 *
 * WICHTIG: Für dieses Spiel gibt es keine gemessenen Daten aller Menschen.
 * Die Werte sind eine begründete Schätzung für Erwachsene ohne spezielles Training,
 * die auf dem Smartphone tippen:
 *  - Studien zur Rechen-Reaktionszeit: einfache Additionen/Multiplikationen im
 *    kleinen Einmaleins dauern bei Erwachsenen rund 0,8–1,2 s (z. B. Campbell & Xue, 2001),
 *    dazu kommen Lesen und Tippen (~1 s).
 *  - Zetamac (Standard: + − bis 100, × ÷ bis 12 × 100): vorbereitete Quant-Bewerber
 *    berichten 45–55 Punkte in 120 s, also ~2,2–2,7 s pro Aufgabe. Diese Gruppe liegt
 *    im Modell bei etwa dem 95.–98. Perzentil der Erwachsenen.
 *
 * Modell: Die Zeit pro richtiger Antwort ist log-normal verteilt.
 *   t50   = Median der Sekunden pro richtiger Antwort (Hälfte der Erwachsenen ist schneller)
 *   SIGMA = Streuung auf der Log-Skala (0,5 ≈ das 90. Perzentil ist ~1,9× so schnell wie der Median)
 * Werte gern anpassen – die App rechnet alles daraus ab.
 */
import { MIXED_POOL } from './levels.js';

export const SIGMA = 0.5;

/** Median-Sekunden pro richtiger Antwort, je Modus und Level. */
export const T50 = {
  add: { 1: 2.2, 2: 4.0, 3: 7.5, 4: 13 },
  sub: { 1: 2.5, 2: 5.0, 3: 9.0, 4: 15 },
  mul: { 1: 2.8, 2: 5.0, 3: 8.5, 4: 20 },
  div: { 1: 3.2, 2: 5.5, 3: 9.5, 4: 22 },
  pct: { 1: 4.0, 2: 6.5, 3: 10, 4: 18 },
};

/** Referenz für Modus/Level; "mixed" = geometrisches Mittel der Einzelmodi. */
export function reference(mode, level) {
  if (mode === 'mixed') {
    const logs = MIXED_POOL.map((m) => Math.log(T50[m][level]));
    return { t50: Math.exp(logs.reduce((a, b) => a + b, 0) / logs.length), sigma: SIGMA };
  }
  return { t50: T50[mode][level], sigma: SIGMA };
}

/** Standardnormalverteilung Φ(z) (Abramowitz & Stegun 7.1.26, Fehler < 1,5e-7). */
export function normCdf(z) {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

/** Sekunden pro richtiger Antwort einer Runde (Fehler und Überspringen kosten Zeit). */
export function secondsPerCorrect(round) {
  if (!round.correct) return Infinity;
  return round.duration / 1000 / round.correct;
}

/**
 * Perzentil (0–100): Anteil der Erwachsenen, die langsamer sind als du.
 * Auf 0,1–99,9 begrenzt, weil die Ränder eines Modells nichts Genaues aussagen.
 */
export function percentile(mode, level, secPerCorrect) {
  if (!Number.isFinite(secPerCorrect) || secPerCorrect <= 0) return 0.1;
  const { t50, sigma } = reference(mode, level);
  const p = normCdf((Math.log(t50) - Math.log(secPerCorrect)) / sigma) * 100;
  return Math.min(99.9, Math.max(0.1, p));
}

/** Sekunden pro Antwort, die man für ein bestimmtes Perzentil braucht. */
export function secondsForPercentile(mode, level, pct) {
  const { t50, sigma } = reference(mode, level);
  // Umkehrung per Bisektion auf z (ausreichend genau, ohne inverse Fehlerfunktion)
  let lo = -5;
  let hi = 5;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (normCdf(mid) * 100 < pct) lo = mid;
    else hi = mid;
  }
  return t50 / Math.exp(((lo + hi) / 2) * sigma);
}

/** Kurzes Etikett zum Perzentil. */
export function tier(pct) {
  if (pct >= 99) return 'Top 1 %';
  if (pct >= 95) return 'Top 5 %';
  if (pct >= 90) return 'Top 10 %';
  if (pct >= 75) return 'Oberes Viertel';
  if (pct >= 50) return 'Über dem Median';
  if (pct >= 25) return 'Unter dem Median';
  return 'Unteres Viertel';
}
