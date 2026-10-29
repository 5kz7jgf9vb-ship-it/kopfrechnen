/**
 * levels.js – Wertebereiche und Punkte je Modus und Level.
 *
 * Hier kannst du die Schwierigkeit frei anpassen. Die Generatoren in
 * generator.js garantieren unabhängig von diesen Werten, dass jedes Ergebnis
 * eine nicht negative ganze Zahl ist. Bereiche sind immer [min, max] inklusive.
 *
 * Mehrere "variants" pro Level werden nach "weight" zufällig gewählt, damit z. B.
 * Profi-Multiplikation sowohl 2-stellig × 1-stellig als auch leichte
 * 2-stellig × 2-stellig Aufgaben enthält.
 */

/** Anzeige und Punktgewicht je Level. */
export const LEVEL_META = {
  1: { name: 'Einsteiger', points: 10, desc: 'Plus und Minus bis 20, kleines Einmaleins, 10 % und 50 %.' },
  2: { name: 'Fortgeschritten', points: 20, desc: 'Zahlen bis 100, Mal bis 12 × 20, 5 bis 50 %.' },
  3: { name: 'Profi', points: 35, desc: 'Dreistellig, zweistellig × einstellig, glatte Prozente.' },
  4: { name: 'Experte', points: 50, desc: 'Große Zahlen, zweistellig × zweistellig, krumme Prozente.' },
};

/** Anzeige der Modi. "mixed" mischt alle anderen Modi im gewählten Level. */
export const MODES = {
  add: { name: 'Addition', symbol: '+' },
  sub: { name: 'Subtraktion', symbol: '−' },
  mul: { name: 'Multiplikation', symbol: '×' },
  div: { name: 'Division', symbol: '÷' },
  pct: { name: 'Prozent', symbol: '%' },
  mixed: { name: 'Mixed', symbol: '∗' },
};

/** Modi, aus denen "mixed" zieht. */
export const MIXED_POOL = ['add', 'sub', 'mul', 'div', 'pct'];

/** Streak-Bonus: alle `every` richtigen Antworten in Folge steigt der Faktor um `step`, bis `maxSteps`. */
export const STREAK = { every: 5, step: 0.25, maxSteps: 4 };

export const LEVELS = {
  /* Addition: a + b, Ergebnis höchstens maxResult. */
  add: {
    1: { variants: [{ a: [1, 19], b: [1, 19], maxResult: 20 }] },
    2: { variants: [{ a: [5, 95], b: [5, 95], maxResult: 100 }] },
    3: { variants: [{ a: [100, 999], b: [10, 999], maxResult: 1999 }] },
    4: { variants: [{ a: [1000, 9999], b: [100, 9999], maxResult: 19998 }] },
  },

  /* Subtraktion: a − b mit b ≤ a − minResult, damit nie negativ. */
  sub: {
    1: { variants: [{ a: [2, 20], b: [1, 19], minResult: 0 }] },
    2: { variants: [{ a: [20, 100], b: [2, 99], minResult: 1 }] },
    3: { variants: [{ a: [100, 999], b: [10, 989], minResult: 1 }] },
    4: { variants: [{ a: [1000, 9999], b: [100, 9899], minResult: 1 }] },
  },

  /* Multiplikation: a × b. */
  mul: {
    1: { variants: [{ a: [1, 10], b: [1, 10] }] },
    2: { variants: [{ a: [2, 12], b: [2, 20] }] },
    3: {
      variants: [
        { a: [11, 99], b: [2, 9], weight: 3 }, // zweistellig × einstellig
        { a: [11, 25], b: [11, 19], weight: 1 }, // leichte zweistellig × zweistellig
      ],
    },
    4: {
      variants: [
        { a: [12, 99], b: [12, 99], weight: 3 }, // zweistellig × zweistellig
        { a: [101, 999], b: [3, 9], weight: 1 }, // dreistellig × einstellig
      ],
    },
  },

  /* Division: (divisor × quotient) ÷ divisor – immer ohne Rest. */
  div: {
    1: { variants: [{ divisor: [1, 10], quotient: [1, 10] }] },
    2: { variants: [{ divisor: [2, 12], quotient: [2, 20] }] },
    3: {
      variants: [
        { divisor: [2, 9], quotient: [11, 99], weight: 3 },
        { divisor: [11, 25], quotient: [2, 12], weight: 1 },
      ],
    },
    4: {
      variants: [
        { divisor: [11, 99], quotient: [11, 99], weight: 3 },
        { divisor: [3, 9], quotient: [101, 999], weight: 1 },
      ],
    },
  },

  /*
   * Prozent: p % von base. Die Basis wird automatisch als Vielfaches von
   * 100 / ggT(p, 100) gewählt, damit das Ergebnis ganzzahlig ist.
   */
  pct: {
    1: { variants: [{ percents: [10, 50], base: [10, 200] }] },
    2: { variants: [{ percents: [5, 10, 20, 25, 50], base: [20, 400] }] },
    3: { variants: [{ percents: [10, 15, 20, 25, 30, 40, 60, 75, 80, 90], base: [40, 1000] }] },
    4: {
      variants: [
        { percents: [3, 6, 7, 8, 12, 15, 17, 35, 45, 65, 85, 95, 120, 125, 150], base: [50, 2000] },
      ],
    },
  },
};
