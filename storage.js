/**
 * storage.js – lokale Persistenz in localStorage mit versioniertem Schema.
 *
 * Alles liegt unter einem Schlüssel als JSON. Jeder Zugriff ist in try/catch
 * gekapselt: Ist localStorage nicht verfügbar (privater Modus, voll, gesperrt),
 * läuft die App mit einem Speicher im Arbeitsspeicher weiter.
 */

export const STORAGE_KEY = 'kopfrechnen.data';
export const SCHEMA_VERSION = 1;
export const HISTORY_LIMIT = 100;

/** Standardwerte für neue Installationen. */
export function defaultData() {
  return {
    version: SCHEMA_VERSION,
    settings: {
      startTime: 60, // Sekunden
      bonus: 1, // Sekunden pro richtiger Antwort
      sound: true,
      mode: 'add',
      level: 1,
    },
    totals: {
      correct: 0,
      wrong: 0,
      skipped: 0,
      answerMs: 0, // Summe der Zeit bis zur richtigen Antwort
      rounds: 0,
    },
    highscores: {}, // { "add-1": 420, ... }
    history: [], // [{ ts, mode, level, score, correct, wrong, skipped, duration }]
    daily: { lastDay: null, streak: 0, best: 0 },
  };
}

/* ---------- Backend ---------- */

function memoryBackend() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

function detectBackend() {
  try {
    const ls = globalThis.localStorage;
    const probe = '__kr_probe__';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return ls;
  } catch {
    return memoryBackend();
  }
}

/* ---------- Migration und Validierung ---------- */

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const num = (x, fallback, min = -Infinity, max = Infinity) =>
  typeof x === 'number' && Number.isFinite(x) ? Math.min(max, Math.max(min, x)) : fallback;

/**
 * Bringt beliebige (auch alte oder teilweise kaputte) Daten auf das aktuelle Schema.
 * Unbekannte Felder werden verworfen, fehlende mit Standardwerten gefüllt.
 */
export function migrate(raw) {
  const d = defaultData();
  if (!isObj(raw)) return d;

  // Platz für künftige Migrationen: if (raw.version === 1) { ...; raw.version = 2 }
  if (typeof raw.version === 'number' && raw.version > SCHEMA_VERSION) {
    throw new Error('Die Daten stammen aus einer neueren App-Version.');
  }

  const s = isObj(raw.settings) ? raw.settings : {};
  d.settings.startTime = Math.round(num(s.startTime, 60, 10, 600));
  d.settings.bonus = num(s.bonus, 1, 0, 10);
  d.settings.sound = typeof s.sound === 'boolean' ? s.sound : true;
  if (['add', 'sub', 'mul', 'div', 'pct', 'mixed'].includes(s.mode)) d.settings.mode = s.mode;
  if ([1, 2, 3, 4].includes(s.level)) d.settings.level = s.level;

  const t = isObj(raw.totals) ? raw.totals : {};
  for (const k of Object.keys(d.totals)) d.totals[k] = Math.round(num(t[k], 0, 0));

  if (isObj(raw.highscores)) {
    for (const [k, v] of Object.entries(raw.highscores)) {
      if (/^(add|sub|mul|div|pct|mixed)-[1-4]$/.test(k) && typeof v === 'number' && v > 0) {
        d.highscores[k] = Math.round(v);
      }
    }
  }

  if (Array.isArray(raw.history)) {
    d.history = raw.history
      .filter((h) => isObj(h) && typeof h.ts === 'number' && typeof h.score === 'number')
      .map((h) => ({
        ts: h.ts,
        mode: String(h.mode ?? 'add'),
        level: Math.round(num(h.level, 1, 1, 4)),
        score: Math.round(num(h.score, 0, 0)),
        correct: Math.round(num(h.correct, 0, 0)),
        wrong: Math.round(num(h.wrong, 0, 0)),
        skipped: Math.round(num(h.skipped, 0, 0)),
        duration: Math.round(num(h.duration, 0, 0)),
      }))
      .slice(-HISTORY_LIMIT);
  }

  const dl = isObj(raw.daily) ? raw.daily : {};
  d.daily.lastDay = typeof dl.lastDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dl.lastDay) ? dl.lastDay : null;
  d.daily.streak = Math.round(num(dl.streak, 0, 0));
  d.daily.best = Math.max(Math.round(num(dl.best, 0, 0)), d.daily.streak);

  return d;
}

/* ---------- Datum-Hilfen (lokale Zeitzone) ---------- */

export function dayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function prevDayKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return dayKey(new Date(y, m - 1, d - 1));
}

/* ---------- Store ---------- */

export function createStore(backend = detectBackend()) {
  let data;
  try {
    const raw = backend.getItem(STORAGE_KEY);
    data = raw ? migrate(JSON.parse(raw)) : defaultData();
  } catch (err) {
    console.warn('Gespeicherte Daten unlesbar, starte neu:', err);
    data = defaultData();
  }

  function save() {
    try {
      backend.setItem(STORAGE_KEY, JSON.stringify(data));
      return true;
    } catch (err) {
      console.warn('Speichern fehlgeschlagen:', err);
      return false;
    }
  }

  return {
    get data() {
      return data;
    },

    updateSettings(patch) {
      data = migrate({ ...data, settings: { ...data.settings, ...patch } });
      save();
      return data.settings;
    },

    highscore(mode, level) {
      return data.highscores[`${mode}-${level}`] ?? 0;
    },

    /** Aktuelle Tages-Serie: verfällt, wenn gestern und heute nicht geübt wurde. */
    currentDailyStreak(today = dayKey()) {
      const { lastDay, streak } = data.daily;
      if (lastDay === today || lastDay === prevDayKey(today)) return streak;
      return 0;
    },

    /**
     * Speichert eine beendete Runde.
     * @returns {{ isRecord: boolean, previousBest: number }}
     */
    recordRound(round, today = dayKey()) {
      const key = `${round.mode}-${round.level}`;
      const previousBest = data.highscores[key] ?? 0;
      const isRecord = round.score > previousBest;
      if (isRecord) data.highscores[key] = round.score;

      data.totals.correct += round.correct;
      data.totals.wrong += round.wrong;
      data.totals.skipped += round.skipped;
      data.totals.answerMs += Math.round(round.answerMs);
      data.totals.rounds += 1;

      data.history.push({
        ts: round.ts ?? Date.now(),
        mode: round.mode,
        level: round.level,
        score: round.score,
        correct: round.correct,
        wrong: round.wrong,
        skipped: round.skipped,
        duration: Math.round(round.duration),
      });
      if (data.history.length > HISTORY_LIMIT) data.history.splice(0, data.history.length - HISTORY_LIMIT);

      // Tages-Serie nur zählen, wenn wirklich geübt wurde.
      if (round.correct + round.wrong > 0) {
        const { lastDay } = data.daily;
        if (lastDay !== today) {
          data.daily.streak = lastDay === prevDayKey(today) ? data.daily.streak + 1 : 1;
          data.daily.lastDay = today;
          data.daily.best = Math.max(data.daily.best, data.daily.streak);
        }
      }

      save();
      return { isRecord, previousBest };
    },

    exportJSON() {
      return JSON.stringify({ app: 'kopfrechnen', exportedAt: new Date().toISOString(), ...data }, null, 2);
    },

    /** Importiert eine Export-Datei. Wirft bei ungültigem Inhalt, ohne vorhandene Daten zu ändern. */
    importJSON(text) {
      const parsed = JSON.parse(text);
      if (!isObj(parsed) || (parsed.app !== 'kopfrechnen' && typeof parsed.version !== 'number')) {
        throw new Error('Keine gültige Kopfrechnen-Exportdatei.');
      }
      data = migrate(parsed);
      save();
    },

    reset() {
      data = defaultData();
      try {
        backend.removeItem(STORAGE_KEY);
      } catch {
        /* egal */
      }
      save();
    },
  };
}
