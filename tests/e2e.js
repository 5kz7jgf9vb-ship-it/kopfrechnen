/**
 * End-to-End-Tests mit Playwright (WebKit) in iPhone-Emulation: `npm run test:e2e`
 *
 * Simuliert Safe-Areas (über die CSS-Variablen --sat/--sab/...), die Zahlentastatur
 * (verkleinerter Viewport), Hell-/Dunkelmodus und Querformat. Screenshots landen in
 * screenshots/. Echte iOS-Eigenheiten (Tastatur, Wake Lock, Glas-Rendering) lassen
 * sich nur auf einem echten iPhone prüfen.
 */
import { webkit, chromium, devices } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { startServer } from '../tools/serve.js';

const SHOTS = new URL('../screenshots/', import.meta.url);
await mkdir(SHOTS, { recursive: true });

/* Geräteprofile: Home-Bildschirm-Modus (volle Höhe, Safe-Areas) und Safari (Toolbars, Tastatur mit Zubehörleiste). */
const PROFILES = [
  { name: '15pro-standalone', device: 'iPhone 15 Pro', vp: [393, 852], safe: { t: 59, b: 34 }, kb: 291 },
  { name: '13mini-standalone', device: 'iPhone 13 Mini', vp: [375, 812], safe: { t: 50, b: 34 }, kb: 291 },
  { name: 'se-standalone', device: 'iPhone SE (3rd gen)', vp: [375, 667], safe: { t: 20, b: 0 }, kb: 216 },
  { name: 'se-safari', device: 'iPhone SE (3rd gen)', vp: null, safe: { t: 0, b: 0 }, kb: 216 + 44 },
  { name: '15pro-safari', device: 'iPhone 15 Pro', vp: null, safe: { t: 0, b: 0 }, kb: 291 + 44 },
];

let failures = 0;
const results = [];
function check(cond, msg) {
  if (!cond) {
    failures++;
    results.push(`  ✗ ${msg}`);
  }
  return cond;
}

const server = await startServer(0);
const BASE = `http://127.0.0.1:${server.address().port}/`;

const browser = await webkit.launch();

async function newPage(profile, colorScheme, extra = {}) {
  const d = devices[profile.device];
  const ctxOpts = { ...d, colorScheme, serviceWorkers: 'block', ...extra };
  if (profile.vp) ctxOpts.viewport = { width: profile.vp[0], height: profile.vp[1] };
  delete ctxOpts.defaultBrowserType;
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(BASE);
  await page.addStyleTag({
    content: `:root{--sat:${profile.safe.t}px !important;--sab:${profile.safe.b}px !important;--sal:0px !important;--sar:0px !important}`,
  });
  await page.waitForTimeout(350);
  return { ctx, page, errors };
}

/** Prüft: kein horizontales Scrollen, sichtbare Bedienelemente innerhalb der Safe-Area, Touch-Ziele ≥ 44 pt. */
async function layoutChecks(page, profile, label, { bottomLimit } = {}) {
  const r = await page.evaluate(
    ({ safe, bottomLimit }) => {
      const W = window.innerWidth;
      const H = window.innerHeight;
      const bottom = bottomLimit ?? H - safe.b;
      const out = { hScroll: [], outside: [], small: [] };
      if (document.documentElement.scrollWidth > W + 0.5) out.hScroll.push(`document ${document.documentElement.scrollWidth}>${W}`);
      document.querySelectorAll('.view-scroll, .game, .overlay').forEach((el) => {
        if (el.offsetParent !== null || getComputedStyle(el).position === 'fixed') {
          if (el.scrollWidth > el.clientWidth + 0.5 && el.clientWidth > 0) out.hScroll.push(`${el.className} ${el.scrollWidth}>${el.clientWidth}`);
        }
      });
      const visible = (el) => {
        const s = getComputedStyle(el);
        const rc = el.getBoundingClientRect();
        if (s.visibility === 'hidden' || s.display === 'none' || rc.width === 0 || rc.height === 0) return null;
        // im eigenen Scroll-Container nicht sichtbar → nicht prüfen
        const sc = el.closest('.view-scroll');
        if (sc) {
          const sr = sc.getBoundingClientRect();
          if (rc.bottom <= sr.top || rc.top >= sr.bottom) return null;
        }
        return rc;
      };
      const name = (el) => el.id || el.textContent.trim().slice(0, 20) || el.className;
      document.querySelectorAll('button, input:not([type=file]):not(.sr-only), label.btn, .switch').forEach((el) => {
        if (el.closest('[hidden]') || el.closest('#app') && document.body.classList.contains('in-game')) return;
        if (el.matches('.switch input')) return;
        const rc = visible(el);
        if (!rc) return;
        const inScroll = el.closest('.view-scroll');
        // Inhalte in Scroll-Containern dürfen unter die Statusleiste scrollen, Startposition wird separat geprüft.
        if (!inScroll && (rc.top < safe.t - 0.5 || rc.bottom > bottom + 0.5 || rc.left < -0.5 || rc.right > W + 0.5)) {
          out.outside.push(`${name(el)} [${Math.round(rc.top)}..${Math.round(rc.bottom)}] limit ${safe.t}..${Math.round(bottom)}`);
        }
        if (rc.width < 43.5 || rc.height < 43.5) out.small.push(`${name(el)} ${Math.round(rc.width)}x${Math.round(rc.height)}`);
      });
      // Erste Überschrift beginnt unterhalb der Statusleiste
      const h1 = [...document.querySelectorAll('.view.is-active h1')][0];
      if (h1 && !document.body.classList.contains('in-game')) {
        const t = h1.getBoundingClientRect().top;
        if (t < safe.t) out.outside.push(`h1 top ${t} < ${safe.t}`);
      }
      return out;
    },
    { safe: profile.safe, bottomLimit },
  );
  check(!r.hScroll.length, `${label}: horizontales Scrollen ${r.hScroll.join(', ')}`);
  check(!r.outside.length, `${label}: außerhalb Safe-Area/sichtbarem Bereich: ${r.outside.join(' | ')}`);
  check(!r.small.length, `${label}: Touch-Ziel < 44pt: ${r.small.join(', ')}`);
}

const state = (page) => page.evaluate(() => window.__kopfrechnen.state());
const shot = async (page, file) => {
  await page.waitForTimeout(450); // Einblend-Animationen abwarten
  await page.screenshot({ path: fileURLToPath(new URL(file, SHOTS)), animations: 'disabled' });
};

for (const profile of PROFILES) {
  for (const scheme of ['light', 'dark']) {
    const label = `${profile.name}/${scheme}`;
    const { ctx, page, errors } = await newPage(profile, scheme);
    const [W, H] = [page.viewportSize().width, page.viewportSize().height];

    // --- Tabs ---
    await layoutChecks(page, profile, `${label} Training`);
    await shot(page, `${profile.name}-${scheme}-1-training.png`);
    // Start-Button im unteren Drittel (daumenfreundlich)
    const startBox = await page.locator('#btn-start').boundingBox();
    check(startBox.y > H * 0.6, `${label}: Start-Button nicht im unteren Drittel (y=${Math.round(startBox.y)} von ${H})`);
    const tabBox = await page.locator('.tabbar').boundingBox();
    check(tabBox.y + tabBox.height <= H - profile.safe.b + 0.5, `${label}: Tab-Leiste unter Home-Indikator`);
    check(startBox.y + startBox.height <= tabBox.y, `${label}: Start-Button überlappt Tab-Leiste`);

    await page.click('.tab[data-view="view-stats"]');
    await layoutChecks(page, profile, `${label} Statistik`);
    await page.click('.tab[data-view="view-settings"]');
    await layoutChecks(page, profile, `${label} Einstellungen`);
    if (profile.name === '15pro-standalone') await shot(page, `${profile.name}-${scheme}-3-settings.png`);
    await page.click('.tab[data-view="view-train"]');

    // --- Runde starten: Fokus muss sofort im Eingabefeld liegen ---
    await page.click('#mode-grid [data-mode="mul"]');
    await page.click('#level-seg [data-level="2"]');
    await page.click('#btn-start');
    check(await page.evaluate(() => document.activeElement?.id === 'answer'), `${label}: Eingabefeld nach Start nicht fokussiert`);
    const attrs = await page.locator('#answer').evaluate((el) => ({
      im: el.getAttribute('inputmode'), pat: el.pattern, ac: el.getAttribute('autocomplete'), ek: el.getAttribute('enterkeyhint'), fs: parseFloat(getComputedStyle(el).fontSize),
    }));
    check(attrs.im === 'numeric' && attrs.pat === '[0-9]*' && attrs.ac === 'off' && attrs.ek === 'done', `${label}: Eingabe-Attribute ${JSON.stringify(attrs)}`);
    check(attrs.fs >= 16, `${label}: Schrift im Eingabefeld < 16px`);

    // Tastatur simulieren: sichtbarer Bereich wird um die Tastaturhöhe kleiner.
    await page.setViewportSize({ width: W, height: H - profile.kb });
    await page.waitForTimeout(200);
    await layoutChecks(page, { ...profile, safe: { ...profile.safe, b: 0 } }, `${label} Spiel+Tastatur`, { bottomLimit: H - profile.kb });
    const vis = await page.evaluate(() =>
      ['#g-task', '#answer', '#btn-check', '#btn-skip', '#g-time', '#g-score'].map((s) => {
        const r = document.querySelector(s).getBoundingClientRect();
        return { s, top: r.top, bottom: r.bottom, h: innerHeight };
      }),
    );
    for (const v of vis) check(v.top >= 0 && v.bottom <= v.h + 0.5, `${label}: ${v.s} bei Tastatur nicht sichtbar (${Math.round(v.top)}..${Math.round(v.bottom)} / ${v.h})`);
    const ringSize = await page.locator('#ring').boundingBox();
    check(ringSize.height >= 50, `${label}: Timer-Ring zu klein (${Math.round(ringSize.height)})`);
    await shot(page, `${profile.name}-${scheme}-2-game-keyboard.png`);

    // Richtige Antwort: Punkte steigen, Zeitbonus, neue Aufgabe, Fokus bleibt
    let s0 = await state(page);
    const t0 = Number(await page.textContent('#g-time'));
    await page.keyboard.type(String(s0.task.answer));
    let s1 = await state(page);
    check(s1.correct === 1 && s1.score > 0, `${label}: richtige Antwort nicht gewertet`);
    check(s1.task.key !== s0.task.key, `${label}: neue Aufgabe fehlt`);
    await page.waitForTimeout(100);
    const t1 = Number(await page.textContent('#g-time'));
    check(t1 >= t0, `${label}: +1s Bonus nicht sichtbar (${t0} → ${t1})`);
    check(await page.evaluate(() => document.getElementById('answer').value === ''), `${label}: Eingabe nicht geleert`);

    // Falsche Antwort: Aufgabe bleibt, Shake
    const wrong = String((s1.task.answer + 1) % 10 ** String(s1.task.answer).length).padStart(String(s1.task.answer).length, '1');
    await page.keyboard.type(wrong === String(s1.task.answer) ? '9'.repeat(wrong.length) : wrong);
    const s2 = await state(page);
    check(s2.task.key === s1.task.key, `${label}: Aufgabe nach falscher Antwort gewechselt`);
    check(await page.locator('#answer.shake').count() === 1, `${label}: kein Shake bei falscher Antwort`);

    // Überspringen und Prüfen-Button halten den Fokus
    await page.click('#btn-skip');
    const s3 = await state(page);
    check(s3.task.key !== s2.task.key, `${label}: Überspringen ohne neue Aufgabe`);
    check(await page.evaluate(() => document.activeElement?.id === 'answer'), `${label}: Fokus nach Überspringen verloren`);
    await page.keyboard.type('1');
    await page.click('#btn-check');
    check(await page.evaluate(() => document.activeElement?.id === 'answer'), `${label}: Fokus nach Prüfen verloren`);

    // App-Wechsel: Timer pausiert
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    const tp = await page.textContent('#g-time');
    await page.waitForTimeout(1300);
    check((await page.textContent('#g-time')) === tp, `${label}: Timer läuft während Pause weiter`);
    check(await page.locator('#pause:not([hidden])').count() === 1, `${label}: Pause-Overlay fehlt`);
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.setViewportSize({ width: W, height: H });
    await layoutChecks(page, profile, `${label} Pause`);
    await page.click('#btn-resume');
    check(await page.evaluate(() => document.activeElement?.id === 'answer'), `${label}: Fokus nach Weiter verloren`);
    check(!(await state(page)).paused, `${label}: nach Weiter noch pausiert`);

    // Runde beenden → Ergebnis
    await page.click('#btn-pause');
    await page.click('#btn-quit');
    check(await page.locator('#result:not([hidden])').count() === 1, `${label}: Ergebnis-Screen fehlt`);
    await layoutChecks(page, profile, `${label} Ergebnis`);
    check((await page.textContent('#res-record')) && (await page.locator('#res-record:not([hidden])').count()) === 1, `${label}: Rekord-Hinweis fehlt`);
    await shot(page, `${profile.name}-${scheme}-4-result.png`);
    await page.click('#btn-again');
    check(await page.evaluate(() => document.activeElement?.id === 'answer' && window.__kopfrechnen.state().running), `${label}: "Nochmal" startet nicht mit Fokus`);
    await page.click('#btn-pause');
    await page.click('#btn-quit'); // ohne Antwort → wird verworfen
    check(await page.locator('#game[hidden]').count() === 1, `${label}: leere Runde nicht verworfen`);

    await page.click('.tab[data-view="view-stats"]');
    check(await page.locator('#chart svg').count() === 1, `${label}: Diagramm fehlt`);
    check(await page.locator('#history li').count() === 1, `${label}: Verlauf hat nicht genau 1 Eintrag`);
    await layoutChecks(page, profile, `${label} Statistik gefüllt`);
    await shot(page, `${profile.name}-${scheme}-5-stats.png`);

    // Querformat bleibt brauchbar
    if (profile.name === '15pro-standalone') {
      await page.setViewportSize({ width: H, height: W });
      await page.click('.tab[data-view="view-train"]');
      await page.click('#btn-start');
      await page.waitForTimeout(150);
      const land = await page.evaluate(() =>
        ['#g-task', '#answer', '#btn-check', '#ring'].every((s) => {
          const r = document.querySelector(s).getBoundingClientRect();
          return r.top >= 0 && r.bottom <= innerHeight && r.right <= innerWidth && r.height > 0;
        }),
      );
      check(land, `${label}: Querformat-Spiel nicht vollständig sichtbar`);
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${label}: Querformat scrollt horizontal`);
      await shot(page, `${profile.name}-${scheme}-6-landscape.png`);
    }

    check(!errors.length, `${label}: JS-Fehler: ${errors.join(' | ')}`);
    results.push(`${failures ? '…' : '✓'} ${label}`);
    await ctx.close();
  }
}

/* --- Voller Ablauf mit kurzer Zeit: Timer endet bei 0, kein Drift, Einstellungen bleiben gespeichert --- */
{
  const profile = PROFILES[0];
  const { ctx, page, errors } = await newPage(profile, 'dark', { reducedMotion: 'reduce' });
  await page.click('.tab[data-view="view-settings"]');
  await page.click('#time-seg [data-time="custom"]');
  await page.fill('#custom-time', '10');
  await page.press('#custom-time', 'Enter');
  await page.click('#bonus-seg [data-bonus="0"]');
  await page.reload();
  check((await page.evaluate(() => JSON.parse(localStorage.getItem('kopfrechnen.data')).settings.startTime)) === 10, 'Startzeit 10 s nicht gespeichert');
  await page.click('.tab[data-view="view-train"]');
  await page.click('#mode-grid [data-mode="pct"]');
  await page.click('#btn-start');
  const t0 = Date.now();
  for (let i = 0; i < 3; i++) {
    const s = await state(page);
    await page.keyboard.type(String(s.task.answer));
  }
  await page.locator('#result:not([hidden])').waitFor({ timeout: 15000 });
  const elapsed = (Date.now() - t0) / 1000;
  check(elapsed > 9.3 && elapsed < 11.5, `Rundendauer ${elapsed.toFixed(2)} s statt ~10 s (ohne Bonus)`);
  check((await page.textContent('#res-correct')) === '3', 'Ergebnis: 3 richtige erwartet');
  check((await page.textContent('#res-acc')) === '100 %', 'Ergebnis: Genauigkeit 100 % erwartet');
  // Export enthält die Runde
  const exported = await page.evaluate(() => JSON.parse(localStorage.getItem('kopfrechnen.data')));
  check(exported.history.length === 1 && exported.highscores['pct-1'] > 0, 'Runde nicht gespeichert');
  check(exported.daily.streak === 1, 'Tages-Streak nicht 1');
  check(!errors.length, `Vollrunde: JS-Fehler: ${errors.join(' | ')}`);
  results.push(`${failures ? '…' : '✓'} Vollrunde 10 s (reduced motion), Dauer ${elapsed.toFixed(2)} s`);
  await ctx.close();
}

await browser.close();

/* --- Service Worker / Offline (Chromium, da Playwright-WebKit unter Windows keine SW-Steuerung bietet) --- */
{
  const cb = await chromium.launch();
  const ctx = await cb.newContext();
  const page = await ctx.newPage();
  await page.goto(BASE);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  const controlled = await page.evaluate(() => !!navigator.serviceWorker.controller);
  check(controlled, 'Service Worker kontrolliert die Seite nicht');
  await ctx.setOffline(true);
  await page.reload();
  check((await page.textContent('#t-train')) === 'Training', 'App lädt offline nicht');
  await page.click('#btn-start');
  check(await page.evaluate(() => window.__kopfrechnen.state().running), 'Offline: Runde startet nicht');
  const manifest = await page.evaluate(() => fetch('manifest.json').then((r) => r.json()));
  check(manifest.display === 'standalone', 'Manifest display != standalone');
  results.push(`${failures ? '…' : '✓'} Service Worker & Offline (Chromium)`);
  await cb.close();
}

server.close();
console.log(results.join('\n'));
console.log(failures ? `\n${failures} Fehler` : '\nAlle E2E-Prüfungen bestanden.');
process.exit(failures ? 1 : 0);
