import { useState } from 'react';
import { api } from '../api';
import { Card, Loading, Modal, MonthBar, Pill, Tabs, useLoad } from '../components';
import { fmtDate, fmtDT, nf, nf2, nfx, q2 } from '../format';
import { RecordForm, type FieldDef } from '../records-ui';
import { useApp } from '../store';
import PeriodControls from './PeriodControls';

type T = 'std' | 'cli' | 'items' | 'gen' | 'imp' | 'per' | 'usr' | 'sec' | 'aud';
export default function Ajustes() {
  const { can } = useApp();
  const [tab, setTab] = useState<T>('std');
  const items: [T, string][] = [['std', 'Productos y estándares'], ['cli', 'Clientes y proyectos'], ['items', 'Etiquetas, ribbon y bolsa'], ['gen', 'General']];
  if (can('importar')) items.push(['imp', 'Importar Excel']);
  items.push(['per', 'Periodos']);
  if (can('usuarios.gestionar')) items.push(['usr', 'Usuarios']);
  if (can('ajustes.editar')) items.push(['sec', 'Secciones de Maquilas']);
  if (can('auditoria.ver')) items.push(['aud', 'Bitácora de cambios']);
  return (<><Tabs sub items={items} value={tab} onChange={setTab} />{tab === 'std' && <Estandares />}{tab === 'cli' && <Clientes />}{tab === 'items' && <Articulos />}{tab === 'gen' && <General />}{tab === 'imp' && <Importar />}{tab === 'per' && <Periodos />}{tab === 'usr' && <Usuarios />}{tab === 'sec' && <Secciones />}{tab === 'aud' && <Bitacora />}</>);
}

function Estandares() {
  const { can, toast, refresh, meta } = useApp();
  const { data: cat, err, loading, reload } = useLoad<any>(() => api.get('/catalogo'), []);
  const [modal, setModal] = useState<null | { scope: 'product' | 'line'; key: string; name: string }>(null), [hist, setHist] = useState<null | { key: string; name: string }>(null), [adding, setAdding] = useState(false);
  const today = meta?.today ?? '';
  const cur = (scope: string, key: string) => (cat?.standards ?? []).filter((s: any) => s.scope === scope && s.key === key && s.validFrom <= today && (!s.validTo || s.validTo >= today)).at(-1);
  const upcoming = (scope: string, key: string) => (cat?.standards ?? []).find((s: any) => s.scope === scope && s.key === key && s.validFrom > today);
  const edit = can('estandar.editar');
  const row = (scope: 'product' | 'line', key: string, name: string, pallet: boolean) => { const s = cur(scope, key), u = upcoming(scope, key); return (
    <tr key={scope + key}><td>{scope === 'product' ? <span className="sap">{key}</span> : <code>{key}</code>}</td><td>{name}</td>
      {pallet && <td className="n">{s?.unitsPerPallet ?? <span className="nd">N/D</span>}</td>}
      <td className="n">{s?.tt ?? <span className="nd">N/D</span>}</td><td className="n">{s?.unitRate != null ? nfx(s.unitRate) : <Pill kind="warn">Sin costo</Pill>}</td><td>{s ? fmtDate(s.validFrom) : ''}{u && <> <Pill kind="blue">cambia el {fmtDate(u.validFrom)}</Pill></>}</td>
      <td style={{ whiteSpace: 'nowrap' }}><button className="btn btn-sm" onClick={() => setHist({ key: scope + ':' + key, name })}>Historial</button>{edit && <> <button className="btn btn-sm btn-blue" onClick={() => setModal({ scope, key, name })}>Nueva vigencia</button></>}</td></tr>); };
  const lines = (cat?.lines ?? []).filter((l: any) => !['hrs', 'man', 'none'].includes(l.mode) || true);
  return (
    <>
      <Loading err={err} loading={loading && !cat} />
      {cat && <>
        <Card title="Maquila: productos, cajas por tarima, TT y costo" sub="HH = cajas ÷ cajas por tarima × TT (min por tarima) ÷ 60" actions={can('catalogo.editar') && <button className="btn btn-sm" onClick={() => setAdding(true)}>Agregar producto</button>}>
          <div className="tbl-wrap"><table className="tbl"><thead><tr><th>SAP</th><th>Producto</th><th className="n">Cajas / tarima</th><th className="n">TT (min / tarima)</th><th className="n">Costo Q / caja</th><th>Vigente desde</th><th /></tr></thead><tbody>{cat.products.map((p: any) => row('product', p.sap, p.name, true))}</tbody></table></div>
        </Card>
        <Card title="Líneas de proceso: TT y costo unitario" sub="TT: minutos por caja/contenedor, o unidades por hora en las líneas de etiquetado, Walmart y revisión">
          <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Clave</th><th>Línea</th><th className="n">TT</th><th className="n">Costo unitario</th><th>Vigente desde</th><th /></tr></thead><tbody>{lines.filter((l: any) => !['hrs', 'man'].includes(l.mode)).map((l: any) => row('line', l.key, `${l.name} (${l.mode === 'uph' ? 'U/h' : l.mode === 'none' ? 'sin HH' : 'min'})`, false))}</tbody></table></div>
        </Card>
      </>}
      {modal && <StdModal m={modal} cur={cur(modal.scope, modal.key)} onClose={() => setModal(null)} onSaved={() => { setModal(null); toast('Nueva vigencia registrada.'); reload(); refresh(); }} />}
      {hist && <Modal title={'Historial · ' + hist.name} onClose={() => setHist(null)} wide><table className="tbl"><thead><tr><th>Desde</th><th>Hasta</th><th className="n">Cajas/tarima</th><th className="n">TT</th><th className="n">Costo</th><th>Nota</th></tr></thead><tbody>{(cat?.standards ?? []).filter((s: any) => s.scope + ':' + s.key === hist.key).map((s: any) => <tr key={s.id}><td>{fmtDate(s.validFrom)}</td><td>{s.validTo ? fmtDate(s.validTo) : 'vigente'}</td><td className="n">{s.unitsPerPallet ?? ''}</td><td className="n">{s.tt ?? ''}</td><td className="n">{s.unitRate != null ? nfx(s.unitRate) : ''}</td><td>{s.note}</td></tr>)}</tbody></table><div className="mact"><button className="btn" onClick={() => setHist(null)}>Cerrar</button></div></Modal>}
      {adding && <Modal title="Agregar producto de maquila" onClose={() => setAdding(false)}><RecordForm submitLabel="Agregar" initial={{}} fields={[{ k: 'sap', label: 'Código SAP', type: 'text', required: true }, { k: 'name', label: 'Nombre', type: 'text', required: true, w: 2 }]} onSubmit={async (v) => { try { await api.post('/catalogo/productos', v); toast('Producto agregado. Define su TT, cajas por tarima y costo con «Nueva vigencia».'); setAdding(false); reload(); refresh(); } catch (e: any) { toast(e.message, true); } }} /></Modal>}
    </>
  );
}
function StdModal({ m, cur, onClose, onSaved }: { m: { scope: 'product' | 'line'; key: string; name: string }; cur: any; onClose: () => void; onSaved: () => void }) {
  const { meta, toast } = useApp();
  const fields: FieldDef[] = [{ k: 'validFrom', label: 'Vigente desde', type: 'date', required: true, hint: 'Lo anterior a esta fecha conserva los valores actuales' }, ...(m.scope === 'product' ? [{ k: 'unitsPerPallet', label: 'Cajas por tarima', type: 'num' as const }] : []), { k: 'tt', label: 'TT', type: 'num', step: 'any' }, { k: 'unitRate', label: 'Costo unitario (Q)', type: 'num', step: 'any' }, { k: 'note', label: 'Motivo / nota', type: 'text', w: 2 }];
  return <Modal title={`Nueva vigencia · ${m.name}`} onClose={onClose}><RecordForm fields={fields} submitLabel="Guardar vigencia" initial={{ validFrom: meta?.today, unitsPerPallet: cur?.unitsPerPallet, tt: cur?.tt, unitRate: cur?.unitRate }}
    onSubmit={async (v) => { try { await api.post('/catalogo/estandares', { scope: m.scope, key: m.key, ...v }); onSaved(); } catch (e: any) { toast(e.message, true); } }} /><div className="mact"><button className="btn" onClick={onClose}>Cancelar</button></div></Modal>;
}

function Articulos() {
  const { can, toast, refresh } = useApp();
  const { data: cat, err, loading, reload } = useLoad<any>(() => api.get('/catalogo'), []);
  const [draft, setDraft] = useState<Record<string, any>>({});
  const edit = can('catalogo.editar');
  const set = (id: string, k: string, v: string) => setDraft((d) => ({ ...d, [id]: { ...d[id], [k]: v === '' ? null : Number(v) } }));
  const save = async (id: string) => { try { await api.patch('/catalogo/items/' + id, draft[id]); setDraft(({ [id]: _, ...r }) => r); toast('Guardado.'); reload(); refresh(); } catch (e: any) { toast(e.message, true); } };
  const cell = (it: any, k: string, step = 'any') => { const v = draft[it.id]?.[k] !== undefined ? draft[it.id][k] : it[k]; return edit ? <input className="num" type="number" step={step} min={0} aria-label={`${it.name} ${k}`} value={v ?? ''} onChange={(e) => set(it.id, k, e.target.value)} /> : v ?? <span className="nd">N/D</span>; };
  const act = (it: any) => edit && draft[it.id] ? <button className="btn btn-sm btn-blue" onClick={() => save(it.id)}>Guardar</button> : null;
  const labs = (cat?.items ?? []).filter((i: any) => i.kind === 'lab'), ribs = (cat?.items ?? []).filter((i: any) => i.kind === 'rib'), bag = (cat?.items ?? []).find((i: any) => i.kind === 'bag');
  return (
    <>
      <Loading err={err} loading={loading && !cat} />
      {cat && <>
        <p className="note">Los precios de insumos no llevan vigencia: afectan a los periodos abiertos. Los periodos cerrados conservan sus cifras congeladas.</p>
        <Card title="Etiquetas">
          <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Etiqueta</th><th className="n">Etiquetas por rollo</th><th className="n">Precio por rollo (Q)</th><th>Ribbon que usa</th><th className="n">Etiquetas por rollo de ribbon</th><th /></tr></thead><tbody>
            {labs.map((l: any) => <tr key={l.id}><td><b>{l.code}</b></td><td className="n">{cell(l, 'unitsPerRoll', '1')}</td><td className="n">{l.price == null && !draft[l.id] ? <Pill kind="warn">Sin precio</Pill> : cell(l, 'price', '0.01')}</td><td>{ribs.find((r: any) => r.id === l.ribbonId)?.name}</td><td className="n">{cell(l, 'ribbonYield', '1')}</td><td>{act(l)}</td></tr>)}</tbody></table></div>
        </Card>
        <Card title="Ribbon y bolsa">
          <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Artículo</th><th className="n">Precio (Q)</th><th /></tr></thead><tbody>
            {ribs.map((r: any) => <tr key={r.id}><td><b>{r.name}</b> <span className="muted">por rollo</span></td><td className="n">{cell(r, 'price', '0.01')}</td><td>{act(r)}</td></tr>)}
            {bag && <tr><td><b>{bag.name}</b> <span className="muted">por unidad</span></td><td className="n">{cell(bag, 'price', '0.0001')}</td><td>{act(bag)}</td></tr>}</tbody></table></div>
          <h4 style={{ margin: '14px 0 6px' }}>Bolsas por caja según SAP</h4>
          <table className="tbl"><tbody>{(cat.bagUsage ?? []).map((b: any) => <tr key={b.sap}><td><span className="sap">{b.sap}</span> {cat.products.find((p: any) => p.sap === b.sap)?.name}</td><td className="n">{b.bagsPerBox} por caja</td></tr>)}</tbody></table>
        </Card>
      </>}
    </>
  );
}

function General() {
  const { can, toast, refresh, reloadMeta } = useApp();
  const { data: cat, err, loading, reload } = useLoad<any>(() => api.get('/catalogo'), []);
  const s = cat?.settings;
  const ro = !can('ajustes.editar');
  return (
    <>
      <Loading err={err} loading={loading && !cat} />
      {s && <Card title="General" sub={ro ? 'Solo un administrador puede cambiar estos valores' : undefined}>
        <RecordForm submitLabel="Guardar ajustes" initial={{ inicio: s.inicio, wmDiv: s.wmDiv, crkDefaultUnitsPerBox: s.crkDefaultUnitsPerBox }}
          fields={[{ k: 'inicio', label: 'Registros desde', type: 'date', hint: 'No se aceptan registros ni importaciones anteriores a esta fecha' }, { k: 'wmDiv', label: 'Walmart: cobro de cajas = unidades ÷', type: 'num', hint: 'Cuando la caja trae esa cantidad o más; si no, se cuenta la caja (pendiente de validación)' }, { k: 'crkDefaultUnitsPerBox', label: 'Crackets: unidades por caja por defecto', type: 'num', hint: 'Se usa si el producto no trae …X64X1 (pendiente de validación)' }]}
          onSubmit={async (v) => { if (ro) return toast('Sin permiso para cambiar ajustes.', true); try { await api.put('/ajustes', v); toast('Ajustes guardados.'); reload(); refresh(); void reloadMeta(); } catch (e: any) { toast(e.message, true); } }} />
      </Card>}
    </>
  );
}

function Importar() {
  const { toast, refresh } = useApp();
  const [tipo, setTipo] = useState('estatus_diario'), [file, setFile] = useState<File | null>(null), [prev, setPrev] = useState<any>(null), [busy, setBusy] = useState(false);
  const { data: hist, reload } = useLoad<any[]>(() => api.get('/importar'), []);
  const preview = async () => { if (!file) return; setBusy(true); setPrev(null); try { const fd = new FormData(); fd.append('tipo', tipo); fd.append('archivo', file); setPrev(await api.upload('/importar/vista-previa', fd)); } catch (e: any) { toast(e.message, true); } finally { setBusy(false); } };
  const apply = async () => { setBusy(true); try { const r = await api.post(`/importar/${prev.batchId}/aplicar`); toast(`Importado: ${r.produccion.insertados} de producción y ${r.horas.insertados} de horas. Omitidos: ${r.produccion.omitidos + r.horas.omitidos}.`); setPrev(null); setFile(null); reload(); refresh(); } catch (e: any) { toast(e.message, true); } finally { setBusy(false); } };
  const S = prev?.summary;
  return (
    <>
      <p className="note">Canal secundario de migración/contingencia: la captura normal se hace en las pantallas del sistema. Nada se escribe hasta que confirmes la vista previa; los registros repetidos se detectan y se omiten.</p>
      <Card title="Importar Excel de estatus">
        <div className="form"><div className="field"><label htmlFor="tp">Tipo de archivo</label><select id="tp" value={tipo} onChange={(e) => { setTipo(e.target.value); setPrev(null); }}><option value="estatus_diario">Estatus diario</option><option value="outsourcing">Estatus outsourcing</option></select></div>
          <div className="field w2"><label htmlFor="fl">Archivo .xlsx</label><input id="fl" type="file" accept=".xlsx" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPrev(null); }} /></div>
          <div className="factions"><button className="btn btn-blue" disabled={!file || busy} onClick={preview}>{busy && !prev ? 'Leyendo…' : 'Ver vista previa'}</button></div></div>
      </Card>
      {prev && <Card title={`Vista previa · ${prev.fileName}`} sub={S.rango ? `${fmtDate(S.rango.desde)} al ${fmtDate(S.rango.hasta)}` : ''}>
        {prev.avisos.map((a: string) => <div key={a} className="warnline">{a}</div>)}
        <div className="kpis" style={{ marginTop: 10 }}>
          <div className="kpi"><small>Producción nueva</small><b>{S.produccion.nuevos}</b><span className="sub">{S.produccion.duplicados} duplicados · {S.produccion.periodoCerrado} en periodo cerrado</span></div>
          <div className="kpi"><small>Horas nuevas</small><b>{S.horas.nuevos}</b><span className="sub">{S.horas.duplicados} duplicados · {S.horas.periodoCerrado} en periodo cerrado</span></div></div>
        <table className="tbl"><thead><tr><th>Hoja</th><th className="n">Filas leídas</th><th className="n">Sin fecha válida</th><th className="n">Antes del inicio</th><th className="n">Fecha futura</th><th className="n">Sin cantidad</th></tr></thead><tbody>
          {prev.sheets.map((h: any) => <tr key={h.sheet}><td>{h.sheet} {!h.found && <Pill kind="warn">no encontrada</Pill>}</td><td className="n">{h.read}</td><td className="n">{h.ignored.sinFecha}</td><td className="n">{h.ignored.anteriorAlInicio}</td><td className="n">{h.ignored.futura}</td><td className="n">{h.ignored.sinCantidad}</td></tr>)}</tbody></table>
        {prev.muestra.produccion.length > 0 && <><h4 style={{ margin: '12px 0 4px' }}>Muestra de producción</h4><table className="tbl"><tbody>{prev.muestra.produccion.map((r: any, i: number) => <tr key={i}><td>{fmtDate(r.date)}</td><td>{r.kind}</td><td>{r.sap}</td><td>{r.productName}</td><td className="n">{nfx(r.boxes)}</td><td>{r.estado === 'nuevo' ? <Pill kind="ok">nuevo</Pill> : <Pill kind="gray">{r.estado}</Pill>}</td></tr>)}</tbody></table></>}
        <div className="mact"><button className="btn" onClick={() => setPrev(null)}>Descartar</button><button className="btn btn-primary" disabled={busy || S.produccion.nuevos + S.horas.nuevos === 0} onClick={apply}>Importar {S.produccion.nuevos + S.horas.nuevos} registros nuevos</button></div>
      </Card>}
      <Card title="Importaciones anteriores"><table className="tbl"><tbody>{(hist ?? []).map((h: any) => <tr key={h.id}><td>{fmtDT(h.createdAt)}</td><td>{h.fileName}</td><td>{h.source}</td><td>{h.status === 'aplicado' ? <Pill kind="ok">aplicado</Pill> : <Pill kind="gray">{h.status}</Pill>}</td></tr>)}</tbody></table>{!hist?.length && <p className="muted">Sin importaciones.</p>}</Card>
    </>
  );
}

function Periodos() {
  const { month } = useApp();
  const { data, err, loading } = useLoad<any[]>(() => api.get('/periodos'), []);
  return <><MonthBar status={data?.find((p) => p.month === month)?.status} extra={<PeriodControls />} />
    <Card title="Periodos" sub="Elige el mes arriba para ajustar sus semanas, cerrarlo o reabrirlo"><Loading err={err} loading={loading && !data} />
    <table className="tbl"><thead><tr><th>Mes</th><th>Semanas</th><th>Fechas</th><th>Estado</th><th>Cerrado</th></tr></thead><tbody>{(data ?? []).map((p) => <tr key={p.month}><td style={{ textTransform: 'capitalize' }}>{p.title}</td><td>{p.weekFrom}–{p.weekTo} {p.override && <Pill kind="blue">ajustadas</Pill>}</td><td>{fmtDate(p.start)} al {fmtDate(p.end)}</td><td>{p.status === 'cerrado' ? <Pill kind="blue">Cerrado</Pill> : <Pill kind="ok">Abierto</Pill>}</td><td>{p.closedAt ? fmtDT(p.closedAt) : ''}</td></tr>)}</tbody></table></Card></>;
}

function Usuarios() {
  const { toast, meta } = useApp();
  const { data, err, loading, reload } = useLoad<any[]>(() => api.get('/usuarios'), []);
  const { data: sedes, reload: reloadSedes } = useLoad<{ id: string; name: string; active: boolean }[]>(() => api.get('/sedes'), []);
  const ROLES = [['administrador', 'Administrador'], ['gerente_op', 'Gerente OP'], ['supervisor_op', 'Supervisor OP'], ['jefatura_op', 'Jefatura OP'], ['coordinador', 'Coordinador'], ['validador', 'Validador'], ['facturacion', 'Facturación'], ['cobros', 'Cobros'], ['comercial', 'Comercial'], ['supervisor', 'Supervisor (legado)'], ['operador', 'Operador (legado)'], ['consulta', 'Consulta']];
  const patch = async (u: any, b: any) => { try { await api.patch('/usuarios/' + u.id, b); toast('Usuario actualizado.'); reload(); } catch (e: any) { toast(e.message, true); } };
  const toggleSede = (u: any, id: string, on: boolean) => patch(u, { sedes: on ? [...u.sedes, id] : u.sedes.filter((x: string) => x !== id) });
  // sso + modulo: Operaciones vive en Supabase y da acceso a cuentas de Supabase (las mismas de Transportes)
  const dir = meta?.authMode === 'sso' && meta?.ssoUsers === 'modulo', ext = meta?.authMode === 'sso' && !dir;
  const activas = (sedes ?? []).filter((x) => x.active);
  return (
    <>
      {ext && <div className="note">Los usuarios, los módulos asignados y los roles se gestionan en la app principal (Supabase). Aquí puedes suspender o reactivar el acceso a Operaciones y asignar las sedes de cada persona.</div>}
      {dir && <div className="note">Las cuentas son de Supabase, las mismas de Transportes. Si el correo ya tiene cuenta, se le da acceso a Operaciones y su contraseña no cambia; si no tiene, se crea con la contraseña inicial que escribas.</div>}
      {!ext && <Card title={dir ? 'Dar acceso a Operaciones' : 'Nuevo usuario'} sub="Contraseña de al menos 10 caracteres con letras y números. Otras sedes se agregan después en la lista."><RecordForm submitLabel={dir ? 'Dar acceso' : 'Crear usuario'} initial={{ role: 'operador', sede: meta?.sede?.id }} fields={[{ k: 'email', label: 'Correo', type: 'text', required: true }, { k: 'name', label: 'Nombre', type: 'text', required: true }, { k: 'role', label: 'Rol', type: 'select', required: true, options: ROLES as [string, string][] }, { k: 'sede', label: 'Sede', type: 'select', required: true, options: activas.map((x) => [x.id, x.name] as [string, string]) }, { k: 'password', label: dir ? 'Contraseña inicial (solo si la cuenta es nueva)' : 'Contraseña inicial', type: 'text', required: !dir }]}
        onSubmit={async ({ sede, ...v }) => { try { const r = await api.post('/usuarios', { ...v, sedes: [sede] }); toast(r.existente ? 'La cuenta ya existía: ahora tiene acceso a Operaciones.' : 'Usuario creado.'); reload(); } catch (e: any) { toast(e.message, true); } }} /></Card>}
      <Card title="Usuarios" sub="El administrador entra en todas las sedes; los demás, solo en las marcadas"><Loading err={err} loading={loading && !data} />
        <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Sedes</th><th>Activo</th></tr></thead><tbody>{(data ?? []).map((u) => <tr key={u.id}><td>{u.name}</td><td>{u.email}</td>
          <td><select aria-label={'Rol de ' + u.name} value={u.role} disabled={ext || u.id === meta?.user.id} onChange={(e) => patch(u, { role: e.target.value })}>{ROLES.map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select></td>
          <td>{u.role === 'administrador' ? <span className="muted">Todas</span>
            : <div className="sedes-chk">{activas.map((x) => <label key={x.id} className="chk"><input type="checkbox" checked={u.sedes?.includes(x.id)} onChange={(e) => toggleSede(u, x.id, e.target.checked)} /> {x.name}</label>)}</div>}</td>
          <td><label className="chk"><input type="checkbox" checked={u.active} disabled={u.id === meta?.user.id} onChange={(e) => patch(u, { active: e.target.checked })} /> {u.active ? 'Activo' : 'Inactivo'}</label></td></tr>)}</tbody></table></div></Card>
      <Sedes sedes={sedes} reload={() => { reloadSedes(); reload(); }} />
    </>
  );
}

function Sedes({ sedes, reload }: { sedes: { id: string; name: string; active: boolean }[] | null; reload: () => void }) {
  const { toast, reloadMeta } = useApp();
  const save = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); toast(ok); reload(); void reloadMeta(); } catch (e: any) { toast(e.message, true); } };
  return (
    <Card title="Sedes" sub="Cada sede tiene sus propios registros, periodos e inventario; los catálogos y estándares son comunes">
      <RecordForm submitLabel="Agregar sede" initial={{}} fields={[{ k: 'name', label: 'Nombre de la sede', type: 'text', required: true, hint: 'Por ejemplo: SEDE FRITOLAY OMNIA' }]} onSubmit={(v) => save(() => api.post('/sedes', v), 'Sede agregada.')} />
      <table className="tbl" style={{ marginTop: 12 }}><thead><tr><th>Sede</th><th>Código</th><th>Activa</th></tr></thead><tbody>{(sedes ?? []).map((x) => <tr key={x.id}><td>{x.name}</td><td>{x.id}</td>
        <td><label className="chk"><input type="checkbox" checked={x.active} onChange={(e) => save(() => api.patch('/sedes/' + x.id, { active: e.target.checked }), e.target.checked ? 'Sede activada.' : 'Sede desactivada: nadie entra a ella, sus datos se conservan.')} /> {x.active ? 'Activa' : 'Inactiva'}</label></td></tr>)}</tbody></table>
    </Card>
  );
}

function Bitacora() {
  const [entity, setEntity] = useState('');
  const { data, err, loading } = useLoad<any[]>(() => api.get('/auditoria?limit=200' + (entity ? '&entity=' + entity : '')), [entity]);
  const [sel, setSel] = useState<any>(null);
  return (
    <Card title="Bitácora de cambios" sub="Quién cambió qué, cuándo y por qué" actions={<select aria-label="Filtrar por tipo" value={entity} onChange={(e) => setEntity(e.target.value)}><option value="">Todo</option>{['produccion', 'horas', 'requerimiento', 'merma', 'insumo_mov', 'orden_compra', 'tarifa_cobro', 'cliente', 'proyecto', 'insumo', 'asistencia', 'estandar', 'periodo', 'importacion', 'usuario', 'ajustes', 'conteo'].map((x) => <option key={x}>{x}</option>)}</select>}>
      <Loading err={err} loading={loading && !data} />
      <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Tipo</th><th>Motivo</th><th /></tr></thead><tbody>{(data ?? []).map((a) => <tr key={a.id}><td>{fmtDT(a.at)}</td><td>{a.userEmail ?? 'sistema'}</td><td>{a.action}</td><td>{a.entity}</td><td>{a.reason}</td><td><button className="btn btn-sm" onClick={() => setSel(a)}>Detalle</button></td></tr>)}</tbody></table></div>
      {sel && <Modal title={`${sel.action} · ${sel.entity}`} onClose={() => setSel(null)} wide><div className="grid g2"><div><h4>Antes</h4><pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{JSON.stringify(sel.before, null, 2) ?? '—'}</pre></div><div><h4>Después</h4><pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{JSON.stringify(sel.after, null, 2) ?? '—'}</pre></div></div><div className="mact"><button className="btn" onClick={() => setSel(null)}>Cerrar</button></div></Modal>}
    </Card>
  );
}
function Clientes() {
  const { can, toast, refresh } = useApp();
  const { data: cat, err, loading, reload } = useLoad<any>(() => api.get('/catalogo'), []);
  const [nc, setNc] = useState(''), [np, setNp] = useState({ clientId: '', name: '', um: 'UNIDAD' });
  const edit = can('catalogo.editar');
  const run = async (fn: () => Promise<any>, ok: string) => { try { await fn(); toast(ok); reload(); refresh(); } catch (e: any) { toast(e.message, true); } };
  return (
    <>
      <Loading err={err} loading={loading && !cat} />
      {cat && <>
        {edit && <Card title="Agregar" sub="Los proyectos nuevos registran cantidad y unidad de medida; no tienen motor de costo (se cobran con tarifa en Comercial).">
          <div className="form">
            <div className="field w2"><label htmlFor="nc">Nuevo cliente</label><input id="nc" value={nc} onChange={(e) => setNc(e.target.value)} /></div>
            <div className="factions"><button className="btn btn-blue" disabled={nc.trim().length < 2} onClick={() => run(async () => { await api.post('/catalogo/clientes', { name: nc }); setNc(''); }, 'Cliente agregado.')}>Agregar cliente</button></div>
          </div>
          <div className="form" style={{ marginTop: 8 }}>
            <div className="field"><label htmlFor="pc">Cliente</label><select id="pc" value={np.clientId} onChange={(e) => setNp({ ...np, clientId: e.target.value })}><option value="">Selecciona…</option>{cat.clients.filter((c: any) => c.active).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
            <div className="field w2"><label htmlFor="pn">Nuevo proyecto</label><input id="pn" value={np.name} onChange={(e) => setNp({ ...np, name: e.target.value })} /></div>
            <div className="field"><label htmlFor="pu">Unidad de medida</label><input id="pu" value={np.um} onChange={(e) => setNp({ ...np, um: e.target.value })} /></div>
            <div className="factions"><button className="btn btn-blue" disabled={!np.clientId || np.name.trim().length < 2} onClick={() => run(async () => { await api.post('/catalogo/proyectos', np); setNp({ ...np, name: '' }); }, 'Proyecto agregado.')}>Agregar proyecto</button></div>
          </div>
        </Card>}
        {cat.clients.map((c: any) => (
          <Card key={c.id} title={c.name} sub={c.active ? undefined : 'Inactivo'} actions={edit && <button className="btn btn-sm" onClick={() => run(() => api.patch('/catalogo/clientes/' + c.id, { active: !c.active }), c.active ? 'Cliente desactivado.' : 'Cliente activado.')}>{c.active ? 'Desactivar' : 'Activar'}</button>}>
            <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Proyecto</th><th>U/M</th><th>Tipo</th><th>Estado</th><th /></tr></thead><tbody>
              {cat.projects.filter((p: any) => p.clientId === c.id).map((p: any) => (
                <tr key={p.id}><td>{p.name}</td><td>{p.um}</td><td>{p.kinds[0] === 'gen' ? 'Registro genérico' : 'Con motor de costo'}</td><td>{p.active ? <Pill kind="ok">Activo</Pill> : <Pill kind="warn">Inactivo</Pill>}</td>
                  <td>{edit && <button className="btn btn-sm" onClick={() => run(() => api.patch('/catalogo/proyectos/' + p.id, { active: !p.active }), 'Proyecto actualizado.')}>{p.active ? 'Desactivar' : 'Activar'}</button>}</td></tr>))}
            </tbody></table></div>
          </Card>))}
        <p className="muted">Nada se borra: los clientes y proyectos se desactivan y el historial se conserva.</p>
      </>}
    </>
  );
}
function Secciones() {
  const { toast } = useApp();
  const { data, err, loading, reload } = useLoad<any>(() => api.get('/maquila/admin/secciones'), []);
  const [busy, setBusy] = useState('');
  const LBL: Record<string, string> = { administrador: 'Administrador', gerente_op: 'Gerente OP', supervisor_op: 'Supervisor OP', jefatura_op: 'Jefatura OP', coordinador: 'Coordinador', validador: 'Validador', facturacion: 'Facturación', cobros: 'Cobros', comercial: 'Comercial', supervisor: 'Supervisor (legado)', operador: 'Operador (legado)', consulta: 'Consulta' };
  const toggle = async (perfil: string, seccion: string, habilitado: boolean) => {
    setBusy(perfil + seccion);
    try { await api.put(`/maquila/admin/secciones/${perfil}/${seccion}`, { habilitado }); toast('Visibilidad actualizada.'); reload(); }
    catch (e: any) { toast(e.message, true); } finally { setBusy(''); }
  };
  return (
    <Card title="Secciones de Maquilas" sub="Marca qué secciones ve cada perfil. Las acciones (crear, cerrar, validar, facturar) dependen de sus permisos y no se cambian aquí.">
      <Loading err={err} loading={loading && !data} />
      {data && <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Sección</th>{data.perfiles.map((p: any) => <th key={p.key}>{LBL[p.key] ?? p.key}</th>)}</tr></thead><tbody>
        {data.secciones.map((s: any) => <tr key={s.key}><td>{s.label}<div className="muted"><code>sec_maquila_{s.key}</code></div></td>
          {data.perfiles.map((p: any) => <td key={p.key}><input type="checkbox" aria-label={`${s.label} · ${LBL[p.key] ?? p.key}`} checked={!!data.matriz.find((m: any) => m.perfil === p.key)?.secciones[s.key]} disabled={busy === p.key + s.key} onChange={(e) => toggle(p.key, s.key, e.target.checked)} /></td>)}
        </tr>)}
      </tbody></table></div>}
      <p className="muted">La ausencia de fila equivale a visible. Al apagar una sección, el menú de Maquilas deja de mostrarla para ese perfil.</p>
    </Card>
  );
}
void nf; void nf2; void q2;
