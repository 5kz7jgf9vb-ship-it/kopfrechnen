/**
 * app.js – UI, Spielablauf, Statistik und iPhone-spezifisches Verhalten.
 *
 * Wichtige iOS-Details:
 *  - Fokus auf das Eingabefeld nur synchron im Klick-Handler (Nutzergeste),
 *    sonst öffnet Safari die Tastatur nicht.
 *  - Spiel-Buttons verhindern bei pointerdown den Fokuswechsel, damit die
 *    Zahlentastatur während der Runde nie verschwindet.
 *  - Der Timer rechnet mit Zeitstempeln (performance.now) und pausiert bei
 *    visibilitychange; er driftet daher nicht.
 *  - window.visualViewport liefert die Höhe oberhalb der Tastatur → CSS-Variablen.
 */
import { LEVEL_META, MODES } from './levels.js';
import { generateTask, pointsFor, streakMultiplier } from './generator.js';
import { createStore, dayKey } from './storage.js';

const APP_VERSION = '1.0.0'; // bei Änderungen auch CACHE_VERSION in sw.js erhöhen
const PRESET_TIMES = [30, 60, 90, 120];
const RING_C = 2 * Math.PI * 52; // Umfang des Timer-Rings (r = 52)

const $ = (id) => document.getElementById(id);
const store = createStore();
const settings = () => store.data.settings;

const nf = new Intl.NumberFormat('de-DE');
const nf1 = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const dtf = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

const fmtSec = (ms) => `${nf1.format(ms / 1000)} s`;
const fmtPct = (a, b) => (b > 0 ? `${Math.round((100 * a) / b)} %` : '–');

/** Animationsklasse neu starten (auch bei schnellen Wiederholungen). */
function replay(el, cls) {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

/* =====================================================================
   Sichtbarer Viewport (Zahlentastatur)
   ===================================================================== */
let vvQueued = false;
function syncViewport() {
  vvQueued = false;
  const vv = window.visualViewport;
  const layoutH = document.documentElement.clientHeight || window.innerHeight;
  const h = vv ? vv.height : window.innerHeight;
  const top = vv ? Math.max(0, vv.offsetTop) : 0;
  const rs = document.documentElement.style;
  rs.setProperty('--vvh', `${Math.round(h)}px`);
  rs.setProperty('--vvt', `${Math.round(top)}px`);
  // Tastatur gilt als offen, wenn der sichtbare Bereich deutlich kleiner ist als das Layout.
  document.body.classList.toggle('kb-open', layoutH - h > 150);
}
function queueViewportSync() {
  if (!vvQueued) {
    vvQueued = true;
    requestAnimationFrame(syncViewport);
  }
}
window.visualViewport?.addEventListener('resize', queueViewportSync);
window.visualViewport?.addEventListener('scroll', queueViewportSync);
window.addEventListener('resize', queueViewportSync);
window.addEventListener('orientationchange', () => setTimeout(syncViewport, 300));

/* =====================================================================
   Töne (Web Audio) – Ersatz für Haptik, erst nach Nutzergeste aktiv
   ===================================================================== */
const sound = {
  ctx: null,
  /** Muss in einem Klick-Handler aufgerufen werden (iOS-Autoplay-Regeln). */
  unlock() {
    if (!settings().sound) return;
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
      }
      if (this.ctx.state !== 'running') this.ctx.resume();
      // Stiller Puffer schaltet Audio auf älteren iOS-Versionen frei.
      const src = this.ctx.createBufferSource();
      src.buffer = this.ctx.createBuffer(1, 1, 22050);
      src.connect(this.ctx.destination);
      src.start(0);
    } catch {
      /* Audio ist optional */
    }
  },
  tone(freq, dur, { type = 'sine', gain = 0.05, delay = 0, slide } = {}) {
    if (!settings().sound || !this.ctx || this.ctx.state !== 'running') return;
    try {
      const t = this.ctx.currentTime + delay;
      const osc = this.ctx.createOscillator();
      const amp = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t);
      if (slide) osc.frequency.exponentialRampToValueAtTime(slide, t + dur);
      amp.gain.setValueAtTime(0.0001, t);
      amp.gain.exponentialRampToValueAtTime(gain, t + 0.012);
      amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(amp).connect(this.ctx.destination);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    } catch {
      /* ignorieren */
    }
  },
  ok() {
    this.tone(880, 0.09, { gain: 0.045 });
    this.tone(1318.5, 0.14, { gain: 0.035, delay: 0.055 });
  },
  bad() {
    this.tone(220, 0.16, { type: 'triangle', gain: 0.06, slide: 170 });
  },
  end() {
    [523.25, 659.25, 783.99].forEach((f, i) => this.tone(f, 0.38, { gain: 0.035, delay: i * 0.09 }));
  },
};

/* =====================================================================
   Bildschirm wach halten (Screen Wake Lock, iOS 16.4+), still bei Fehlern
   ===================================================================== */
const wake = {
  lock: null,
  async acquire() {
    try {
      if (!('wakeLock' in navigator) || document.visibilityState !== 'visible' || this.lock) return;
      this.lock = await navigator.wakeLock.request('screen');
      this.lock.addEventListener?.('release', () => {
        this.lock = null;
      });
    } catch {
      this.lock = null; // nicht unterstützt oder verweigert – kein Problem
    }
  },
  async release() {
    const l = this.lock;
    this.lock = null;
    try {
      await l?.release();
    } catch {
      /* ignorieren */
    }
  },
};

/* =====================================================================
   Navigation
   ===================================================================== */
function showView(id) {
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('is-active', v.id === id));
  document.querySelectorAll('.tab').forEach((t) => {
    const active = t.dataset.view === id;
    t.classList.toggle('is-active', active);
    if (active) t.setAttribute('aria-current', 'page');
    else t.removeAttribute('aria-current');
  });
  if (id === 'view-stats') renderStats();
  if (id === 'view-train') renderTrain();
  if (id === 'view-settings') renderSettings();
}

document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => showView(t.dataset.view)));

/* =====================================================================
   Training (Startansicht)
   ===================================================================== */
function buildTrain() {
  const grid = $('mode-grid');
  for (const [key, m] of Object.entries(MODES)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mode';
    b.setAttribute('role', 'radio');
    b.dataset.mode = key;
    b.innerHTML = `<span class="sym" aria-hidden="true">${m.symbol}</span><span class="name">${m.name}</span>`;
    b.addEventListener('click', () => {
      store.updateSettings({ mode: key });
      renderTrain();
    });
    grid.append(b);
  }
  const seg = $('level-seg');
  for (const lvl of [1, 2, 3, 4]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.dataset.level = String(lvl);
    b.textContent = String(lvl);
    b.setAttribute('aria-label', `Level ${lvl}: ${LEVEL_META[lvl].name}`);
    b.addEventListener('click', () => {
      store.updateSettings({ level: lvl });
      renderTrain();
    });
    seg.append(b);
  }
}

function renderTrain() {
  const s = settings();
  document.querySelectorAll('#mode-grid .mode').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === s.mode)));
  document.querySelectorAll('#level-seg button').forEach((b) => b.setAttribute('aria-checked', String(Number(b.dataset.level) === s.level)));
  const meta = LEVEL_META[s.level];
  const desc = $('level-desc');
  desc.replaceChildren();
  const strong = document.createElement('strong');
  strong.textContent = meta.name;
  desc.append(strong, ` – ${meta.desc}`);
  const hs = store.highscore(s.mode, s.level);
  $('sum-record').textContent = hs ? nf.format(hs) : '–';
  $('sum-time').textContent = `${s.startTime} s`;
  $('sum-bonus').textContent = s.bonus ? `+${nf.format(s.bonus)} s` : 'aus';
  $('daily-count').textContent = String(store.currentDailyStreak());
}

/* =====================================================================
   Spiel
   ===================================================================== */
const answer = $('answer');
const g = {
  running: false,
  paused: false,
  mode: 'add',
  level: 1,
  startMs: 0, // Startzeit in ms
  bonusMs: 0, // Bonus pro richtiger Antwort in ms
  endAt: 0, // performance.now()-Zeitpunkt, an dem die Zeit abläuft
  remaining: 0, // Restzeit beim Pausieren
  earned: 0, // insgesamt gutgeschriebener Bonus
  task: null,
  shownAt: 0,
  taskAccum: 0, // Bearbeitungszeit der aktuellen Aufgabe vor einer Pause
  score: 0,
  correct: 0,
  wrong: 0,
  skipped: 0,
  streak: 0,
  bestStreak: 0,
  answerMs: 0,
  raf: 0,
  lastSec: -1,
};

function startGame() {
  // Alles hier läuft synchron im Klick-Handler → Fokus und Audio sind erlaubt.
  sound.unlock();
  const s = settings();
  Object.assign(g, {
    running: true,
    paused: false,
    mode: s.mode,
    level: s.level,
    startMs: s.startTime * 1000,
    bonusMs: s.bonus * 1000,
    remaining: s.startTime * 1000,
    earned: 0,
    task: null,
    score: 0,
    correct: 0,
    wrong: 0,
    skipped: 0,
    streak: 0,
    bestStreak: 0,
    answerMs: 0,
    lastSec: -1,
  });
  $('result').hidden = true;
  $('pause').hidden = true;
  $('toast').hidden = true;
  document.body.classList.add('in-game');
  $('game').hidden = false;
  answer.value = '';
  answer.classList.remove('ok', 'bad', 'shake');
  $('g-solution').classList.remove('show');
  syncViewport();
  nextTask();
  updateHud();
  answer.focus({ preventScroll: true });
  g.endAt = performance.now() + g.remaining;
  renderTime(g.remaining);
  wake.acquire();
  cancelAnimationFrame(g.raf);
  g.raf = requestAnimationFrame(frame);
}

function frame() {
  if (!g.running || g.paused) return;
  const rem = g.endAt - performance.now();
  if (rem <= 0) {
    renderTime(0);
    finish();
    return;
  }
  renderTime(rem);
  g.raf = requestAnimationFrame(frame);
}

function renderTime(rem) {
  const sec = Math.ceil(rem / 1000);
  if (sec !== g.lastSec) {
    g.lastSec = sec;
    $('g-time').textContent = String(sec);
    const ring = $('ring');
    ring.classList.toggle('warn', sec <= 10 && sec > 5);
    ring.classList.toggle('danger', sec <= 5);
  }
  const frac = Math.max(0, Math.min(1, rem / g.startMs));
  $('ring-bar').style.strokeDashoffset = String(RING_C * (1 - frac));
}

function nextTask() {
  g.task = generateTask(g.mode, g.level, g.task?.key ?? null);
  const el = $('g-task');
  el.textContent = g.task.text;
  el.classList.toggle('long', g.task.text.length > 11);
  g.shownAt = performance.now();
  g.taskAccum = 0;
}

function updateHud() {
  $('g-score').textContent = nf.format(g.score);
  const mult = streakMultiplier(g.streak);
  const chip = $('g-streak');
  chip.textContent = `×${nf.format(mult)}`;
  chip.classList.toggle('hot', mult > 1);
  chip.setAttribute('aria-label', `Serie ${g.streak}, Faktor ${nf.format(mult)}`);
}

function onInput() {
  const digits = answer.value.replace(/\D+/g, '');
  if (digits !== answer.value) answer.value = digits;
  answer.classList.remove('bad');
  if (!g.running || g.paused || !digits) return;
  // Automatische Prüfung, sobald die Stellenzahl der Lösung erreicht ist.
  if (digits.length >= String(g.task.answer).length) submit();
}

function submit() {
  if (!g.running || g.paused) return;
  const v = answer.value;
  if (!v) {
    replay(answer, 'shake');
    return;
  }
  if (Number(v) === g.task.answer) onCorrect();
  else onWrong();
}

function onCorrect() {
  const now = performance.now();
  g.answerMs += g.taskAccum + (now - g.shownAt);
  g.correct += 1;
  g.streak += 1;
  g.bestStreak = Math.max(g.bestStreak, g.streak);
  const pts = pointsFor(g.level, g.streak);
  g.score += pts;
  if (g.bonusMs > 0) {
    g.endAt += g.bonusMs;
    g.earned += g.bonusMs;
    const fb = $('g-bonus');
    fb.textContent = `+${nf.format(g.bonusMs / 1000)} s`;
    replay(fb, 'go');
  }
  const fp = $('g-pts');
  fp.textContent = `+${pts}`;
  replay(fp, 'go');
  replay($('g-task'), 'flash-ok');
  answer.classList.remove('bad', 'shake');
  answer.classList.add('ok');
  setTimeout(() => answer.classList.remove('ok'), 260);
  sound.ok();
  answer.value = '';
  nextTask();
  updateHud();
}

function onWrong() {
  g.wrong += 1;
  g.streak = 0;
  answer.value = '';
  answer.classList.add('bad');
  replay(answer, 'shake');
  sound.bad();
  updateHud();
}

let solutionTimer = 0;
function skip() {
  if (!g.running || g.paused) return;
  g.skipped += 1;
  g.streak = 0;
  const sol = $('g-solution');
  sol.textContent = `${g.task.text} = ${nf.format(g.task.answer)}`;
  sol.classList.add('show');
  clearTimeout(solutionTimer);
  solutionTimer = setTimeout(() => sol.classList.remove('show'), 1600);
  answer.value = '';
  answer.classList.remove('bad');
  nextTask();
  updateHud();
}

function pause() {
  if (!g.running || g.paused) return;
  const now = performance.now();
  g.paused = true;
  g.remaining = Math.max(0, g.endAt - now);
  g.taskAccum += now - g.shownAt;
  cancelAnimationFrame(g.raf);
  answer.blur();
  $('pause-time').textContent = `Noch ${Math.ceil(g.remaining / 1000)} s · ${nf.format(g.score)} Punkte`;
  $('pause').hidden = false;
  wake.release();
}

function resume() {
  if (!g.running || !g.paused) return;
  $('pause').hidden = true;
  answer.focus({ preventScroll: true }); // synchron im Klick-Handler
  sound.unlock();
  const now = performance.now();
  g.paused = false;
  g.endAt = now + g.remaining;
  g.shownAt = now;
  wake.acquire();
  g.raf = requestAnimationFrame(frame);
}

function exitGame() {
  g.running = false;
  g.paused = false;
  cancelAnimationFrame(g.raf);
  wake.release();
  answer.blur();
  $('game').hidden = true;
  $('pause').hidden = true;
  $('result').hidden = true;
  document.body.classList.remove('in-game');
  renderTrain();
  if (pendingWorker) showUpdateToast();
}

function finish() {
  const now = performance.now();
  const remaining = g.paused ? g.remaining : Math.max(0, g.endAt - now);
  g.running = false;
  g.paused = false;
  cancelAnimationFrame(g.raf);
  wake.release();
  answer.blur();
  $('pause').hidden = true;

  // Abgebrochene Runde ohne jede Antwort wird nicht gespeichert.
  if (g.correct + g.wrong + g.skipped === 0) {
    exitGame();
    return;
  }

  const round = {
    mode: g.mode,
    level: g.level,
    score: g.score,
    correct: g.correct,
    wrong: g.wrong,
    skipped: g.skipped,
    answerMs: g.answerMs,
    duration: g.startMs + g.earned - remaining,
  };
  const { isRecord, previousBest } = store.recordRound(round);
  sound.end();
  showResult(round, isRecord, previousBest);
}

function showResult(r, isRecord, previousBest) {
  $('res-mode').textContent = `${MODES[r.mode].name} · ${LEVEL_META[r.level].name}`;
  $('res-score').textContent = nf.format(r.score);
  const record = isRecord && r.score > 0;
  $('res-record').hidden = !record;
  $('res-best').textContent = record
    ? previousBest
      ? `Bisheriger Rekord: ${nf.format(previousBest)}`
      : 'Erster Rekord in dieser Kategorie'
    : `Rekord: ${nf.format(store.highscore(r.mode, r.level))}`;
  $('res-correct').textContent = String(r.correct);
  $('res-acc').textContent = fmtPct(r.correct, r.correct + r.wrong);
  $('res-avg').textContent = r.correct ? fmtSec(r.answerMs / r.correct) : '–';
  $('res-streak').textContent = String(g.bestStreak);
  $('result').hidden = false;
}

/* --- Ereignisse im Spiel --- */
answer.addEventListener('input', onInput);
answer.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    submit();
  }
});
// Fokus halten: geht er verloren (z. B. Tipp auf freie Fläche), sofort zurückholen.
answer.addEventListener('blur', () => {
  setTimeout(() => {
    if (g.running && !g.paused && document.activeElement !== answer) answer.focus({ preventScroll: true });
  }, 0);
});
// Tipps auf Spiel-Buttons und freie Flächen sollen den Fokus nicht vom Eingabefeld nehmen.
$('game').addEventListener('pointerdown', (e) => {
  if (e.target !== answer) e.preventDefault();
});
$('game').addEventListener('mousedown', (e) => {
  if (e.target !== answer) e.preventDefault();
});
$('game').addEventListener('click', (e) => {
  // Jeder Tipp ist eine Nutzergeste → Fokus garantiert wieder setzen.
  if (g.running && !g.paused && e.target.closest('#btn-pause') == null) answer.focus({ preventScroll: true });
});
$('game').addEventListener('contextmenu', (e) => e.preventDefault());

$('btn-start').addEventListener('click', startGame);
$('btn-check').addEventListener('click', submit);
$('btn-skip').addEventListener('click', skip);
$('btn-pause').addEventListener('click', pause);
$('btn-resume').addEventListener('click', resume);
$('btn-quit').addEventListener('click', finish);
$('btn-again').addEventListener('click', startGame);
$('btn-done').addEventListener('click', exitGame);

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    pause();
  } else {
    swReg?.update().catch(() => {});
    if (!g.running) renderTrain(); // Tages-Serie kann sich über Nacht geändert haben
  }
});
window.addEventListener('pagehide', pause);

/* =====================================================================
   Statistik
   ===================================================================== */
let chartFilter = 'all';

function renderStats() {
  const d = store.data;
  const t = d.totals;
  $('st-solved').textContent = nf.format(t.correct);
  $('st-acc').textContent = fmtPct(t.correct, t.correct + t.wrong);
  $('st-avg').textContent = t.correct ? fmtSec(t.answerMs / t.correct) : '–';
  $('st-daily').textContent = String(store.currentDailyStreak());
  $('st-daily-best').textContent = d.daily.best ? `Bestwert: ${d.daily.best}` : '';

  const s = settings();
  $('chart-filter-current').textContent = `${MODES[s.mode].symbol} L${s.level}`;
  $('chart-filter-current').setAttribute('aria-label', `Aktuell: ${MODES[s.mode].name}, Level ${s.level}`);
  document
    .querySelectorAll('#chart-filter button')
    .forEach((b) => b.setAttribute('aria-checked', String(b.dataset.filter === chartFilter)));
  const rounds = chartFilter === 'all' ? d.history : d.history.filter((h) => h.mode === s.mode && h.level === s.level);
  renderChart(rounds.slice(-30));
  renderRecords();
  renderHistory(d.history.slice(-20).reverse());
}

document.querySelectorAll('#chart-filter button').forEach((b) =>
  b.addEventListener('click', () => {
    chartFilter = b.dataset.filter;
    renderStats();
  }),
);

/** Kleines, selbst gezeichnetes SVG-Liniendiagramm. */
function renderChart(rounds) {
  const box = $('chart');
  if (!rounds.length) {
    box.innerHTML = '<p class="empty">Noch keine Runden – starte dein erstes Training.</p>';
    return;
  }
  const W = 320;
  const H = 150;
  const P = { l: 34, r: 10, t: 10, b: 22 };
  const max = Math.max(...rounds.map((r) => r.score), 10);
  const yMax = niceCeil(max);
  const x = (i) => (rounds.length === 1 ? (P.l + W - P.r) / 2 : P.l + (i * (W - P.l - P.r)) / (rounds.length - 1));
  const y = (v) => H - P.b - (v / yMax) * (H - P.t - P.b);
  const pts = rounds.map((r, i) => [x(i), y(r.score)]);
  const line = pts.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)} ${py.toFixed(1)}`).join(' ');
  const area = `${line} L${pts.at(-1)[0].toFixed(1)} ${y(0)} L${pts[0][0].toFixed(1)} ${y(0)} Z`;
  const bestIdx = rounds.reduce((bi, r, i) => (r.score > rounds[bi].score ? i : bi), 0);

  const grid = [0, yMax / 2, yMax]
    .map(
      (v) =>
        `<line class="grid-line" x1="${P.l}" x2="${W - P.r}" y1="${y(v)}" y2="${y(v)}"/>` +
        `<text class="axis-label" x="${P.l - 6}" y="${y(v) + 3}" text-anchor="end">${nf.format(v)}</text>`,
    )
    .join('');
  const dots = pts
    .map(([px, py], i) => `<circle class="dot${i === bestIdx ? ' best' : ''}" cx="${px}" cy="${py}" r="${i === bestIdx ? 4 : 3}"/>`)
    .join('');
  const first = new Date(rounds[0].ts);
  const last = new Date(rounds.at(-1).ts);
  const dshort = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit' });

  box.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Score der letzten ${rounds.length} Runden, bester Wert ${nf.format(rounds[bestIdx].score)}">
      <defs>
        <linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="currentColor" stop-opacity="0.28"/>
          <stop offset="1" stop-color="currentColor" stop-opacity="0"/>
        </linearGradient>
      </defs>
      ${grid}
      <path d="${area}" fill="url(#chart-fill)"/>
      <path class="line" d="${line}"/>
      ${dots}
      <text class="axis-label" x="${P.l}" y="${H - 6}">${dshort.format(first)}</text>
      <text class="axis-label" x="${W - P.r}" y="${H - 6}" text-anchor="end">${dshort.format(last)}</text>
    </svg>`;
}

function niceCeil(v) {
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

function renderRecords() {
  const table = $('records');
  table.replaceChildren();
  const head = table.insertRow();
  for (const label of ['Modus', 'L1', 'L2', 'L3', 'L4']) {
    const th = document.createElement('th');
    th.textContent = label;
    head.append(th);
  }
  for (const [key, m] of Object.entries(MODES)) {
    const row = table.insertRow();
    row.insertCell().textContent = m.name;
    for (const lvl of [1, 2, 3, 4]) {
      const hs = store.highscore(key, lvl);
      const td = row.insertCell();
      td.textContent = hs ? nf.format(hs) : '–';
      if (!hs) td.className = 'none';
    }
  }
}

function renderHistory(list) {
  const ol = $('history');
  ol.replaceChildren();
  if (!list.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Noch keine Runden.';
    ol.append(li);
    return;
  }
  for (const h of list) {
    const li = document.createElement('li');
    const title = document.createElement('span');
    title.className = 'h-title';
    title.textContent = `${MODES[h.mode]?.name ?? '?'} · ${LEVEL_META[h.level]?.name ?? ''}`;
    const meta = document.createElement('span');
    meta.className = 'h-meta';
    meta.textContent = `${dtf.format(new Date(h.ts))} · ${h.correct} richtig · ${fmtPct(h.correct, h.correct + h.wrong)}`;
    const score = document.createElement('span');
    score.className = 'h-score';
    score.textContent = nf.format(h.score);
    li.append(title, score, meta);
    ol.append(li);
  }
}

/* =====================================================================
   Einstellungen
   ===================================================================== */
let customTime = false; // "Frei" gewählt, auch wenn die Zeit einem Preset entspricht

function renderSettings() {
  const s = settings();
  const isPreset = PRESET_TIMES.includes(s.startTime) && !customTime;
  document.querySelectorAll('#time-seg button').forEach((b) => {
    const on = b.dataset.time === 'custom' ? !isPreset : isPreset && Number(b.dataset.time) === s.startTime;
    b.setAttribute('aria-checked', String(on));
  });
  $('custom-time-row').hidden = isPreset;
  if (document.activeElement !== $('custom-time')) $('custom-time').value = String(s.startTime);
  document
    .querySelectorAll('#bonus-seg button')
    .forEach((b) => b.setAttribute('aria-checked', String(Number(b.dataset.bonus) === s.bonus)));
  $('sound-toggle').checked = s.sound;
  $('app-version').textContent = `Version ${APP_VERSION}`;
}

document.querySelectorAll('#time-seg button').forEach((b) =>
  b.addEventListener('click', () => {
    if (b.dataset.time === 'custom') {
      customTime = true;
      renderSettings();
      $('custom-time').focus();
      $('custom-time').select();
      return;
    }
    customTime = false;
    store.updateSettings({ startTime: Number(b.dataset.time) });
    renderSettings();
  }),
);

function commitCustomTime() {
  const field = $('custom-time');
  const v = parseInt(field.value.replace(/\D/g, ''), 10);
  if (Number.isFinite(v)) store.updateSettings({ startTime: Math.min(600, Math.max(10, v)) });
  field.value = String(settings().startTime);
  renderSettings();
}
$('custom-time').addEventListener('input', (e) => {
  e.target.value = e.target.value.replace(/\D/g, '').slice(0, 3);
});
$('custom-time').addEventListener('change', commitCustomTime);
$('custom-time').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') e.target.blur();
});

document.querySelectorAll('#bonus-seg button').forEach((b) =>
  b.addEventListener('click', () => {
    store.updateSettings({ bonus: Number(b.dataset.bonus) });
    renderSettings();
  }),
);

$('sound-toggle').addEventListener('change', (e) => {
  store.updateSettings({ sound: e.target.checked });
  if (e.target.checked) {
    sound.unlock();
    sound.ok(); // Hörprobe
  }
});

/* --- Daten --- */
$('btn-export').addEventListener('click', async () => {
  const json = store.exportJSON();
  const name = `kopfrechnen-${dayKey()}.json`;
  const file = new File([json], name, { type: 'application/json' });
  // iOS: Teilen-Menü ("In Dateien sichern") ist am komfortabelsten.
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Kopfrechnen-Daten' });
      return;
    } catch (err) {
      if (err?.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  toast('Export erstellt');
});

$('import-file').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  try {
    store.importJSON(await file.text());
    customTime = false;
    renderAll();
    toast('Daten importiert');
  } catch (err) {
    toast(`Import fehlgeschlagen: ${err.message}`);
  }
});

$('btn-reset').addEventListener('click', () => {
  $('confirm').hidden = false;
});
$('btn-cancel-reset').addEventListener('click', () => {
  $('confirm').hidden = true;
});
$('btn-confirm-reset').addEventListener('click', () => {
  store.reset();
  customTime = false;
  $('confirm').hidden = true;
  renderAll();
  toast('Alle Daten gelöscht');
});
$('confirm').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) $('confirm').hidden = true;
});

/* =====================================================================
   Toast
   ===================================================================== */
let toastTimer = 0;
function toast(msg, action) {
  const el = $('toast');
  el.replaceChildren();
  const span = document.createElement('span');
  span.textContent = msg;
  el.append(span);
  if (action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = action.label;
    b.addEventListener('click', action.run);
    el.append(b);
  }
  el.hidden = false;
  clearTimeout(toastTimer);
  if (!action) toastTimer = setTimeout(() => (el.hidden = true), 2800);
}

/* =====================================================================
   Service Worker: Offline-Betrieb und sauberes Update
   ===================================================================== */
let swReg = null;
let pendingWorker = null;
let updateRequested = false;

function showUpdateToast() {
  if (g.running || !pendingWorker) return; // nie mitten in einer Runde
  toast('Neue Version verfügbar', {
    label: 'Aktualisieren',
    run: () => {
      updateRequested = true;
      pendingWorker.postMessage({ type: 'SKIP_WAITING' });
    },
  });
}

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', async () => {
    try {
      swReg = await navigator.serviceWorker.register('./sw.js');
      const offer = (w) => {
        if (!w || !navigator.serviceWorker.controller) return; // Erstinstallation: kein Hinweis nötig
        pendingWorker = w;
        showUpdateToast();
      };
      if (swReg.waiting) offer(swReg.waiting);
      swReg.addEventListener('updatefound', () => {
        const w = swReg.installing;
        w?.addEventListener('statechange', () => {
          if (w.state === 'installed') offer(w);
        });
      });
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (updateRequested) location.reload();
      });
    } catch (err) {
      console.warn('Service Worker nicht registriert:', err);
    }
  });
}

/* =====================================================================
   Start
   ===================================================================== */
function renderAll() {
  renderTrain();
  renderSettings();
  if ($('view-stats').classList.contains('is-active')) renderStats();
}

buildTrain();
syncViewport();
renderAll();

// Lesezugriff für automatisierte Tests (keine Schreibrechte, keine Logik).
Object.defineProperty(window, '__kopfrechnen', {
  value: Object.freeze({
    state: () => ({ running: g.running, paused: g.paused, score: g.score, correct: g.correct, task: g.task && { ...g.task } }),
    version: APP_VERSION,
  }),
});
