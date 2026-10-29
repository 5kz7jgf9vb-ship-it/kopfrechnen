/**
 * Rendert icons/icon.svg zu allen PNG-Größen (App-Icons, Favicon, Splash-Screens)
 * mit Playwright/Chromium und trägt die Splash-Links in index.html ein.
 *
 *   npm run icons
 */
import { chromium } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('..', import.meta.url);
const iconsDir = new URL('icons/', root);
const svg = await readFile(new URL('icon.svg', iconsDir), 'utf8');
const svgData = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;

const ICONS = [
  ['apple-touch-icon-180.png', 180],
  ['apple-touch-icon-167.png', 167],
  ['apple-touch-icon-152.png', 152],
  ['apple-touch-icon-120.png', 120],
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['icon-maskable-512.png', 512],
  ['favicon-32.png', 32],
];

/** iPhone-Displays im Hochformat: CSS-Breite, CSS-Höhe, Pixeldichte. */
const SPLASH = [
  [375, 667, 2], // SE 2./3. Gen, 8
  [375, 812, 3], // 12/13 mini, X, XS, 11 Pro
  [414, 896, 2], // XR, 11
  [414, 896, 3], // XS Max, 11 Pro Max
  [390, 844, 3], // 12, 13, 14, 16e
  [428, 926, 3], // 12/13 Pro Max, 14 Plus
  [393, 852, 3], // 14 Pro, 15, 15 Pro, 16
  [430, 932, 3], // 14 Pro Max, 15 Plus/Pro Max, 16 Plus
  [402, 874, 3], // 16 Pro, 17, 17 Pro
  [440, 956, 3], // 16 Pro Max, 17 Pro Max
  [420, 912, 3], // iPhone Air
];

const splashHtml = (dark) => `<!doctype html><html><body style="margin:0;height:100vh;display:grid;place-items:center;
  background:${dark ? 'linear-gradient(160deg,#07080d,#0d1020)' : 'linear-gradient(160deg,#eef1f8,#e3e8f5)'};
  font-family:-apple-system,'Segoe UI',system-ui,sans-serif">
  <div style="display:flex;flex-direction:column;align-items:center;gap:22px">
    <img src="${svgData}" style="width:120px;height:120px;border-radius:27px;box-shadow:0 18px 40px -12px rgba(20,20,60,.45)">
    <div style="font-size:22px;font-weight:600;letter-spacing:-.01em;color:${dark ? '#f4f5f8' : '#0b0c10'}">Kopfrechnen</div>
  </div></body></html>`;

const browser = await chromium.launch();
try {
  for (const [name, size] of ICONS) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(`<html><body style="margin:0"><img src="${svgData}" style="width:${size}px;height:${size}px;display:block"></body></html>`);
    await page.screenshot({ path: fileURLToPath(new URL(name, iconsDir)) });
    await page.close();
    console.log('✓', name);
  }

  const splashDir = new URL('splash/', iconsDir);
  await mkdir(splashDir, { recursive: true });
  const links = [];
  for (const [w, h, dpr] of SPLASH) {
    for (const dark of [false, true]) {
      const file = `splash-${w * dpr}x${h * dpr}${dark ? '-dark' : ''}.png`;
      const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
      await page.setContent(splashHtml(dark));
      await page.screenshot({ path: fileURLToPath(new URL(file, splashDir)) });
      await page.close();
      links.push(
        `  <link rel="apple-touch-startup-image" href="icons/splash/${file}" media="(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${dpr}) and (orientation: portrait) and (prefers-color-scheme: ${dark ? 'dark' : 'light'})">`,
      );
    }
    console.log('✓ splash', `${w}x${h}@${dpr}`);
  }

  const indexUrl = new URL('index.html', root);
  const html = await readFile(indexUrl, 'utf8');
  const updated = html.replace(
    /( *)<!-- SPLASH:START[^\n]*\n[\s\S]*?<!-- SPLASH:END -->/,
    (_, indent) => `${indent}<!-- SPLASH:START (generiert von tools/render-icons.js) -->\n${links.join('\n')}\n${indent}<!-- SPLASH:END -->`,
  );
  await writeFile(indexUrl, updated);
  console.log('✓ index.html Splash-Links aktualisiert');
} finally {
  await browser.close();
}
