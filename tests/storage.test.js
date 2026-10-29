/** Unit-Tests für storage.js (Schema, Migration, Tages-Serie, Import/Export). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, migrate, defaultData, STORAGE_KEY } from '../storage.js';

function memBackend(initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    dump: () => m,
  };
}

const round = (o = {}) => ({ mode: 'add', level: 1, score: 100, correct: 10, wrong: 2, skipped: 1, answerMs: 20000, duration: 70000, ...o });

test('Standardwerte bei leerem Speicher', () => {
  const s = createStore(memBackend());
  assert.deepEqual(s.data, defaultData());
});

test('kaputtes JSON führt nicht zum Absturz', () => {
  const s = createStore(memBackend({ [STORAGE_KEY]: '{kaputt' }));
  assert.equal(s.data.settings.startTime, 60);
});

test('Speicher wirft Fehler -> App läuft weiter', () => {
  const s = createStore({ getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); }, removeItem() {} });
  s.updateSettings({ startTime: 90 });
  assert.equal(s.data.settings.startTime, 90);
});

test('Einstellungen werden validiert und gespeichert', () => {
  const b = memBackend();
  const s = createStore(b);
  s.updateSettings({ startTime: 5, bonus: 2, mode: 'pct', level: 9 });
  assert.equal(s.data.settings.startTime, 10); // auf Minimum begrenzt
  assert.equal(s.data.settings.bonus, 2);
  assert.equal(s.data.settings.mode, 'pct');
  assert.equal(s.data.settings.level, 1); // ungültig -> Standard
  assert.equal(createStore(b).data.settings.bonus, 2);
});

test('Highscore und Rekord-Erkennung', () => {
  const s = createStore(memBackend());
  assert.equal(s.recordRound(round({ score: 100 })).isRecord, true);
  assert.equal(s.recordRound(round({ score: 80 })).isRecord, false);
  const r = s.recordRound(round({ score: 150 }));
  assert.deepEqual(r, { isRecord: true, previousBest: 100 });
  assert.equal(s.highscore('add', 1), 150);
  assert.equal(s.data.totals.correct, 30);
  assert.equal(s.data.history.length, 3);
});

test('Tages-Serie: aufeinanderfolgende Tage, Lücke, gleicher Tag', () => {
  const s = createStore(memBackend());
  s.recordRound(round(), '2026-10-27');
  s.recordRound(round(), '2026-10-27');
  assert.equal(s.data.daily.streak, 1);
  s.recordRound(round(), '2026-10-28');
  assert.equal(s.data.daily.streak, 2);
  assert.equal(s.currentDailyStreak('2026-10-29'), 2); // gestern geübt -> noch gültig
  assert.equal(s.currentDailyStreak('2026-10-30'), 0); // verfallen
  s.recordRound(round(), '2026-10-31');
  assert.equal(s.data.daily.streak, 1);
  assert.equal(s.data.daily.best, 2);
});

test('Tages-Serie über Monatsgrenze', () => {
  const s = createStore(memBackend());
  s.recordRound(round(), '2026-02-28');
  s.recordRound(round(), '2026-03-01');
  assert.equal(s.data.daily.streak, 2);
});

test('Runde ohne Antworten zählt nicht für die Tages-Serie', () => {
  const s = createStore(memBackend());
  s.recordRound(round({ correct: 0, wrong: 0, score: 0 }), '2026-10-29');
  assert.equal(s.data.daily.streak, 0);
});

test('Export/Import Rundlauf und ungültiger Import', () => {
  const a = createStore(memBackend());
  a.recordRound(round({ score: 321 }));
  const json = a.exportJSON();
  const b = createStore(memBackend());
  b.importJSON(json);
  assert.equal(b.highscore('add', 1), 321);
  assert.throws(() => b.importJSON('{"foo":1}'));
  assert.throws(() => b.importJSON('nicht json'));
  assert.equal(b.highscore('add', 1), 321); // unverändert
});

test('Migration verwirft Unsinn und begrenzt Verlauf', () => {
  const d = migrate({
    version: 1,
    highscores: { 'add-1': 5, 'evil-9': 3, 'mul-2': 'x' },
    history: Array.from({ length: 150 }, (_, i) => ({ ts: i, score: i })),
  });
  assert.deepEqual(d.highscores, { 'add-1': 5 });
  assert.equal(d.history.length, 100);
  assert.equal(d.history[0].ts, 50);
  assert.throws(() => migrate({ version: 99 }));
});

test('Zurücksetzen', () => {
  const s = createStore(memBackend());
  s.recordRound(round());
  s.reset();
  assert.deepEqual(s.data, defaultData());
});
