/** Unit-Tests für das Referenzmodell (benchmarks.js). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODES } from '../levels.js';
import { T50, normCdf, percentile, reference, secondsForPercentile, secondsPerCorrect, tier } from '../benchmarks.js';

test('Normalverteilung: bekannte Werte', () => {
  assert.ok(Math.abs(normCdf(0) - 0.5) < 1e-7);
  assert.ok(Math.abs(normCdf(1) - 0.841345) < 1e-5);
  assert.ok(Math.abs(normCdf(-1.959964) - 0.025) < 1e-5);
});

test('Median-Tempo ergibt das 50. Perzentil, für alle Modi und Level', () => {
  for (const mode of Object.keys(MODES)) {
    for (const lvl of [1, 2, 3, 4]) {
      const { t50 } = reference(mode, lvl);
      assert.ok(t50 > 0 && Number.isFinite(t50), `${mode}/${lvl}`);
      assert.ok(Math.abs(percentile(mode, lvl, t50) - 50) < 1e-4, `${mode}/${lvl}`);
    }
  }
});

test('schneller → höheres Perzentil, begrenzt auf 0,1–99,9', () => {
  assert.ok(percentile('mul', 2, 2) > percentile('mul', 2, 4));
  assert.equal(percentile('mul', 2, 0.01), 99.9);
  assert.equal(percentile('mul', 2, 1000), 0.1);
  assert.equal(percentile('mul', 2, Infinity), 0.1);
});

test('höhere Level sind im Median langsamer', () => {
  for (const mode of Object.keys(T50)) {
    for (const lvl of [1, 2, 3]) assert.ok(T50[mode][lvl] < T50[mode][lvl + 1], `${mode} L${lvl}`);
  }
});

test('Umkehrung: Sekunden für ein Perzentil', () => {
  for (const p of [10, 50, 90, 99]) {
    const s = secondsForPercentile('add', 2, p);
    assert.ok(Math.abs(percentile('add', 2, s) - p) < 0.01, `p=${p}`);
  }
});

test('Sekunden pro richtiger Antwort und Etiketten', () => {
  assert.equal(secondsPerCorrect({ duration: 60000, correct: 20 }), 3);
  assert.equal(secondsPerCorrect({ duration: 60000, correct: 0 }), Infinity);
  assert.equal(tier(99.5), 'Top 1 %');
  assert.equal(tier(50), 'Über dem Median');
  assert.equal(tier(10), 'Unteres Viertel');
});
