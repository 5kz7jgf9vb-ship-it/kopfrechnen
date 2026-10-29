/**
 * generator.js – erzeugt Aufgaben aus der Konfiguration in levels.js.
 *
 * Jede Aufgabe hat die Form { mode, level, a, b, op, text, answer, key }.
 * Garantien (durch tests/generators.test.js geprüft):
 *  - answer ist eine nicht negative ganze Zahl
 *  - Operanden liegen in den konfigurierten Bereichen
 *  - dieselbe Aufgabe (key) kommt nie zweimal direkt hintereinander
 */
import { LEVELS, LEVEL_META, MIXED_POOL, STREAK } from './levels.js';

/** Ganzzahl in [min, max] inklusive. */
export function randInt(min, max, rnd = Math.random) {
  return min + Math.floor(rnd() * (max - min + 1));
}

function pick(list, rnd) {
  return list[Math.floor(rnd() * list.length)];
}

function pickWeighted(variants, rnd) {
  const total = variants.reduce((s, v) => s + (v.weight ?? 1), 0);
  let r = rnd() * total;
  for (const v of variants) {
    r -= v.weight ?? 1;
    if (r < 0) return v;
  }
  return variants[variants.length - 1];
}

function gcd(x, y) {
  while (y) [x, y] = [y, x % y];
  return x;
}

/* ---------- Einzelgeneratoren: liefern {a, b, answer} oder null (dann neuer Versuch) ---------- */

const builders = {
  add(v, rnd) {
    const a = randInt(v.a[0], v.a[1], rnd);
    const maxB = Math.min(v.b[1], (v.maxResult ?? Infinity) - a);
    if (maxB < v.b[0]) return null;
    const b = randInt(v.b[0], maxB, rnd);
    return { a, b, answer: a + b };
  },

  sub(v, rnd) {
    const a = randInt(v.a[0], v.a[1], rnd);
    const maxB = Math.min(v.b[1], a - (v.minResult ?? 0));
    if (maxB < v.b[0]) return null;
    const b = randInt(v.b[0], maxB, rnd);
    return { a, b, answer: a - b };
  },

  mul(v, rnd) {
    let a = randInt(v.a[0], v.a[1], rnd);
    let b = randInt(v.b[0], v.b[1], rnd);
    // Reihenfolge gelegentlich tauschen, damit "7 × 13" und "13 × 7" beide vorkommen.
    if (rnd() < 0.5) [a, b] = [b, a];
    return { a, b, answer: a * b };
  },

  div(v, rnd) {
    const divisor = randInt(v.divisor[0], v.divisor[1], rnd);
    const quotient = randInt(v.quotient[0], v.quotient[1], rnd);
    return { a: divisor * quotient, b: divisor, answer: quotient };
  },

  pct(v, rnd) {
    const p = pick(v.percents, rnd);
    // Kleinste Basis-Schrittweite, bei der p % ganzzahlig ist.
    const step = 100 / gcd(p, 100);
    const lo = Math.ceil(v.base[0] / step);
    const hi = Math.floor(v.base[1] / step);
    if (hi < lo) return null;
    const base = randInt(lo, hi, rnd) * step;
    return { a: p, b: base, answer: (p * base) / 100 };
  },
};

const OPS = { add: '+', sub: '−', mul: '×', div: '÷', pct: '% von' };

function format(mode, a, b) {
  if (mode === 'pct') return `${a} % von ${b}`;
  return `${a} ${OPS[mode]} ${b}`;
}

/**
 * Erzeugt eine Aufgabe.
 * @param {string} mode   add | sub | mul | div | pct | mixed
 * @param {number} level  1–4
 * @param {string|null} prevKey  key der vorherigen Aufgabe (wird nicht wiederholt)
 * @param {() => number} rnd     Zufallsquelle (für Tests austauschbar)
 */
export function generateTask(mode, level, prevKey = null, rnd = Math.random) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const m = mode === 'mixed' ? pick(MIXED_POOL, rnd) : mode;
    const cfg = LEVELS[m]?.[level];
    if (!cfg) throw new Error(`Unbekannter Modus/Level: ${m}/${level}`);
    const variant = pickWeighted(cfg.variants, rnd);
    const r = builders[m](variant, rnd);
    if (!r) continue;
    const key = `${m}:${r.a}:${r.b}`;
    if (key === prevKey) continue;
    if (!Number.isInteger(r.answer) || r.answer < 0) continue; // Sicherheitsnetz
    return { mode: m, level, a: r.a, b: r.b, variant, text: format(m, r.a, r.b), answer: r.answer, key };
  }
  throw new Error(`Konnte keine gültige Aufgabe für ${mode}/${level} erzeugen – levels.js prüfen.`);
}

/** Aktueller Streak-Faktor (1, 1.25, 1.5 …) für eine Serie richtiger Antworten. */
export function streakMultiplier(streak) {
  const steps = Math.min(Math.floor(streak / STREAK.every), STREAK.maxSteps);
  return 1 + steps * STREAK.step;
}

/** Punkte für eine richtige Antwort; streak = Länge der Serie inklusive dieser Antwort. */
export function pointsFor(level, streak) {
  return Math.round(LEVEL_META[level].points * streakMultiplier(streak));
}
