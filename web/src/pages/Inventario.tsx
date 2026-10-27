import { useState } from 'react';
import { api } from '../api';
import { Card, Loading, MonthBar, Pill, Tabs, useLoad } from '../components';
import { fmtDate, nf, nf2, q2 } from '../format';
import { D, RecordForm, RecordsPanel, usePeriod, type FieldDef } from '../records-ui';
import { useApp } from '../store';

const GN: Record<string, string> = { wm: 'Walmart', uni: 'Unisuper', etq: 'Etiquetado', maq: 'Maquila' };
const unitOf = (i: any) => (i.kind === 'rib' ? 'rollos' : i.kind === 'ins' ? (i.unit ?? 'u').toLowerCase() : 'unidades');

export default function Inventario() {
  const { month, can, toast, refresh, meta } = useApp();
  const [tab, setTab] = useState<'mov' | 'ins' | 'merma' | 'conteo' | 'mat'>('mov');
  const { data, err, loading } = useLoad<any>(() => (month ? api.get('/inventario?mes=' + month) : Promise.resolve(null)), [month]);
  const { data: cat } = useLoad<any>(() => api.get('/catalogo'), []);
  const items: any[] = cat?.items ?? [];
  const upr = (id: string) => items.find((i) => i.id === id)?.unitsPerRoll as number | undefined;
  const inv = data?.inventory;
  const rolls = (id: string, v: number) => (upr(id) ? nf2(v / upr(id)!) + ' rollos' : '');
  return (
    <>
      <MonthBar status={data?.status} />
      <Loading err={err} loading={loading && !data} />
      {data && <>
        <div className="tiles">
          {(data.stock ?? []).map((s: any) => (
            <div key={s.id} className={'tile ' + (s.level === 'negativo' ? 'bad' : s.level === 'bajo' ? 'warn' : '')}>
              <div className="nm">{s.name}</div>
              <div className="sv">{s.kind === 'rib' ? nf2(s.stock) + ' rollos' : s.kind === 'ins' ? nf2(s.stock) + ' ' + (s.unit ?? 'u').toLowerCase() : nf(s.stock) + (s.kind === 'bag' ? ' bolsas' : ' u')}</div>
              {s.kind === 'lab' && <small>{rolls(s.id, s.stock)}</small>}
              <small>{s.level === 'negativo' ? 'Negativo: revisa el conteo o los ingresos' : s.daysCover == null ? 'Sin consumo reciente' : s.daysCover < 1 ? 'Se acaba hoy' : `Alcanza ~${Math.floor(s.daysCover)} días (promedio de 4 semanas)`}</small>
            </div>))}
        </div>
        <p className="muted" style={{ marginBottom: 10 }}>Inventario al día de hoy = conteo físico del {fmtDate(meta?.inventoryBaseDate)} + ingresos (órdenes de compra completadas y requerimientos) − consumo − merma.</p>
      </>}
      <Tabs sub value={tab} onChange={setTab} items={[['mov', 'Movimiento del mes'], ['ins', 'Insumos'], ['merma', 'Merma'], ['conteo', 'Conteo físico'], ['mat', 'Etiqueta por material']]} />
      {tab === 'mov' && inv && <>
        <Card title="Movimiento del mes" sub="Inicial + ingresos − consumo − merma = final">
          <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Artículo</th><th className="n">Inicial</th><th className="n">Ingresos</th><th className="n">Consumo</th><th className="n">Merma</th><th className="n">Final</th><th className="n">Costo unitario</th><th className="n">Costo consumido</th></tr></thead><tbody>
            {inv.rows.map((r: any) => { const f = r.kind === 'rib' || r.kind === 'ins' ? nf2 : nf; return (
              <tr key={r.id}><td><b>{r.name}</b></td><td className="n">{f(r.ini)}</td><td className="n">{r.ing ? '+' + f(r.ing) : ''}</td><td className="n">{r.con ? '−' + f(r.con) : ''}</td><td className="n">{r.mer ? '−' + f(r.mer) : ''}</td>
                <td className={'n ' + (r.fin < 0 ? 'neg' : '')}><b>{f(r.fin)}</b>{r.kind === 'lab' && r.finRolls != null && <div className="muted">{nf2(r.finRolls)} rollos</div>}</td>
                <td className="n">{r.price == null ? <Pill kind="warn">Sin precio</Pill> : r.kind === 'bag' ? 'Q' + r.unitCost.toFixed(4) : q2(r.unitCost) + (r.kind === 'rib' ? '/rollo' : '/u')}</td><td className="n">{r.con + r.mer ? q2(r.costConsumed) : ''}</td></tr>); })}
          </tbody></table></div>
        </Card>
        <Card title="Costo consumido por rubro" sub="Así se resta en el resumen del mes (Excel y PDF)">
          <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Artículo</th>{Object.keys(GN).map((g) => <th key={g} className="n">{GN[g]}</th>)}<th className="n">Merma</th></tr></thead><tbody>
            {inv.rows.filter((r: any) => Object.keys(r.conG).length || r.mer).map((r: any) => <tr key={r.id}><td>{r.name}</td>{Object.keys(GN).map((g) => <td key={g} className="n">{r.conG[g] ? q2(r.conG[g] * r.unitCost) : ''}</td>)}<td className="n">{r.mer ? q2(r.mer * r.unitCost) : ''}</td></tr>)}
          </tbody></table></div>
        </Card>
      </>}
      {tab === 'ins' && <Insumos items={items.filter((i) => i.kind === 'ins')} projects={cat?.projects ?? []} clients={cat?.clients ?? []} />}
      {tab === 'merma' && <RecordsPanel title="Merma" path="merma" createPerm="inventario.gestionar" hint="Etiquetas dañadas o mal impresas, bolsas dañadas (en unidades)"
        fields={[{ k: 'date', label: 'Fecha', type: 'date', required: true }, { k: 'itemId', label: 'Artículo', type: 'select', required: true, options: items.filter((i) => i.kind !== 'rib').map((i) => [i.id, i.name] as [string, string]) }, { k: 'units', label: 'Unidades', type: 'int', required: true }, { k: 'reason', label: 'Motivo', type: 'text', w: 2 }]}
        columns={[{ h: 'Fecha', cell: D }, { h: 'Artículo', cell: (r) => items.find((i) => i.id === r.itemId)?.name ?? r.itemId }, { h: 'Unidades', n: true, cell: (r) => nf(r.units) }, { h: 'Motivo', cell: (r) => r.reason }]} />}
      {tab === 'conteo' && <Conteo items={items} can={can('inventario.gestionar')} onSaved={() => { toast('Conteo guardado.'); refresh(); }} />}
      {tab === 'mat' && <Materiales cat={cat} canEdit={can('catalogo.editar')} />}
    </>
  );
}

function Conteo({ items, can, onSaved }: { items: any[]; can: boolean; onSaved: () => void }) {
  const { toast, meta } = useApp(); const per = usePeriod();
  const { data } = useLoad<any[]>(() => api.get('/inventario/conteos'), []);
  const last = data?.[0]?.date as string | undefined;
  const fields: FieldDef[] = [{ k: 'date', label: 'Fecha del conteo', type: 'date', required: true }, ...items.map((i) => ({ k: i.id, label: `${i.name} (${unitOf(i)})`, type: 'num' as const }))];
  const initial: Record<string, any> = { date: meta?.today };
  for (const r of data ?? []) if (r.date === last) initial[r.itemId] = r.qty;
  const save = async (v: Record<string, any>) => {
    const { date, ...rest } = v; const its = Object.fromEntries(Object.entries(rest).filter(([, x]) => x !== '' && x != null));
    try { await api.put('/inventario/conteo', { date, items: its }); onSaved(); } catch (e: any) { toast(e.message, true); }
  };
  return (
    <Card title="Conteo físico (inventario inicial)" sub={`Último conteo: ${fmtDate(last)} · desde ahí se suman ingresos y se restan consumos y merma`}>
      {can && per?.status !== 'cerrado' ? <RecordForm fields={fields} initial={initial} onSubmit={save} submitLabel="Guardar conteo" /> : <p className="muted">Solo un supervisor puede registrar conteos.</p>}
      <p className="muted" style={{ marginTop: 8 }}>El motor usa el conteo más reciente como base y rueda hacia adelante o atrás. Un conteo nuevo debe registrarse al cierre del día indicado.</p>
    </Card>
  );
}

function Materiales({ cat, canEdit }: { cat: any; canEdit: boolean }) {
  const { toast, refresh } = useApp();
  const [rows, setRows] = useState<any[] | null>(null);
  const mats: any[] = rows ?? cat?.materialLabels ?? [];
  const labs: string[] = (cat?.items ?? []).filter((i: any) => i.kind === 'lab').map((i: any) => i.code);
  const [f, setF] = useState({ sap: '', name: '', label: '' });
  const set = async (m: any, label: string, confirmed?: boolean) => { try { const r = await api.patch('/catalogo/materiales/' + m.id, { label, confirmed }); setRows(mats.map((x) => (x.id === m.id ? r : x))); refresh(); } catch (e: any) { toast(e.message, true); } };
  const add = async (e: React.FormEvent) => { e.preventDefault(); try { const r = await api.post('/catalogo/materiales', f); setRows([...mats, r]); setF({ sap: '', name: '', label: '' }); toast('Material agregado.'); } catch (x: any) { toast(x.message, true); } };
  const del = async (m: any) => { try { await api.del('/catalogo/materiales/' + m.id); setRows(mats.filter((x) => x.id !== m.id)); } catch (e: any) { toast(e.message, true); } };
  const pend = mats.filter((m) => !m.confirmed).length;
  return (
    <Card title="Etiqueta por material" sub={`${mats.length} materiales${pend ? ` · ${pend} por confirmar` : ''}`}>
      <p className="muted">Qué etiqueta lleva cada material. Al elegir la etiqueta queda confirmada.</p>
      {canEdit && <form className="form" onSubmit={add} style={{ margin: '10px 0' }}>
        <div className="field"><label htmlFor="ms">Código SAP</label><input id="ms" inputMode="numeric" value={f.sap} onChange={(e) => setF({ ...f, sap: e.target.value })} /></div>
        <div className="field w2"><label htmlFor="mn">Material</label><input id="mn" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div className="field"><label htmlFor="ml">Etiqueta</label><select id="ml" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })}><option value="">Por definir</option>{labs.map((l) => <option key={l}>{l}</option>)}<option value="SUN">Sunchips (1X1+4X2+1.25X0.5)</option><option value="none">No lleva etiqueta</option></select></div>
        <div className="factions"><button className="btn btn-blue">Agregar material</button></div></form>}
      <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Código</th><th>Material</th><th>Etiqueta</th><th>Estado</th><th /></tr></thead><tbody>
        {[...mats].sort((a, b) => Number(a.confirmed) - Number(b.confirmed) || a.name.localeCompare(b.name)).map((m) => (
          <tr key={m.id}><td>{m.sap ? <span className="sap">{m.sap}</span> : '—'}</td><td>{m.name}</td>
            <td>{canEdit ? <select aria-label={'Etiqueta de ' + m.name} value={m.label} onChange={(e) => set(m, e.target.value)}><option value="">Por definir</option>{labs.map((l) => <option key={l}>{l}</option>)}<option value="SUN">Sunchips</option><option value="none">No lleva</option></select> : m.label || 'Por definir'}</td>
            <td>{m.confirmed ? <Pill kind="ok">Confirmada</Pill> : m.label ? <><Pill kind="warn">Sugerida</Pill>{canEdit && <> <button className="btn btn-sm" onClick={() => set(m, m.label, true)}>Confirmar</button></>}</> : <Pill kind="warn">Por definir</Pill>}</td>
            <td>{canEdit && <button className="btn btn-sm btn-danger" onClick={() => del(m)} aria-label={'Quitar ' + m.name}>✕</button>}</td></tr>))}
      </tbody></table></div>
    </Card>
  );
}

function Insumos({ items, projects, clients }: { items: any[]; projects: any[]; clients: any[] }) {
  const { can, toast, refresh, meta } = useApp();
  const [open, setOpen] = useState(false), [f, setF] = useState({ code: '', name: '', unit: 'UNIDAD', price: '' });
  const pl = (id: string) => { const p = projects.find((x) => x.id === id); return p ? `${clients.find((c) => c.id === p.clientId)?.name ?? ''} · ${p.name}` : ''; };
  const add = async (e: React.FormEvent) => { e.preventDefault(); try { await api.post('/catalogo/insumos', { ...f, price: f.price === '' ? null : +f.price }); toast('Insumo creado.'); setF({ code: '', name: '', unit: 'UNIDAD', price: '' }); setOpen(false); refresh(); } catch (x: any) { toast(x.message, true); } };
  return (
    <>
      <Card title="Catálogo de insumos" sub="Se alimentan con las órdenes de compra completadas y se consumen desde producción o con movimientos manuales"
        actions={can('inventario.gestionar') && <button className="btn btn-blue" onClick={() => setOpen(!open)}>＋ Nuevo insumo</button>}>
        {open && <form className="form" onSubmit={add} style={{ marginBottom: 10 }}>
          <div className="field"><label htmlFor="ic">Código</label><input id="ic" required value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></div>
          <div className="field w2"><label htmlFor="in">Nombre</label><input id="in" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
          <div className="field"><label htmlFor="iu">Unidad</label><input id="iu" required value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} /></div>
          <div className="field"><label htmlFor="ip">Costo unitario (Q)</label><input id="ip" type="number" min={0} step="any" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></div>
          <div className="factions"><button className="btn btn-primary">Crear insumo</button></div></form>}
        {!items.length ? <p className="muted">Aún no hay insumos.</p> : <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Código</th><th>Nombre</th><th>Unidad</th><th className="n">Costo unitario</th></tr></thead><tbody>
          {items.map((i) => <tr key={i.id}><td className="sap">{i.code}</td><td>{i.name}</td><td>{i.unit}</td><td className="n">{i.price == null ? <Pill kind="warn">Sin precio</Pill> : q2(i.price)}</td></tr>)}</tbody></table></div>}
      </Card>
      <RecordsPanel title="Movimientos de insumos" path="insumos/movimientos" createPerm="inventario.gestionar" hint="Ingresos manuales y consumo ligado a un proyecto de producción (el costo se carga al área)"
        fields={[{ k: 'date', label: 'Fecha', type: 'date', required: true }, { k: 'itemId', label: 'Insumo', type: 'select', required: true, options: items.map((i) => [i.id, i.name] as [string, string]) },
          { k: 'kind', label: 'Movimiento', type: 'select', required: true, options: [['ingreso', 'Ingreso'], ['consumo', 'Consumo']] }, { k: 'qty', label: 'Cantidad', type: 'num', required: true },
          { k: 'projectId', label: 'Proyecto (consumo)', type: 'select', w: 2, options: projects.filter((p) => p.active).map((p) => [p.id, pl(p.id)] as [string, string]) }, { k: 'notes', label: 'Notas', type: 'text', w: 2 }]}
        columns={[{ h: 'Fecha', cell: D }, { h: 'Insumo', cell: (r) => items.find((i) => i.id === r.itemId)?.name ?? r.itemId }, { h: 'Movimiento', cell: (r) => (r.kind === 'ingreso' ? 'Ingreso' : 'Consumo') + (r.poLineId ? ' (OC)' : '') },
          { h: 'Cantidad', n: true, cell: (r) => nf2(r.qty) }, { h: 'Proyecto', cell: (r) => (r.projectId ? pl(r.projectId) : '') }, { h: 'Notas', cell: (r) => r.notes }]} />
    </>
  );
}
