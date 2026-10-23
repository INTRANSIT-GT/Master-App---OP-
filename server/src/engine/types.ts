export type Mode = 'mpt' | 'mpu' | 'uph' | 'hrs' | 'man' | 'none';

export interface LineDef { key: string; resultsGroup: string; summaryGroup: string; name: string; um: string; mode: Mode; billableLabel?: string | null; sort: number }
export interface ProductDef { sap: string; name: string; sort: number }
export interface StandardRow { scope: 'product' | 'line'; key: string; tt: number | null; unitsPerPallet: number | null; unitRate: number | null; validFrom: string; validTo: string | null }
export interface InvItem { id: string; kind: 'lab' | 'rib' | 'bag' | 'ins'; code: string; name: string; unitsPerRoll: number | null; ribbonId: string | null; ribbonYield: number | null; price: number | null }

export interface ProdRec {
  kind: 'maq' | 'wm' | 'cob' | 'desc' | 'uni' | 'dc' | 'revm' | 'etq' | 'noc' | 'qua' | 'sun' | 'crk';
  date: string; sap?: string | null; productName?: string | null;
  boxes: number; units: number; unitsPerBox?: number | null; billableBoxes?: number | null; labelsUsed?: number | null;
  labelId?: string | null; reviewUnits: number; badBoxes: number; containerType?: string | null;
}
export interface HoursRec { kind: 'imp'; date: string; hoursDay: number; hoursNight: number }
export interface ReqRec { date: string; area: string; amount: number; matType: 'Etiqueta' | 'Ribbon' | 'Bolsa' | 'Directo' | 'Otro'; matRef: string | null; qty: number }
export interface SupplyRec { date: string; itemId: string; kind: 'ingreso' | 'consumo'; qty: number; area: string | null }
export interface ScrapRec { date: string; itemId: string; units: number }

export interface EngineSettings {
  inicio: string;
  wmDiv: number;
  crkDefaultUnitsPerBox: number;
  sunLabels: string[];
  wmLabel: string;           // etiqueta que consume Walmart (1 por caja)
  uniLabel: string;          // etiqueta que consume Unisuper (columna "etiquetas utilizadas")
}
export interface EngineData {
  lines: LineDef[]; products: ProductDef[]; standards: StandardRow[]; settings: EngineSettings; items: InvItem[];
  bagUsage: Record<string, number>;
  base: { date: string | null; qty: Record<string, number> };
  prod: ProdRec[]; hours: HoursRec[]; attendance: Record<string, number>; reqs: ReqRec[]; scrap: ScrapRec[]; supply: SupplyRec[];
  mw: Record<string, [number, number]>;
}
export const RES_ORDER = ['maq','desc','etq','rev','wm','cob','uni','crk','dc','revm'];
export const RES_NAME: Record<string, string> = {
  maq: 'Maquilas', desc: 'Descargas', etq: 'Etiquetado', rev: 'Revisión', wm: 'Walmart', cob: 'Maquila Cobán', uni: 'Maquila Unisuper',
  crk: 'Ristras Crackets', dc: 'Dollar City', revm: 'Revisión de unidades (materiales)',
};
export const AREAS: [string, string][] = [['maq','Maquila'],['desc','Descargas'],['etq','Etiquetado'],['rev','Revisión'],['wm','Walmart'],['cob','Embolsado Cobán'],['uni','Unisuper'],['crk','Crackets'],['dc','Dollar City'],['gen','General']];
