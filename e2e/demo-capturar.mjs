// Graba las respuestas GET de la API para el build «demo» (GitHub Pages): recorre todas las pestañas y subpestañas
// como administrador demo y escribe web/src/demo-data.json. Requiere el servidor local con datos demo y la web en BASE_URL.
// Uso: node demo-capturar.mjs   (luego: cd ../web && npm run build:demo)
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const BASE = process.env.BASE_URL ?? 'http://localhost:5173';
const OUT = new URL('../web/src/demo-data.json', import.meta.url);
const exe = [process.env.CHROMIUM, '/opt/pw-browsers/chromium', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find((p) => p && fs.existsSync(p));
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const respuestas = {}, pendientes = [];
let login = null, token = null;
page.on('response', (r) => {
  const url = new URL(r.url()), i = url.pathname.indexOf('/api/');
  if (i < 0 || !r.ok() || !(r.headers()['content-type'] ?? '').includes('json')) return;
  const ruta = url.pathname.slice(i + 4);
  pendientes.push(r.json().then((j) => {
    if (ruta === '/auth/login') { token = j.token; login = { ...j, token: 'demo' }; }
    else if (r.request().method() === 'GET') respuestas[ruta + url.search] = j;
  }).catch(() => {}));
});
const calma = () => page.waitForTimeout(700);

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.getByLabel('Correo').fill('admin@omnia.local'); await page.getByLabel('Contraseña').fill('Omnia2026!demo');
await page.getByRole('button', { name: 'Entrar' }).click();
await page.locator('nav.side button').first().waitFor(); await calma();

const tabs = await page.locator('nav.side button').allInnerTexts();
for (const t of tabs) {
  await page.locator('nav.side button', { hasText: t }).first().click(); await calma();
  for (const s of await page.locator('.subtabs [role=tab]').allInnerTexts()) {
    await page.locator('.subtabs [role=tab]', { hasText: s }).first().click(); await calma();
  }
  if (t === 'Compras') {   // el formulario pide las listas desplegables
    await page.locator('.subtabs [role=tab]').first().click(); await calma();
    await page.getByRole('button', { name: /Generar orden/ }).first().click(); await calma();
    await page.getByRole('button', { name: 'Cancelar' }).click(); await calma();
  }
}
await Promise.all(pendientes);

// detalle de cada orden de compra (botón «Ver»), directo a la API con la sesión del recorrido
const ids = new Set(Object.entries(respuestas).filter(([k, v]) => k.startsWith('/ordenes-compra?') && Array.isArray(v)).flatMap(([, v]) => v.map((o) => o.id)));
for (const id of ids) {
  const r = await fetch(`${BASE}/api/ordenes-compra/${id}`, { headers: { Authorization: 'Bearer ' + token } });
  if (r.ok) respuestas[`/ordenes-compra/${id}`] = await r.json();
}
await browser.close();

const texto = JSON.stringify({ login, respuestas });
for (const [nombre, patron] of [['ruta local', /[A-Z]:\\\\|\/Users\//], ['token real', new RegExp(token ?? '^$')], ['clave', /"password"/i]])
  if (patron.test(texto)) throw new Error(`demo-data.json contendría ${nombre}: revisar antes de publicar`);
fs.writeFileSync(OUT, JSON.stringify({ login, respuestas }, null, 1) + '\n');
console.log(`${Object.keys(respuestas).length} respuestas grabadas (${ids.size} órdenes con detalle) → web/src/demo-data.json (${(texto.length / 1024).toFixed(0)} KB)`);
