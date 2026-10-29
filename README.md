# Kopfrechnen – Training (PWA)

Kopfrechnen unter Zeitdruck, optimiert für das iPhone (Safari und Home-Bildschirm).
Vanilla HTML/CSS/JS ohne Build-Schritt, alle Daten lokal im Browser.

## Struktur

| Datei | Inhalt |
|---|---|
| `index.html` | Oberfläche (Training, Statistik, Einstellungen, Spiel, Dialoge) |
| `styles.css` | Liquid-Glass-Design, Hell/Dunkel, Safe-Areas, Tastatur-Layout |
| `app.js` | Spielablauf, Timer, Statistik, Einstellungen, Wake Lock, Töne, Updates |
| `levels.js` | **Wertebereiche je Modus und Level – hier anpassen** |
| `generator.js` | Aufgabengeneratoren und Punkteberechnung |
| `storage.js` | localStorage mit versioniertem Schema, Import/Export |
| `sw.js` | Service Worker (Offline, Cache-Versionierung) |
| `manifest.json`, `icons/` | PWA-Manifest, Icons, Splash-Screens |
| `tools/` | lokaler Server, Icon-Renderer |
| `tests/` | Unit-Tests (Generatoren, Speicher) und Playwright-E2E |

## Lokal starten und testen

```bash
npm install
npx playwright install webkit chromium
npm run serve        # http://localhost:8080
npm test             # Unit-Tests: 1000 Aufgaben je Modus und Level
npm run test:e2e     # WebKit, iPhone 15 Pro / 13 mini / SE, Hell+Dunkel; Screenshots in screenshots/
npm run icons        # icons/icon.svg → PNGs und Splash-Screens neu rendern
```

## Schwierigkeit anpassen

In `levels.js` die Bereiche ändern (`[min, max]`, inklusive). Danach `npm test`
ausführen: Die Tests prüfen, dass alle Ergebnisse ganzzahlig, nicht negativ und im
Bereich bleiben.

## Updates veröffentlichen

Nach jeder Änderung `CACHE_VERSION` in `sw.js` (und `APP_VERSION` in `app.js`)
erhöhen. Beim nächsten Öffnen erscheint in der App „Neue Version verfügbar“ –
nie mitten in einer Runde.
