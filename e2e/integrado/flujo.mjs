// Recorrido del flujo integrado: portal → módulo asignado según el usuario. Requiere run.sh (nginx + Supabase simulado + app).
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const BASE = 'http://localhost:8080', OUT = process.env.SHOTS ?? './shots-integrado';
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const errors = [];
const ok = (m) => console.log('✓ ' + m), fail = (m) => { console.error('✗ ' + m); process.exitCode = 1; };
const check = (c, m) => (c ? ok(m) : fail(m));
async function fresh() {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }), page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g|ERR_|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  return { ctx, page };
}
async function login(page, email, pw, qs = '') {
  await page.goto(BASE + '/' + qs, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Correo').fill(email); await page.getByLabel('Contraseña').fill(pw); await page.getByRole('button', { name: 'Entrar' }).click();
}
const has = async (page, t, ms = 8000) => page.getByText(t, { exact: false }).first().waitFor({ timeout: ms }).then(() => true, () => false);

// 1) Un solo módulo asignado → entra directo a Operaciones, con el rol del token
{ const { ctx, page } = await fresh();
  await login(page, 'marta@intransit.test', 'Clave-Marta-1');
  await page.waitForURL('**/operaciones/**'); check(await has(page, 'Horas hombre reportadas'), 'marta (solo Operaciones) entra directo al módulo');
  check(await has(page, 'operador'), 'se muestra su rol operador'); await page.screenshot({ path: OUT + '/01-marta-operaciones.png' });
  check((await page.locator('nav.side').getByRole('button', { name: 'Ajustes', exact: true }).count()) === 1, 'el módulo carga con su menú');
  // 2) Renovación de la sesión: token a punto de vencer → se renueva sin pasar por el portal
  const before = (await (await page.request.get(BASE + '/__stats')).json()).refreshes;
  await page.evaluate(() => { const k = Object.keys(localStorage).find((x) => /^sb-.*-auth-token$/.test(x)); const s = JSON.parse(localStorage.getItem(k)); s.expires_at = Math.floor(Date.now() / 1000) + 10; localStorage.setItem(k, JSON.stringify(s)); });
  await page.reload({ waitUntil: 'domcontentloaded' }); check(await has(page, 'Horas hombre reportadas'), 'tras recargar con el token por vencer el módulo sigue abierto');
  check((await (await page.request.get(BASE + '/__stats')).json()).refreshes === before + 1, 'la sesión se renovó una sola vez contra Supabase');
  // Ruta sin barra final
  await page.goto(BASE + '/operaciones', { waitUntil: 'domcontentloaded' }); check(await has(page, 'Horas hombre reportadas') && page.url().endsWith('/operaciones/'), '/operaciones redirige a /operaciones/');
  // Salir → portal
  await page.getByRole('button', { name: 'Salir' }).click(); check(await has(page, 'Iniciar sesión'), 'Salir cierra la sesión y vuelve al portal');
  await ctx.close(); }

// 3) Dos módulos → el portal pregunta; Operaciones con rol supervisor; "Módulos" vuelve a elegir
{ const { ctx, page } = await fresh();
  await login(page, 'ana@intransit.test', 'Clave-Ana-1');
  check(await has(page, 'Elige un módulo'), 'ana (dos módulos) ve el selector'); await page.screenshot({ path: OUT + '/02-ana-selector.png' });
  check((await page.locator('a.mod').count()) === 2, 'se listan exactamente los dos módulos asignados');
  await page.locator('a.mod', { hasText: 'Operaciones' }).click(); await page.waitForURL('**/operaciones/**');
  check(await has(page, 'supervisor'), 'entra a Operaciones como supervisor');
  await page.getByRole('link', { name: 'Módulos' }).click(); check(await has(page, 'Elige un módulo'), '«Módulos» regresa al selector');
  await page.locator('a.mod', { hasText: 'Transportes' }).click(); await page.waitForURL('**/transportes/**'); check(await has(page, 'Master App de Transportes'), 'también abre Transportes con la misma sesión');
  await ctx.close(); }

// 4) Solo Transportes → va a Transportes; si fuerza /operaciones/ ve «Módulo no asignado»
{ const { ctx, page } = await fresh();
  await login(page, 'luis@intransit.test', 'Clave-Luis-1');
  await page.waitForURL('**/transportes/**'); check(await has(page, 'Master App de Transportes'), 'luis (solo Transportes) entra directo a Transportes');
  await page.goto(BASE + '/operaciones/', { waitUntil: 'domcontentloaded' });
  check(await has(page, 'Módulo no asignado'), 'luis no puede abrir Operaciones: «Módulo no asignado»'); await page.screenshot({ path: OUT + '/03-luis-sin-acceso.png' });
  check((await page.getByText('Horas hombre reportadas').count()) === 0, 'no se muestra ningún dato de Operaciones');
  await ctx.close(); }

// 5) Sin módulos
{ const { ctx, page } = await fresh();
  await login(page, 'sin@intransit.test', 'Clave-Sin-1');
  check(await has(page, 'Sin módulos asignados'), 'un usuario sin módulos ve «Sin módulos asignados»'); await ctx.close(); }

// 6) Credenciales incorrectas
{ const { ctx, page } = await fresh();
  await login(page, 'ana@intransit.test', 'mala');
  check(await has(page, 'Correo o contraseña incorrectos'), 'credenciales incorrectas: mensaje claro'); await ctx.close(); }

// 7) Administrador del módulo: la gestión de usuarios es externa
{ const { ctx, page } = await fresh();
  await login(page, 'jefe@intransit.test', 'Clave-Jefe-1'); await page.waitForURL('**/operaciones/**');
  await page.locator('nav.side').getByRole('button', { name: 'Ajustes', exact: true }).click(); await page.getByRole('tab', { name: 'Usuarios' }).click();
  check(await has(page, 'se gestionan en la app principal'), 'Ajustes → Usuarios explica que se gestionan en la app principal');
  check((await page.getByText('Nuevo usuario').count()) === 0, 'no hay alta de usuarios locales'); await page.screenshot({ path: OUT + '/04-jefe-usuarios.png' });
  check(await has(page, 'marta@intransit.test') || await has(page, 'jefe@intransit.test'), 'el usuario aparece reflejado en el módulo tras su primer acceso');
  await ctx.close(); }

console.log(errors.length ? '✗ errores de consola:\n' + errors.join('\n') : '✓ sin errores de consola');
if (errors.length) process.exitCode = 1;
await browser.close();
