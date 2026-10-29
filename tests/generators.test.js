/**
 * Unit-Tests für die Aufgabengeneratoren: `npm test`
 * 1000 Aufgaben pro Modus und Level; prüft Ganzzahligkeit, Nicht-Negativität,
 * Rechenrichtigkeit, Wertebereiche und keine direkte Wiederholung.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS, MODES, MIXED_POOL } from '../levels.js';
import { generateTask, pointsFor, streakMultiplier } from '../generator.js';

const N = 1000;
const inRange = (x, [lo, hi]) => x >= lo && x <= hi;

/** Prüft eine Aufgabe gegen die Variante, aus der sie erzeugt wurde. */
function checkTask(t) {
  const { mode, a, b, answer, variant: v } = t;
  assert.ok(Number.isInteger(answer), `nicht ganzzahlig: ${t.text} = ${answer}`);
  assert.ok(answer >= 0, `negativ: ${t.text} = ${answer}`);
  assert.ok(Number.isInteger(a) && Number.isInteger(b), `Operand nicht ganzzahlig: ${t.text}`);

  switch (mode) {
    case 'add':
      assert.equal(answer, a + b);
      assert.ok(inRange(a, v.a) && inRange(b, v.b), `Bereich: ${t.text}`);
      if (v.maxResult != null) assert.ok(answer <= v.maxResult, `zu groß: ${t.text}`);
      break;
    case 'sub':
      assert.equal(answer, a - b);
      assert.ok(inRange(a, v.a) && inRange(b, v.b), `Bereich: ${t.text}`);
      assert.ok(answer >= (v.minResult ?? 0), `Ergebnis zu klein: ${t.text}`);
      break;
    case 'mul': {
      assert.equal(answer, a * b);
      // Reihenfolge darf getauscht sein
      const ok = (inRange(a, v.a) && inRange(b, v.b)) || (inRange(b, v.a) && inRange(a, v.b));
      assert.ok(ok, `Bereich: ${t.text}`);
      break;
    }
    case 'div':
      assert.equal(a % b, 0, `Rest: ${t.text}`);
      assert.equal(answer, a / b);
      assert.ok(inRange(b, v.divisor) && inRange(answer, v.quotient), `Bereich: ${t.text}`);
      break;
    case 'pct':
      assert.equal(answer, (a * b) / 100);
      assert.ok(v.percents.includes(a), `Prozentsatz: ${t.text}`);
      assert.ok(inRange(b, v.base), `Basis: ${t.text}`);
      break;
    default:
      assert.fail(`unbekannter Modus ${mode}`);
  }
}

for (const mode of Object.keys(MODES)) {
  for (const level of [1, 2, 3, 4]) {
    test(`${mode} Level ${level}: ${N} gültige Aufgaben`, () => {
      let prev = null;
      const seenModes = new Set();
      for (let i = 0; i < N; i++) {
        const t = generateTask(mode, level, prev?.key ?? null);
        checkTask(t);
        assert.notEqual(t.key, prev?.key, `direkte Wiederholung: ${t.text}`);
        if (mode !== 'mixed') assert.equal(t.mode, mode);
        seenModes.add(t.mode);
        prev = t;
      }
      if (mode === 'mixed') assert.deepEqual([...seenModes].sort(), [...MIXED_POOL].sort());
    });
  }
}

test('keine Wiederholung auch bei winzigem Wertebereich', () => {
  // 1 × 1 ist im Einsteiger-Level möglich; ein Zufall, der immer 0 liefert, würde sie wiederholen.
  let calls = 0;
  const rnd = () => (calls++ < 50 ? 0 : Math.random());
  const first = generateTask('mul', 1, null, () => 0);
  const second = generateTask('mul', 1, first.key, rnd);
  assert.notEqual(second.key, first.key);
});

test('jede Level-Konfiguration hat 4 Stufen', () => {
  for (const mode of MIXED_POOL) assert.deepEqual(Object.keys(LEVELS[mode]), ['1', '2', '3', '4']);
});

test('Punkte: Level-Gewicht und Streak-Bonus', () => {
  assert.equal(streakMultiplier(0), 1);
  assert.equal(streakMultiplier(4), 1);
  assert.equal(streakMultiplier(5), 1.25);
  assert.equal(streakMultiplier(100), 2);
  assert.equal(pointsFor(1, 1), 10);
  assert.equal(pointsFor(4, 10), 75);
  assert.ok(pointsFor(4, 1) > pointsFor(1, 1));
});
