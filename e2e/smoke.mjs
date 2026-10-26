// Recorrido de humo en navegador real: BASE_URL (por defecto http://localhost:3001) con el servidor ya sembrado con datos demo.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const BASE = process.env.BASE_URL ?? 'http://localhost:3001', OUT = process.env.SHOTS ?? './shots';
fs.mkdirSync(OUT, { recursive: true });
const exe = process.env.CHROMIUM ?? '/opt/pw-browsers/chromium';
const browser = await chromium.launch({ executablePath: fs.existsSync(exe) ? exe : undefined, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g|ERR_|Failed to load resource/.test(m.text())) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
let n = 0; const shot = async (name) => page.screenshot({ path: `${OUT}/${String(++n).padStart(2, '0')}-${name}.png`, fullPage: false });
const fail = (m) => { console.error('✗ ' + m); process.exitCode = 1; };
const ok = (m) => console.log('✓ ' + m);
const expectText = async (t, timeout = 8000) => { try { await page.getByText(t, { exact: false }).first().waitFor({ timeout }); ok('ve «' + t + '»'); } catch { fail('no aparece «' + t + '»'); } };

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.getByLabel('Correo').fill('supervisor@omnia.local'); await page.getByLabel('Contraseña').fill('Omnia2026!demo');
await shot('login'); await page.getByRole('button', { name: 'Entrar' }).click();
await expectText('DATOS DE DEMOSTRACIÓN'); await expectText('Horas hombre reportadas'); await shot('dashboard');

const tab = async (name) => { await page.locator('nav.side').getByRole('button', { name, exact: true }).click(); };
await tab('Resumen'); await expectText('Margen por proceso'); await expectText('N/D'); await shot('resumen');
await page.getByLabel('Filtrar por semana').selectOption({ index: 1 }); await expectText('Mostrando'); await shot('resumen-semana');
await tab('Inventario'); await expectText('Movimiento del mes'); await page.getByRole('tab', { name: 'Insumos' }).click(); await expectText('Catálogo de insumos'); await shot('inventario');
await tab('Compras'); await expectText('Órdenes de compra y/o requerimientos'); await shot('compras');
await tab('Horas y personal'); await expectText('Personal de maquila'); await shot('horas'); await page.getByRole('tab', { name: 'Impresión y asistencia' }).click(); await expectText('Impresión de etiquetas');
await tab('Ajustes'); await expectText('Maquila: productos'); await shot('ajustes');

// Producción: añadir registro (Coca Cola → Packs), fecha automática, anular (no hay borrar)
await tab('Producción'); await page.getByRole('button', { name: /Añadir nuevo registro/ }).click();
await page.getByLabel('Cliente *').selectOption({ label: 'Coca Cola' }); await page.getByLabel('Proyecto *').selectOption({ label: 'Packs' });
await page.getByLabel(/^Cantidad/).fill('77'); await page.getByLabel(/Documento/).fill('E2E-1'); await shot('nuevo-registro');
await page.getByRole('button', { name: 'Guardar registro' }).click(); await expectText('Registro guardado');
await page.getByRole('button', { name: 'Cerrar' }).click(); await expectText('E2E-1');
// persistencia: al recargar la página el registro sigue en el servidor
await page.reload({ waitUntil: 'domcontentloaded' }); await expectText('E2E-1'); await shot('persistencia-recarga');
if (await page.getByRole('button', { name: 'Eliminar' }).count()) fail('existe botón Eliminar');
const row = page.locator('tr', { hasText: 'E2E-1' }).first();
await row.getByRole('button', { name: 'Anular' }).click();
await page.getByLabel(/Motivo/).fill('prueba automática de anulación'); await page.getByRole('button', { name: 'Anular', exact: true }).last().click();
await expectText('Registro anulado'); await shot('anulado');

// Orden de compra: generar y emitir
await tab('Compras'); await page.getByRole('button', { name: /Generar orden de compra/ }).click();
await page.getByLabel('Proveedor *').fill('PROVEEDOR E2E'); await page.getByLabel('Tipo de material').first().selectOption('Otro'); await page.getByLabel('Descripción').first().fill('Cinta de embalaje'); await page.getByLabel('Cantidad').first().fill('10'); await page.getByLabel('Precio unitario').first().fill('5');
await shot('oc-form'); await page.getByRole('button', { name: 'Guardar y emitir' }).click(); await expectText('Orden OC-'); await expectText('PROVEEDOR E2E');

// Comercial: el supervisor no lo ve; el usuario comercial sí
if (await page.locator('nav.side').getByRole('button', { name: 'Comercial', exact: true }).count()) fail('el supervisor ve Comercial');
await page.getByRole('button', { name: 'Salir' }).click();
await page.getByLabel('Correo').fill('comercial@omnia.local'); await page.getByLabel('Contraseña').fill('Omnia2026!demo'); await page.getByRole('button', { name: 'Entrar' }).click();
await tab('Comercial'); await expectText('Total a cobrar'); await expectText('Cantidad a cobrar'); await shot('comercial');
await page.getByRole('tab', { name: 'Tarifas por cliente' }).click(); await expectText('Tarifas vigentes'); await shot('tarifas');

console.log(errors.length ? '' : '');
console.log(errors.length ? '✗ errores de consola:\n' + errors.join('\n') : '✓ sin errores de consola');
if (errors.length) process.exitCode = 1;
await browser.close();
