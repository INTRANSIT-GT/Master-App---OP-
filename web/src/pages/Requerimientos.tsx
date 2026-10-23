import { api } from '../api';
import { useLoad } from '../components';
import { nfx, q2 } from '../format';
import { D, RecordsPanel, type FieldDef } from '../records-ui';
import { useApp } from '../store';

export default function Requerimientos() {
  const { meta } = useApp();
  const { data: cat } = useLoad<any>(() => api.get('/catalogo'), []);
  const labs = (cat?.items ?? []).filter((i: any) => i.kind === 'lab'), ribs = (cat?.items ?? []).filter((i: any) => i.kind === 'rib');
  const fields: FieldDef[] = [
    { k: 'date', label: 'Fecha de solicitado', type: 'date', required: true },
    { k: 'area', label: 'Área / proceso', type: 'select', required: true, options: meta?.areas ?? [] },
    { k: 'oc', label: 'No. de OC', type: 'text' }, { k: 'amount', label: 'Monto total (Q)', type: 'num', required: true, step: '0.01' }, { k: 'supplier', label: 'Proveedor', type: 'text' },
    { k: 'matType', label: 'Tipo de material', type: 'select', required: true, options: [['Etiqueta', 'Etiqueta (entra a inventario)'], ['Ribbon', 'Ribbon (entra a inventario)'], ['Bolsa', 'Bolsa (entra a inventario)'], ['Directo', 'Directo (resta del área)'], ['Otro', 'Otro (resta del área)']] },
    { k: 'matRef', label: 'Material', type: 'text', w: 2, list: 'matList', hint: 'Etiqueta: 3X2, 4X2… · Ribbon: R76 o R110 · Otro: descríbelo' },
    { k: 'qty', label: 'Cantidad', type: 'num', hint: 'Rollos de etiqueta/ribbon o unidades de bolsa' }, { k: 'notes', label: 'Observaciones', type: 'text', w: 2 },
  ];
  return (
    <>
      <datalist id="matList">{labs.map((l: any) => <option key={l.id} value={l.code}>{l.name}</option>)}{ribs.map((r: any) => <option key={r.id} value={r.code}>{r.name}</option>)}<option value="BOLSA" /><option value="Etiqueta fluorescente 0.75X0.40625" /></datalist>
      <RecordsPanel title="Requerimientos" path="requerimientos" fields={fields} createPerm="requerimiento.gestionar" hint="Etiquetas, ribbon y bolsa entran al inventario; lo demás se resta del área en el Resumen"
        columns={[{ h: 'Fecha', cell: D }, { h: 'Área', cell: (r) => meta?.areas.find((a) => a[0] === r.area)?.[1] ?? r.area }, { h: 'OC', cell: (r) => r.oc }, { h: 'Monto', n: true, cell: (r) => q2(r.amount) }, { h: 'Proveedor', cell: (r) => r.supplier }, { h: 'Cantidad', n: true, cell: (r) => nfx(r.qty) }, { h: 'Material', cell: (r) => `${r.matType}: ${r.matRef ?? ''}` }, { h: 'Obs.', cell: (r) => r.notes }]} />
    </>
  );
}
