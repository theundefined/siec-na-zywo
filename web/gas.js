import { tipRows, fmt0, fmt2 } from './charts.js';
import { pse, eurostat, EU_NAMES, plural, warsaw, todayIso, addDays, MONTHS, $, esc, errorBox, empty, table, tilesHtml, drawChart, initTheme, initInstall, initTabs, clearGroups, rangeSeg, yearSelect } from './common.js';

// ---------- Źródło: ENTSOG Transparency Platform (dane GAZ-SYSTEM), bez klucza, CORS * ----------
// Przepływy fizyczne (Physical Flow) i moc techniczna ciągła (Firm Technical) w punktach systemu przesyłowego,
// doby gazowe 6:00–6:00, kWh/d (ciepło spalania). PL-TSO-0002 = GAZ-SYSTEM, PL-TSO-0001 = GAZ-SYSTEM jako
// niezależny operator gazociągu jamalskiego (punkt Mallnow).
const ENTSOG = 'https://transparency.entsog.eu/api/v1/operationaldatas';
const OPERATORS = ['PL-TSO-0002', 'PL-TSO-0001'];
const HISTORY_DAYS = 370;

async function entsog(operator, from, to) {
  const q = new URLSearchParams({ operatorKey: operator, indicator: 'Physical Flow,Firm Technical', periodType: 'day', from, to, timezone: 'CET', limit: '-1' });
  const r = await fetch(`${ENTSOG}?${q}`);
  if (r.status === 404) return []; // API odpowiada 404 „No result found”, gdy brak danych
  if (!r.ok) throw new Error(`ENTSOG: HTTP ${r.status}`);
  return (await r.json()).operationaldatas || [];
}

const num = (v) => {
  if (v == null || v === '') return null;
  const x = typeof v === 'number' ? v : parseFloat(v);
  return isFinite(x) ? x / 1e6 : null; // kWh/d → GWh/d
};

// ---------- Słowniki ----------
// Grupy dostaw (wejścia do systemu) i odbioru (wyjścia) — kolejność = kolejność warstw od dołu.
// Kolory sprawdzone walidatorem palet (sąsiednie pary, tryb jasny i ciemny); magazyny zawsze pomarańczowe.
const SUPPLY = [
  { id: 'prod', name: 'Wydobycie krajowe', color: 'var(--s6)' },
  { id: 'bp', name: 'Baltic Pipe (Norwegia)', color: 'var(--s1)' },
  { id: 'lng', name: 'Terminal LNG Świnoujście', color: 'var(--s4)' },
  { id: 'de', name: 'Import z Niemiec', color: 'var(--s5)' },
  { id: 'cz', name: 'Import z Czech', color: 'var(--s7)' },
  { id: 'lt', name: 'Import z Litwy', color: 'var(--s8)' },
  // Import z Ukrainy jest marginalny (ok. 0,15 TWh/rok), a paleta ma 8 barw — na wykresie łączymy go ze Słowacją,
  // w dymku i tabeli pokazujemy osobno.
  { id: 'skua', name: 'Import ze Słowacji i Ukrainy', color: 'var(--s3)', parts: [['sk', 'Import ze Słowacji'], ['ua', 'Import z Ukrainy']] },
  { id: 'ugsOut', name: 'Odbiór z magazynów', color: 'var(--s2)' },
];
const USE = [
  { id: 'dist', name: 'Sieci dystrybucyjne', color: 'var(--s3)' },
  { id: 'fc', name: 'Odbiorcy przyłączeni do przesyłu', color: 'var(--s1)' },
  { id: 'ugsIn', name: 'Zatłaczanie do magazynów', color: 'var(--s2)' },
  { id: 'exp', name: 'Eksport', color: 'var(--s7)' },
];
// [punkt, kierunek, grupa, znak]. Wejścia z sieci dystrybucyjnej i wyjścia do odazotowni L odejmujemy,
// żeby grupy pokazywały przepływ netto (inaczej gaz przechodzący przez podsystem L liczyłby się dwa razy).
const RULES = [
  ['PRD-00153', 'entry', 'prod', 1], // złoża krajowe, gaz wysokometanowy
  ['FNC-00008', 'entry', 'prod', 1], // odazotownie (gaz z krajowych złóż zaazotowanych)
  ['PRD-00218', 'entry', 'prod', 1], // złoża krajowe, gaz zaazotowany (L)
  ['PRD-00219', 'exit', 'prod', -1],
  ['ITP-10009', 'entry', 'bp', 1],
  ['LNG-00006', 'entry', 'lng', 1],
  ['ITP-00497', 'entry', 'de', 1],
  ['ITP-00096', 'entry', 'de', 1],
  ['ITP-00158', 'entry', 'cz', 1],
  ['DIS-00195', 'entry', 'cz', 1],
  ['DIS-00204', 'entry', 'cz', 1],
  ['ITP-00556', 'entry', 'lt', 1],
  ['ITP-00177', 'entry', 'skua', 1],
  ['ITP-00177', 'entry', 'sk', 1],
  ['ITP-10008', 'entry', 'skua', 1],
  ['ITP-10008', 'entry', 'ua', 1],
  ['DIS-00013', 'exit', 'dist', 1],
  ['DIS-00013', 'entry', 'dist', -1],
  ['DIS-00193', 'exit', 'dist', 1],
  ['DIS-00193', 'entry', 'dist', -1],
  ['FNC-00002', 'exit', 'fc', 1],
  ['FNC-00040', 'exit', 'fc', 1],
  ['FNC-00007', 'exit', 'fc', 1],
  ['ITP-10009', 'exit', 'exp', 1],
  ['ITP-00497', 'exit', 'exp', 1],
  ['ITP-00096', 'exit', 'exp', 1],
  ['ITP-10008', 'exit', 'exp', 1],
  ['ITP-00158', 'exit', 'exp', 1],
  ['ITP-00177', 'exit', 'exp', 1],
  ['ITP-00556', 'exit', 'exp', 1],
  ['DIS-00204', 'exit', 'exp', 1],
];
// Próg (GWh/d w którejkolwiek dobie), od którego nieznany punkt uznajemy za istotny.
const UNKNOWN_MIN = 1;
// Grupy dla punktów spoza listy — dodawane do SUPPLY/USE tylko, gdy takie punkty wystąpią.
const UNK_IN = { id: 'unkIn', name: 'Nieprzypisane wejścia', color: 'var(--ink-2)' };
const UNK_OUT = { id: 'unkOut', name: 'Nieprzypisane wyjścia', color: 'var(--ink-2)' };
const STORAGES = [
  { key: 'UGS-00426', name: 'Wierzchowice' },
  { key: 'UGS-00425', name: 'GIM Sanok' },
  { key: 'UGS-00424', name: 'GIM Kawerna (Mogilno, Kosakowo)' },
  { key: 'UGS-00322', name: 'Magazyn LNG Janowice' },
];
// Punkty na granicach i magazyny do porównania przepływu z mocą techniczną.
const POINTS = [
  { key: 'ITP-10009', dir: 'entry', name: 'Baltic Pipe (Faxe) → PL', color: 'var(--s1)', line: true },
  { key: 'LNG-00006', dir: 'entry', name: 'Terminal LNG Świnoujście', color: 'var(--s4)', line: true },
  { key: 'ITP-00497', dir: 'entry', name: 'Niemcy (GCP) → PL', color: 'var(--s5)', line: true },
  { key: 'ITP-00096', dir: 'entry', name: 'Niemcy (Mallnow, rewers) → PL', color: 'var(--s5)' },
  { key: 'ITP-10008', dir: 'entry', name: 'Ukraina → PL', color: 'var(--s3)' },
  { key: 'ITP-10008', dir: 'exit', name: 'PL → Ukraina', color: 'var(--s3)' },
  { key: 'ITP-00177', dir: 'entry', name: 'Słowacja → PL', color: 'var(--s3)' },
  { key: 'ITP-00177', dir: 'exit', name: 'PL → Słowacja', color: 'var(--s3)' },
  { key: 'ITP-00158', dir: 'entry', name: 'Czechy → PL', color: 'var(--s7)' },
  { key: 'ITP-00158', dir: 'exit', name: 'PL → Czechy', color: 'var(--s7)' },
  { key: 'ITP-00556', dir: 'entry', name: 'Litwa → PL', color: 'var(--s8)' },
  { key: 'ITP-00556', dir: 'exit', name: 'PL → Litwa', color: 'var(--s8)' },
  { key: 'ITP-10009', dir: 'exit', name: 'PL → Dania (Baltic Pipe)', color: 'var(--s1)' },
  { key: 'UGS-00426', dir: 'entry', name: 'Wierzchowice — odbiór', color: 'var(--s2)' },
  { key: 'UGS-00426', dir: 'exit', name: 'Wierzchowice — zatłaczanie', color: 'var(--s2)' },
  { key: 'UGS-00425', dir: 'entry', name: 'GIM Sanok — odbiór', color: 'var(--s2)' },
  { key: 'UGS-00425', dir: 'exit', name: 'GIM Sanok — zatłaczanie', color: 'var(--s2)' },
  { key: 'UGS-00424', dir: 'entry', name: 'GIM Kawerna — odbiór', color: 'var(--s2)' },
  { key: 'UGS-00424', dir: 'exit', name: 'GIM Kawerna — zatłaczanie', color: 'var(--s2)' },
];

// Wymiana z sąsiadami: punkty wejścia (import) i wyjścia (eksport) na każdej granicy.
const BORDERS = [
  { name: 'Dania (Baltic Pipe)', imp: [['ITP-10009', 'entry']], exp: [['ITP-10009', 'exit']] },
  { name: 'Niemcy', imp: [['ITP-00497', 'entry'], ['ITP-00096', 'entry']], exp: [['ITP-00497', 'exit'], ['ITP-00096', 'exit']] },
  { name: 'Czechy', imp: [['ITP-00158', 'entry'], ['DIS-00195', 'entry'], ['DIS-00204', 'entry']], exp: [['ITP-00158', 'exit'], ['DIS-00204', 'exit']] },
  { name: 'Słowacja', imp: [['ITP-00177', 'entry']], exp: [['ITP-00177', 'exit']] },
  { name: 'Ukraina', imp: [['ITP-10008', 'entry']], exp: [['ITP-10008', 'exit']] },
  { name: 'Litwa', imp: [['ITP-00556', 'entry']], exp: [['ITP-00556', 'exit']] },
];

// ---------- Formatowanie ----------
const gwh = (v) => (v == null ? '—' : `${fmt0.format(v)} GWh`);
const fDay = new Intl.DateTimeFormat('pl-PL', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const fDM = new Intl.DateTimeFormat('pl-PL', { timeZone: 'UTC', day: 'numeric', month: 'numeric' });
const dt = (iso) => new Date(iso + 'T00:00:00Z');
const gasDay = (iso) => `doba gazowa ${fDay.format(dt(iso))}`;
const pct = (v) => (v == null ? '—' : `${fmt0.format(v)}%`);
const sum = (a) => a.reduce((s, v) => s + (v ?? 0), 0);
const avgOf = (a) => { const x = a.filter((v) => v != null); return x.length ? sum(x) / x.length : null; };

// Etykiety osi dni: przy powiększeniu co dzień, potem poniedziałki, a przy długich zakresach początki miesięcy.
function dayTicks(days) {
  return (v0, v1) => {
    const span = v1 - v0;
    const out = [];
    for (let i = Math.max(0, Math.floor(v0)); i <= Math.min(days.length - 1, Math.ceil(v1)); i++) {
      const d = dt(days[i]);
      if (span > 75) {
        if (d.getUTCDate() === 1) out.push({ i, label: MONTHS[d.getUTCMonth()] + (d.getUTCMonth() === 0 ? ` ${d.getUTCFullYear()}` : '') });
      } else if (span > 16) {
        if (d.getUTCDay() === 1) out.push({ i, label: fDM.format(d) });
      } else out.push({ i, label: fDM.format(d) });
    }
    return out;
  };
}

// ---------- Dane ----------
let data; // { days, flow: Map(key|dir → GWh[]), cap: Map(key|dir → GWh[]) }
let power; // Map(dzień → GWh energii elektrycznej z gazu)

async function loadData() {
  const to = todayIso();
  const from = addDays(to, -HISTORY_DAYS);
  const rows = (await Promise.all(OPERATORS.map((op) => entsog(op, from, to)))).flat();
  const flowRaw = new Map();
  const capRaw = new Map();
  const meta = new Map(); // punkt|kierunek → {label, type}
  let last = '';
  for (const r of rows) {
    if (r.pointKey.startsWith('VTP') || r.pointKey === 'ITP-00293') continue; // punkty wirtualne i połączenie wewnętrzne z gazociągiem jamalskim
    const k = `${r.pointKey}|${r.directionKey}`;
    const v = num(r.value);
    if (!meta.has(k)) meta.set(k, { key: r.pointKey, dir: r.directionKey, label: r.pointLabel, type: r.pointType || '' });
    if (r.indicator === 'Physical Flow') {
      const day = r.periodFrom.slice(0, 10);
      if (!flowRaw.has(k)) flowRaw.set(k, new Map());
      if (v != null) {
        flowRaw.get(k).set(day, (flowRaw.get(k).get(day) || 0) + v);
        if (day > last) last = day;
      }
    } else {
      if (!capRaw.has(k)) capRaw.set(k, []);
      capRaw.get(k).push({ from: r.periodFrom.slice(0, 10), to: r.periodTo.slice(0, 10), v });
    }
  }
  // Trwająca doba gazowa (od 6:00) ma tylko część danych — pomijamy ją, podobnie jak końcowe doby,
  // w których raportowało wyraźnie mniej punktów niż zwykle.
  const nowKey = warsaw(Date.now());
  const current = nowKey.slice(11) >= '06:00' ? nowKey.slice(0, 10) : addDays(nowKey.slice(0, 10), -1);
  const count = (d) => [...flowRaw.values()].filter((m) => m.has(d)).length;
  const typical = Math.max(...[1, 2, 3, 4, 5, 6, 7].map((k) => count(addDays(current, -k))));
  last = last >= current ? addDays(current, -1) : last;
  while (last > from && count(last) < typical * 0.9) last = addDays(last, -1);
  if (!last || !typical) return { days: [], flow: new Map(), cap: new Map(), unknown: [] };
  const days = [];
  for (let d = addDays(last, -HISTORY_DAYS + 5); d <= last; d = addDays(d, 1)) days.push(d);
  const flow = new Map([...flowRaw].map(([k, m]) => [k, days.map((d) => m.get(d) ?? null)]));
  const cap = new Map([...capRaw].map(([k, list]) => {
    list.sort((a, b) => (a.from < b.from ? -1 : 1));
    return [k, days.map((d) => {
      let v = null;
      for (const p of list) if (p.from <= d && d < p.to) v = p.v; // późniejszy okres (np. doba zmiany czasu) nadpisuje dłuższy
      return v;
    })];
  }));
  // Punkty spoza RULES/STORAGES z niezerowym przepływem (np. nowy terminal lub połączenie) — nie mogą po cichu wypaść z bilansu.
  const known = new Set([...RULES.map(([k, d]) => `${k}|${d}`), ...STORAGES.flatMap((x) => [`${x.key}|entry`, `${x.key}|exit`])]);
  const unknown = [...flow].filter(([k, vals]) => !known.has(k) && Math.max(0, ...vals.map((v) => v ?? 0)) >= UNKNOWN_MIN)
    .map(([k, vals]) => ({ ...meta.get(k), avg: vals.reduce((a, v) => a + (v ?? 0), 0) / vals.length }));
  return { days, flow, cap, unknown };
}

async function loadPower(from) {
  // Generacja z gazu ziemnego (GZ) i koksowniczego (GK) z PSE: kwadranse MW → energia doby kalendarzowej.
  const rows = await pse('his-gen-pal-sire', `business_date ge '${from}' and (alias_sire eq 'GZ' or alias_sire eq 'GK')`, 100000, 'business_date,alias_sire,value');
  const m = new Map();
  for (const r of rows) {
    const v = parseFloat(String(r.value).replace(',', '.'));
    if (!isFinite(v)) continue;
    const e = m.get(r.business_date) || { gz: 0, gk: 0 };
    e[r.alias_sire === 'GZ' ? 'gz' : 'gk'] += (v * 0.25) / 1000; // MW w kwadransie → GWh
    m.set(r.business_date, e);
  }
  return m;
}

// ---------- Stan widoku ----------
const RANGES = { 30: '30 dni', 90: '90 dni', 365: '12 miesięcy' };
let range = 90;
try { range = +localStorage.getItem('gasRange') || 90; } catch { /* brak localStorage */ }
if (!RANGES[range]) range = 90;

function slice() {
  const n = Math.min(range, data.days.length);
  const a = data.days.length - n;
  const cut = (arr) => (arr ? arr.slice(a) : new Array(n).fill(null));
  return { n, days: data.days.slice(a), f: (key, dir) => cut(data.flow.get(`${key}|${dir}`)), c: (key, dir) => cut(data.cap.get(`${key}|${dir}`)) };
}

function groups(s) {
  const g = Object.fromEntries([...SUPPLY, ...USE, { id: 'sk' }, { id: 'ua' }, UNK_IN, UNK_OUT].map((x) => [x.id, new Array(s.n).fill(null)]));
  for (const u of data.unknown || []) {
    s.f(u.key, u.dir).forEach((v, i) => { if (v != null) { const id = u.dir === 'entry' ? 'unkIn' : 'unkOut'; g[id][i] = (g[id][i] || 0) + v; } });
  }
  for (const [key, dir, id, sign] of RULES) {
    s.f(key, dir).forEach((v, i) => { if (v != null) g[id][i] = (g[id][i] || 0) + sign * v; });
  }
  for (const st of STORAGES) {
    s.f(st.key, 'entry').forEach((v, i) => { if (v != null) g.ugsOut[i] = (g.ugsOut[i] || 0) + v; });
    s.f(st.key, 'exit').forEach((v, i) => { if (v != null) g.ugsIn[i] = (g.ugsIn[i] || 0) + v; });
  }
  return g;
}

// Roczny bilans (nrg_bal_c, GWh, wartość opałowa): na co zużyto gaz. Wiersze + różnice statystyczne sumują się dokładnie
// do zużycia krajowego brutto (GIC) we wszystkich latach 1990–2024 (sprawdzone). Wartość wiersza: funkcja v(kod).
const USE_GROUPS = [
  { head: 'Produkcja prądu i ciepła', rows: [
    ['Elektrociepłownie zawodowe', (v) => v('TI_EHG_MAPCHP_E')],
    ['Elektrociepłownie przemysłowe', (v) => v('TI_EHG_APCHP_E')],
    ['Elektrownie zawodowe (tylko prąd)', (v) => v('TI_EHG_MAPE_E') + v('TI_EHG_APE_E')],
    ['Ciepłownie zawodowe', (v) => v('TI_EHG_MAPH_E')],
    ['Ciepłownie przemysłowe', (v) => v('TI_EHG_APH_E')],
  ] },
  { head: 'Odbiorcy końcowi', rows: [
    ['Gospodarstwa domowe', (v) => v('FC_OTH_HH_E')],
    ['Przemysł — paliwo', (v) => v('FC_IND_E'), true],
    ['Handel, usługi i budynki publiczne', (v) => v('FC_OTH_CP_E')],
    ['Przemysł — surowiec (głównie nawozy i chemia)', (v) => v('FC_NE')],
    ['Transport (CNG/LNG w pojazdach, tłocznie gazociągów)', (v) => v('FC_TRA_E')],
    ['Rolnictwo, leśnictwo, rybołówstwo i inne', (v) => v('FC_OTH_AF_E') + v('FC_OTH_FISH_E') + v('FC_OTH_NSP_E')],
  ] },
  { head: 'Sektor energii i inne', rows: [
    ['Zużycie własne sektora energii (rafinerie, wydobycie, terminal LNG)', (v) => v('NRG_E')],
    ['Inne przetwarzanie (gazownie, wodór, nieokreślone)', (v) => v('TI_E') - v('TI_EHG_E')],
    ['Straty w sieciach', (v) => v('DL')],
  ] },
];
// Długi szereg: 6 warstw (paleta sprawdzona walidatorem w tej kolejności).
const USE_LONG = [
  { name: 'Gospodarstwa domowe', color: 'var(--s6)', f: (v) => v('FC_OTH_HH_E') },
  { name: 'Handel i usługi', color: 'var(--s1)', f: (v) => v('FC_OTH_CP_E') },
  { name: 'Przemysł — paliwo', color: 'var(--s4)', f: (v) => v('FC_IND_E') },
  { name: 'Przemysł — surowiec', color: 'var(--s5)', f: (v) => v('FC_NE') },
  { name: 'Sektor energii, transport i inne', color: 'var(--s7)', f: (v) => v('NRG_E') + v('TI_E') - v('TI_EHG_E') + v('DL') + v('FC_TRA_E') + v('FC_OTH_AF_E') + v('FC_OTH_FISH_E') + v('FC_OTH_NSP_E') },
  { name: 'Elektrownie, elektrociepłownie i ciepłownie', color: 'var(--s2)', f: (v) => v('TI_EHG_E') },
];
const INDUSTRY = [['FC_IND_NMM_E', 'mineralny (szkło, ceramika, cement)'], ['FC_IND_FBT_E', 'spożywczy'], ['FC_IND_IS_E', 'hutnictwo żelaza i stali'], ['FC_IND_CPC_E', 'chemiczny (paliwo)'], ['FC_IND_PPP_E', 'papierniczy'], ['FC_IND_MAC_E', 'maszynowy'], ['FC_IND_NFM_E', 'metale nieżelazne'], ['FC_IND_TE_E', 'środki transportu'], ['FC_IND_NSP_E', 'inne']];
const UNIT_NOTE = 'Uwaga na jednostki: dane miesięczne Eurostat podaje w cieple spalania (jak pozostałe sekcje strony), a roczny bilans — w wartości opałowej, o ok. 10% niższej; dlatego suma miesięcy danego roku jest wyższa niż bilans roczny.';
const twhF = (v) => (v == null ? '—' : `${fmt2.format(v)} TWh`);

// ---------- Miesięcznie: zużycie krajowe i energetyka zawodowa (nrg_cb_gasm) ----------
async function renderUsesMonthly() {
  const box = $('#g-uses-m-body');
  try {
    const mon = await eurostat('nrg_cb_gasm', { geo: 'PL', siec: 'G3000', unit: 'TJ_GCV', nrg_bal: ['IC_OBS', 'TI_EHG_MAP'], sinceTimePeriod: '2013-01' });
    const months = mon.times.filter((t) => mon.get({ nrg_bal: 'IC_OBS', time: t }) != null && mon.get({ nrg_bal: 'TI_EHG_MAP', time: t }) != null);
    const n = months.length;
    const ic = months.map((t) => mon.get({ nrg_bal: 'IC_OBS', time: t }) / 3600); // TJ → TWh
    const pw = months.map((t) => mon.get({ nrg_bal: 'TI_EHG_MAP', time: t }) / 3600);
    const rest = ic.map((v, i) => v - pw[i]);
    const days = (t) => new Date(Date.UTC(+t.slice(0, 4), +t.slice(5, 7), 0)).getUTCDate();
    const mLabel = (t) => `${MONTHS[+t.slice(5, 7) - 1]} ${t.slice(0, 4)}`;
    const last = n - 1;
    const seg = rangeSeg('g-uses-m', n, 'g-uses-m');
    box.innerHTML = tilesHtml([
      { l: `Zużycie krajowe — ${mLabel(months[last])}`, v: twhF(ic[last]), d: `${fmt0.format((ic[last] * 1000) / days(months[last]))} GWh na dobę` },
      { l: 'W tym energetyka zawodowa', v: twhF(pw[last]), d: `${fmt0.format((pw[last] / ic[last]) * 100)}% zużycia w miesiącu` },
      { l: 'Energetyka zawodowa, ostatnie 12 mies.', v: twhF(sum(pw.slice(-12))), d: `${fmt0.format((sum(pw.slice(-12)) / sum(ic.slice(-12))) * 100)}% z ${twhF(sum(ic.slice(-12)))}` },
    ]) + seg.html +
      '<div class="chart" id="g-uses-m-chart"></div>' +
      table(['Miesiąc', 'Zużycie krajowe [TWh]', 'Energetyka zawodowa [TWh]', 'Pozostałe [TWh]', 'Udział energetyki'], months.map((t, i) => [mLabel(t), fmt2.format(ic[i]), fmt2.format(pw[i]), fmt2.format(rest[i]), `${fmt0.format((pw[i] / ic[i]) * 100)}%`]).reverse()) +
      `<p class="note">Eurostat <a href="https://ec.europa.eu/eurostat/databrowser/view/nrg_cb_gasm/default/table" rel="noopener">nrg_cb_gasm</a> (licencja CC BY 4.0), dane od ${mLabel(months[0])}, opóźnienie ok. 1 miesiąca. Miesięcznie rozróżniana jest tylko energetyka zawodowa (elektrownie, elektrociepłownie i ciepłownie, których podstawową działalnością jest produkcja energii) — elektrociepłownie przemysłowe są w „pozostałych”. Pełny podział na odbiorców jest w zakładce „Roczne”. ${UNIT_NOTE} Dane zaktualizowane ${esc(new Date(mon.updated).toLocaleDateString('pl-PL'))}.</p>`;
    seg.bind(box);
    const ticks = months.map((t, i) => ({ i, label: t.slice(5, 7) === '01' ? t.slice(0, 4) : MONTHS[+t.slice(5, 7) - 1], at: 'center' }));
    const PW = 'Energetyka zawodowa (prąd i ciepło)';
    drawChart('g-uses-m', $('#g-uses-m-chart'), {
      n, stacked: true,
      series: [{ name: PW, color: 'var(--g-gaz)', values: pw }, { name: 'Pozostałe zużycie', color: 'var(--ink-2)', values: rest }],
      xTicks: ticks, height: 280, minSpan: 6, yFmt: (v) => `${fmt0.format(v)} TWh`, label: 'Miesięczne zużycie gazu: energetyka zawodowa i pozostałe, TWh',
      tooltip: (i, on) => tipRows(mLabel(months[i]), [
        ...(on('Pozostałe zużycie') ? [{ name: 'Pozostałe zużycie', color: 'var(--ink-2)', value: twhF(rest[i]) }] : []),
        ...(on(PW) ? [{ name: 'Energetyka zawodowa', color: 'var(--g-gaz)', value: `${twhF(pw[i])} · ${fmt0.format((pw[i] / ic[i]) * 100)}%` }] : []),
        { name: 'Razem', value: `${twhF(ic[i])} · ${fmt0.format((ic[i] * 1000) / days(months[i]))} GWh/d` },
      ]),
    }, 'g-uses-m');
  } catch (e) {
    box.innerHTML = errorBox(e);
  }
}

// ---------- Rocznie: pełny bilans z wyborem roku (nrg_bal_c) i gaz w domach (nrg_d_hhq) ----------
const HH_USES = [['FC_OTH_HH_E_SH', 'Ogrzewanie pomieszczeń', 'var(--s2)'], ['FC_OTH_HH_E_WH', 'Ciepła woda', 'var(--s1)'], ['FC_OTH_HH_E_CK', 'Gotowanie', 'var(--s3)'], ['FC_OTH_HH_E_OE', 'Inne', 'var(--ink-2)']];
function householdsHtml(hh, Y) {
  const has = hh.get({ nrg_bal: 'FC_OTH_HH_E', time: Y }) != null;
  const years = hh.times.filter((t) => hh.get({ nrg_bal: 'FC_OTH_HH_E', time: t }) != null);
  if (!has) return `<h4 class="grp-h">Gospodarstwa domowe według zastosowania — ${Y}</h4><p class="muted">Brak danych dla tego roku (Eurostat publikuje je od ${years[0]}).</p>`;
  const v = (c) => (hh.get({ nrg_bal: c, time: Y }) ?? 0) / 3600; // TJ (wartość opałowa) → TWh
  const tot = v('FC_OTH_HH_E');
  const rows = HH_USES.filter(([c]) => v(c) > 0.05);
  return `<h4 class="grp-h">Gospodarstwa domowe według zastosowania — ${Y} <span class="muted">· ${twhF(tot)}</span></h4>
    <div class="stackbar" role="img" aria-label="Zużycie gazu w gospodarstwach domowych według zastosowania">${rows.map(([c, n, col]) => `<span style="flex:${v(c)};background:${col}" title="${n}: ${twhF(v(c))}"></span>`).join('')}</div>
    <div class="legend">${rows.map(([c, n, col]) => `<span class="key"><i class="sw" style="background:${col}"></i>${n}: <b>${twhF(v(c))}</b> (${fmt0.format((v(c) / tot) * 100)}%)</span>`).join('')}</div>`;
}

let gasYear = null;
async function renderUsesYear() {
  const box = $('#g-uses-y-body');
  try {
    const [yr, hh] = await Promise.all([
      eurostat('nrg_bal_c', { geo: 'PL', siec: 'G3000', unit: 'GWH', sinceTimePeriod: '1990' }),
      eurostat('nrg_d_hhq', { geo: 'PL', siec: 'G3000', unit: 'TJ', sinceTimePeriod: '2000' }),
    ]);
    const years = yr.times.filter((t) => yr.get({ nrg_bal: 'GIC', time: t }) != null);
    const n = years.length;
    const vf = (t) => (c) => (yr.get({ nrg_bal: c, time: t }) ?? 0) / 1000;
    const long = years.map((t) => USE_LONG.map((x) => x.f(vf(t))));
    const gepS = years.map((t) => vf(t)('GEP'));
    const ghpS = years.map((t) => vf(t)('GHP'));
    const draw = () => {
      const Y = gasYear && years.includes(gasYear) ? gasYear : years[n - 1];
      const v = vf(Y);
      const gic = v('GIC');
      const colors = ['var(--g-gaz)', 'var(--s1)', 'var(--ink-2)'];
      const all = USE_GROUPS.flatMap((g) => g.rows.map((r) => r[1](v)));
      const maxRow = Math.max(...all);
      const rowHtml = ([name, f, ind], color) => {
        const x = f(v);
        const sub = ind ? `<details class="sub-list"><summary>branże</summary>${INDUSTRY.map(([k, nm]) => `${nm}: ${twhF(v(k))}`).join(' · ')}</details>` : '';
        return `<div class="urow"><div class="uname"><i class="sw" style="background:${color}"></i>${name}${sub}</div>
          <div class="utrack"><span class="ubar" style="width:${maxRow > 0 ? (Math.max(0, x) / maxRow) * 100 : 0}%;background:${color}"></span></div>
          <div class="uval"><b>${twhF(x)}</b> <span class="muted">${fmt0.format((x / gic) * 100)}% zużycia</span></div></div>`;
      };
      const t3 = years.slice(Math.max(0, years.indexOf(Y) - 2), years.indexOf(Y) + 1);
      box.innerHTML = yearSelect('g-year', years, Y) +
        tilesHtml([
          { l: `Zużycie krajowe brutto ${Y}`, v: twhF(gic), d: 'w wartości opałowej' },
          { l: 'Gaz spalony w elektrowniach, elektrociepłowniach i ciepłowniach', v: twhF(v('TI_EHG_E')), d: `${fmt0.format((v('TI_EHG_E') / gic) * 100)}% zużycia` },
          { l: 'Wyprodukowano z niego', v: `${twhF(v('GEP'))} prądu`, d: `i ${twhF(v('GHP'))} ciepła (brutto)` },
        ]) +
        USE_GROUPS.map((g, k) => `<h4 class="grp-h">${g.head} <span class="muted">· ${twhF(g.rows.reduce((a, r) => a + r[1](v), 0))}</span></h4><div class="util">${g.rows.slice().sort((p, q) => q[1](v) - p[1](v)).map((r) => rowHtml(r, colors[k])).join('')}</div>`).join('') +
        householdsHtml(hh, Y) +
        `<h3 class="sub-h">Zużycie gazu według odbiorców, ${years[0]}–${years[n - 1]}</h3><div class="chart" id="g-uses-y-chart"></div>` +
        `<h3 class="sub-h">Prąd i ciepło wyprodukowane z gazu, ${years[0]}–${years[n - 1]}</h3><div class="chart" id="g-uses-y-out"></div>` +
        table(['Pozycja bilansu [TWh]', ...t3], [
          ['Zużycie krajowe brutto', ...t3.map((t) => fmt2.format(vf(t)('GIC')))],
          ...USE_GROUPS.flatMap((g) => g.rows.map(([name, f]) => [name, ...t3.map((t) => fmt2.format(f(vf(t))))])),
          ...INDUSTRY.map(([c, nm]) => [` przemysł: ${nm}`, ...t3.map((t) => fmt2.format(vf(t)(c)))]),
          ['Różnice statystyczne', ...t3.map((t) => fmt2.format(vf(t)('STATDIFF')))],
          ['Prąd wyprodukowany z gazu (brutto)', ...t3.map((t) => fmt2.format(vf(t)('GEP')))],
          ['Ciepło wyprodukowane z gazu (brutto)', ...t3.map((t) => fmt2.format(vf(t)('GHP')))],
        ]) +
        `<p class="note">Oficjalny bilans roczny (Eurostat <a href="https://ec.europa.eu/eurostat/databrowser/view/nrg_bal_c/default/table" rel="noopener">nrg_bal_c</a>, <a href="https://ec.europa.eu/eurostat/databrowser/view/nrg_d_hhq/default/table" rel="noopener">nrg_d_hhq</a>; licencja CC BY 4.0), publikowany z opóźnieniem ponad roku. Pozycje wraz z różnicami statystycznymi (${Y}: ${twhF(v('STATDIFF'))}) sumują się do zużycia krajowego brutto. Gazu spalonego w elektrociepłowni nie da się rozdzielić na „część na prąd” i „część na ciepło” — to jeden proces; bilans podaje, ile prądu i ciepła z niego powstało. ${UNIT_NOTE}</p>`;
      $('#g-year').addEventListener('change', (e) => { gasYear = e.target.value; draw(); });
      const ticks = years.map((t, k) => ({ i: k, label: t, at: 'center' })).filter((x) => +x.label % 5 === 0);
      const tag = (k) => years[k] + (years[k] === Y ? ' (wybrany rok)' : '');
      drawChart('g-uses-y', $('#g-uses-y-chart'), {
        n, stacked: true, series: USE_LONG.map((x, j) => ({ name: x.name, color: x.color, values: long.map((r) => r[j]) })), xTicks: ticks, height: 300, minSpan: 5,
        yFmt: (x) => `${fmt0.format(x)} TWh`, label: 'Roczne zużycie gazu w Polsce według odbiorców, TWh',
        tooltip: (k, on) => tipRows(tag(k), [...USE_LONG.map((x, j) => [x, j]).reverse().filter(([x]) => on(x.name)).map(([x, j]) => ({ name: x.name, color: x.color, value: twhF(long[k][j]) })), { name: 'Razem (bez różnic stat.)', value: twhF(sum(long[k])) }]),
      }, 'g-uses-y');
      drawChart('g-uses-y-out', $('#g-uses-y-out'), {
        n, markers: true, series: [{ name: 'Prąd z gazu', color: 'var(--s1)', values: gepS }, { name: 'Ciepło z gazu', color: 'var(--s2)', values: ghpS }], xTicks: ticks, height: 220, minSpan: 5,
        yFmt: (x) => `${fmt0.format(x)} TWh`, label: 'Prąd i ciepło wyprodukowane z gazu w Polsce, TWh rocznie',
        tooltip: (k, on) => tipRows(tag(k), [['Prąd z gazu', 'var(--s1)', gepS[k]], ['Ciepło z gazu', 'var(--s2)', ghpS[k]]].filter(([nm]) => on(nm)).map(([nm, c, x]) => ({ name: nm, color: c, value: twhF(x) }))),
      }, 'g-uses-y');
    };
    draw();
  } catch (e) {
    box.innerHTML = errorBox(e);
  }
}

// ---------- Uzależnienie od importu ----------
// Miesięcznie z pomiarów ENTSOG (import netto vs wydobycie krajowe), rocznie oficjalny wskaźnik Eurostatu (nrg_ind_id).
const DEP_FUELS = [['TOTAL', 'Cała energia', 'var(--s1)'], ['G3000', 'Gaz ziemny', 'var(--g-gaz)'], ['O4000XBIO', 'Ropa i paliwa', 'var(--s7)'], ['C0000X0350-0370', 'Węgiel i inne paliwa stałe', 'var(--g-wk)']];
const pcF = (v) => (v == null ? '—' : `${fmt0.format(v)}%`);

async function renderDepMonthly() {
  const box = $('#g-dep-m-body');
  try {
    await dataReady; // dane ENTSOG ładuje zakładka dzienna; czekamy, jeśli ktoś otworzył od razu tę zakładkę
    if (!data?.days.length) return void (box.innerHTML = empty('Brak danych ENTSOG.'));
    const all = { n: data.days.length, days: data.days, f: (key, dir) => data.flow.get(`${key}|${dir}`) || new Array(data.days.length).fill(null) };
    const g = groups(all);
    const IMP = ['bp', 'lng', 'de', 'cz', 'lt', 'skua'];
    const byM = new Map();
    all.days.forEach((d, i) => {
      const m = d.slice(0, 7);
      const e = byM.get(m) || { imp: 0, exp: 0, prod: 0, n: 0 };
      e.imp += sum(IMP.map((id) => g[id][i]));
      e.exp += g.exp[i] ?? 0;
      e.prod += g.prod[i] ?? 0;
      e.n++;
      byM.set(m, e);
    });
    const months = [...byM.keys()].sort();
    const full = (m) => byM.get(m).n === new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).getUTCDate();
    const share = months.map((m) => { const e = byM.get(m); const net = e.imp - e.exp; return (net / (net + e.prod)) * 100; });
    const mLabel = (m) => `${MONTHS[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}${full(m) ? '' : ' (niepełny)'}`;
    const fullM = months.filter(full);
    const li = months.indexOf(fullM[fullM.length - 1]);
    const e = byM.get(months[li]);
    box.innerHTML = tilesHtml([
      { l: `Import netto w dostawach — ${mLabel(months[li])}`, v: pcF(share[li]), d: `wydobycie krajowe ${fmt2.format(e.prod / 1000)} TWh, import netto ${fmt2.format((e.imp - e.exp) / 1000)} TWh` },
      { l: 'Średnio w pełnych miesiącach', v: pcF(sum(fullM.map((m) => share[months.indexOf(m)])) / fullM.length), d: `${fullM.length} ${plural(fullM.length, ['miesiąc', 'miesiące', 'miesięcy'])}` },
    ]) +
      '<div class="chart" id="g-dep-m-chart"></div>' +
      table(['Miesiąc', 'Import [TWh]', 'Eksport [TWh]', 'Wydobycie krajowe [TWh]', 'Udział importu netto'], months.map((m, i) => { const x = byM.get(m); return [mLabel(m), fmt2.format(x.imp / 1000), fmt2.format(x.exp / 1000), fmt2.format(x.prod / 1000), pcF(share[i])]; }).reverse()) +
      '<p class="note">Z pomiarów GAZ-SYSTEM w ENTSOG (ostatnie ok. 12 miesięcy): import netto ÷ (import netto + wydobycie krajowe), bez zmian zapasu w magazynach, w cieple spalania. Eurostat nie publikuje miesięcznego wydobycia gazu w Polsce od września 2023, dlatego nie da się policzyć oficjalnego wskaźnika miesięcznie — oficjalny, roczny jest w zakładce „Roczne”.</p>';
    drawChart('g-dep-m', $('#g-dep-m-chart'), {
      n: months.length, bars: true, series: [{ name: 'Import netto w dostawach', color: 'var(--g-gaz)', values: share }], barColor: () => 'var(--g-gaz)',
      xTicks: months.map((m, i) => ({ i, label: MONTHS[+m.slice(5, 7) - 1], at: 'center' })), height: 200, minSpan: 3, yFmt: (v) => `${fmt0.format(v)}%`,
      label: 'Udział importu netto w dostawach gazu, miesięcznie',
      tooltip: (i) => { const x = byM.get(months[i]); return tipRows(mLabel(months[i]), [{ name: 'Udział importu netto', color: 'var(--g-gaz)', value: pcF(share[i]) }, { name: 'Import', value: `${fmt2.format(x.imp / 1000)} TWh` }, { name: 'Eksport', value: `${fmt2.format(x.exp / 1000)} TWh` }, { name: 'Wydobycie krajowe', value: `${fmt2.format(x.prod / 1000)} TWh` }]); },
    }, 'dep-m');
  } catch (e) {
    box.innerHTML = errorBox(e);
  }
}

let depYear = null;
async function renderDepYear() {
  const box = $('#g-dep-y-body');
  try {
    const [pl, eu] = await Promise.all([
      eurostat('nrg_ind_id', { geo: ['PL', 'EU27_2020'], sinceTimePeriod: '1990' }),
      eurostat('nrg_ind_id', { siec: 'G3000', sinceTimePeriod: '1990' }),
    ]);
    const years = pl.times.filter((t) => pl.get({ geo: 'PL', siec: 'TOTAL', time: t }) != null);
    const n = years.length;
    const val = (geo, siec, t) => pl.get({ geo, siec, time: t });
    const draw = () => {
      const Y = depYear && years.includes(depYear) ? depYear : years[n - 1];
      const countries = Object.keys(EU_NAMES).map((c) => ({ c, v: eu.get({ geo: c, time: Y }) })).filter((x) => x.v != null).sort((a, b) => b.v - a.v);
      const maxV = Math.max(100, ...countries.map((x) => x.v));
      box.innerHTML = yearSelect('dep-year', years, Y) +
        tilesHtml(DEP_FUELS.map(([c, name]) => ({ l: `${name} — ${Y}`, v: pcF(val('PL', c, Y)), d: `UE-27: ${pcF(val('EU27_2020', c, Y))}` }))) +
        `<h3 class="sub-h">Polska według paliw, ${years[0]}–${years[n - 1]}</h3><div class="chart" id="g-dep-y-chart"></div>` +
        `<h3 class="sub-h">Uzależnienie od importu gazu w krajach UE — ${Y}</h3><div class="util">${countries
          .map((x) => `<div class="urow${x.c === 'PL' ? ' hl' : ''}"><div class="uname"><i class="sw" style="background:${x.c === 'PL' ? 'var(--g-gaz)' : x.c === 'EU27_2020' ? 'var(--ink)' : 'var(--ink-2)'}"></i>${EU_NAMES[x.c]}</div>
            <div class="utrack"><span class="ubar" style="width:${Math.max(0, (x.v / maxV) * 100)}%;background:${x.c === 'PL' ? 'var(--g-gaz)' : x.c === 'EU27_2020' ? 'var(--ink)' : 'var(--ink-2)'}"></span></div>
            <div class="uval"><b>${pcF(x.v)}</b></div></div>`).join('')}</div>` +
        table(['Rok', ...DEP_FUELS.map(([, nm]) => `${nm} — PL`), 'Cała energia — UE-27', 'Gaz — UE-27'], years.map((t) => [t, ...DEP_FUELS.map(([c]) => pcF(val('PL', c, t))), pcF(val('EU27_2020', 'TOTAL', t)), pcF(val('EU27_2020', 'G3000', t))]).reverse()) +
        '<p class="note">Uzależnienie od importu = import netto ÷ zużycie krajowe brutto (Eurostat <a href="https://ec.europa.eu/eurostat/databrowser/view/nrg_ind_id/default/table" rel="noopener">nrg_ind_id</a>, rocznie). Wartość ujemna oznacza eksportera netto, powyżej 100% — import większy od zużycia (np. na zapas). Kraje bez danych pominięto.</p>';
      $('#dep-year').addEventListener('change', (e) => { depYear = e.target.value; draw(); });
      drawChart('g-dep-y', $('#g-dep-y-chart'), {
        n, markers: n < 40, series: DEP_FUELS.map(([c, nm, col]) => ({ name: nm, color: col, values: years.map((t) => val('PL', c, t)) })),
        xTicks: years.map((t, i) => ({ i, label: t, at: 'center' })).filter((x) => +x.label % 5 === 0), height: 260, minSpan: 5, yFmt: (v) => `${fmt0.format(v)}%`,
        label: 'Uzależnienie Polski od importu energii według paliw, rocznie',
        tooltip: (i, on) => tipRows(years[i] + (years[i] === Y ? ' (wybrany rok)' : ''), [...DEP_FUELS.filter(([, nm]) => on(nm)).map(([c, nm, col]) => ({ name: nm, color: col, value: pcF(val('PL', c, years[i])) })), { name: 'UE-27, cała energia', value: pcF(val('EU27_2020', 'TOTAL', years[i])) }]),
      }, 'dep-y');
    };
    draw();
  } catch (e) {
    box.innerHTML = errorBox(e);
  }
}

// ---------- Renderowanie ----------
const SECTIONS = ['g-day', 'g-price', 'g-supply', 'g-use', 'g-borders', 'g-store', 'g-points', 'g-power'];

function renderAll() {
  clearGroups('gas', 'gas-price');
  document.querySelectorAll('#range .seg button').forEach((b) => b.classList.toggle('on', +b.dataset.r === range));
  if (!data.days.length) {
    for (const id of SECTIONS) $(`#${id}-body`).innerHTML = empty('Brak danych ENTSOG.');
    return;
  }
  const s = slice();
  const g = groups(s);
  $('#range-label').textContent = `Doby gazowe ${fDay.format(dt(s.days[0]))} – ${fDay.format(dt(s.days[s.n - 1]))} (${s.n} ${plural(s.n, ['doba', 'doby', 'dób'])})`;
  renderDay(s, g);
  renderPrice(s);
  renderSupply(s, g);
  renderUse(s, g);
  renderBorders(s);
  renderStore(s);
  renderPoints(s);
  renderPower(s);
}

function lastIndex(s, g) {
  for (let i = s.n - 1; i >= 0; i--) if (SUPPLY.some((x) => g[x.id][i] != null)) return i;
  return s.n - 1;
}

function renderDay(s, g) {
  const box = $('#g-day-body');
  const i = lastIndex(s, g);
  const supply = sum(SUPPLY.map((x) => g[x.id][i]));
  const domestic = (g.dist[i] ?? 0) + (g.fc[i] ?? 0);
  const net = (g.ugsIn[i] ?? 0) - (g.ugsOut[i] ?? 0);
  const rows = SUPPLY.flatMap((x) => (x.parts ? x.parts.map(([id, name]) => ({ name, color: x.color, v: g[id][i] ?? 0 })) : [{ ...x, v: g[x.id][i] ?? 0 }])).filter((x) => x.v >= 0.5).sort((a, b) => b.v - a.v);
  const warn = data.unknown.length
    ? `<p class="warn-box">⚠ W danych ENTSOG są punkty spoza listy obsługiwanych przez stronę — ujęto je jako „Nieprzypisane”: ${data.unknown.map((u) => `${esc(u.label)} (${esc(u.key)}, ${u.dir === 'entry' ? 'wejście' : 'wyjście'}${u.type ? `, ${esc(u.type)}` : ''}, śr. ${gwh(u.avg)}/d)`).join('; ')}.</p>`
    : '';
  box.innerHTML = warn + tilesHtml([
    { l: 'Dostawy do systemu', v: gwh(supply), d: 'wydobycie + import + odbiór z magazynów' },
    { l: 'Zużycie krajowe', v: gwh(domestic), d: `dystrybucja ${gwh(g.dist[i])} · odbiorcy przesyłowi ${gwh(g.fc[i])}` },
    { l: 'Magazyny', v: net >= 0 ? `+${gwh(net)}` : `−${gwh(-net)}`, d: net >= 0 ? 'zatłoczono więcej, niż odebrano' : 'odebrano więcej, niż zatłoczono' },
    { l: 'Eksport', v: gwh(g.exp[i]), d: 'Ukraina, Litwa, Słowacja, Czechy, Niemcy, Dania' },
  ]) +
    `<h3 class="sub-h">Skąd pochodził gaz — ${esc(gasDay(s.days[i]))}</h3><div class="util">${rows
      .map((x) => `<div class="urow"><div class="uname"><i class="sw" style="background:${x.color}"></i>${x.name}</div>
        <div class="utrack"><span class="ubar" style="width:${supply ? (x.v / supply) * 100 : 0}%;background:${x.color}"></span></div>
        <div class="uval"><b>${pct(supply ? (x.v / supply) * 100 : null)}</b> <span class="muted">${gwh(x.v)}</span></div></div>`)
      .join('')}</div>` +
    '<p class="note">Doba gazowa trwa od 6:00 do 6:00. GAZ-SYSTEM publikuje dane za dobę następnego dnia rano. 1 GWh ≈ 90 tys. m³ gazu wysokometanowego.</p>';
}

// ---------- Ceny gazu TGEgasDA (plik data/gas-prices.json, pobierany przez GitHub Actions) ----------
let prices; // Promise<{meta, byDay: Map}>
function loadPrices() {
  prices ??= fetch('data/gas-prices.json', { cache: 'no-cache' }).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }).then((doc) => ({ doc, byDay: new Map(doc.data.map((x) => [x.day, x])) }));
  return prices;
}

async function renderPrice(s) {
  const box = $('#g-price-body');
  try {
    const { doc, byDay } = await loadPrices();
    // Indeks z danej daty dotyczy dostawy w tej dobie gazowej; oś jak na pozostałych wykresach, ale do ostatniego dnia z ceną.
    let days = s.days.slice();
    for (let d = addDays(days[days.length - 1], 1); byDay.has(d); d = addDays(d, 1)) days.push(d);
    days = days.slice(days.length - s.n);
    const n = days.length;
    const price = days.map((d) => byDay.get(d)?.price ?? null);
    const vol = days.map((d) => (byDay.has(d) ? byDay.get(d).volume / 1000 : null)); // GWh
    const idx = price.map((v, i) => (v == null ? -1 : i)).filter((i) => i >= 0);
    if (!idx.length) return void (box.innerHTML = empty('Brak cen dla wybranego okresu.'));
    const last = idx[idx.length - 1];
    const mn = idx.reduce((a, i) => (price[i] < price[a] ? i : a), idx[0]);
    const mx = idx.reduce((a, i) => (price[i] > price[a] ? i : a), idx[0]);
    const back = byDay.get(addDays(days[last], -30));
    const ch = back ? ((price[last] - back.price) / back.price) * 100 : null;
    const zl = (v) => (v == null ? '—' : `${fmt2.format(v)} zł/MWh`);
    const avgP = sum(idx.map((i) => price[i] * byDay.get(days[i]).volume)) / sum(idx.map((i) => byDay.get(days[i]).volume));
    box.innerHTML = tilesHtml([
      { l: `TGEgasDA — dostawa ${fDay.format(dt(days[last]))}`, v: zl(price[last]), d: `${fmt2.format(price[last] / 1000)} zł/kWh · wolumen ${gwh(vol[last])}` },
      ch == null ? null : { l: 'Zmiana w 30 dni', v: `${ch >= 0 ? '+' : '−'}${fmt0.format(Math.abs(ch))}%`, d: `od ${zl(back.price)}` },
      { l: 'Średnia ważona wolumenem', v: zl(avgP), d: 'w wybranym okresie' },
      { l: 'Zakres w okresie', v: `${fmt0.format(price[mn])}–${fmt0.format(price[mx])} zł/MWh`, d: `min ${fDM.format(dt(days[mn]))}, maks ${fDM.format(dt(days[mx]))}` },
    ]) +
      '<div class="chart" id="g-price-chart"></div><h3 class="sub-h">Wolumen obrotu</h3><div class="chart" id="g-vol-chart"></div>' +
      table(['Doba dostawy', 'Cena [zł/MWh]', 'Wolumen [MWh]'], idx.map((i) => [days[i], fmt2.format(price[i]), fmt0.format(byDay.get(days[i]).volume)]).reverse()) +
      `<p class="note">TGEgasDA — średnia ważona wolumenem cena gazu wysokometanowego z dostawą w danej dobie gazowej, z Rynku Dnia Następnego gazu (RDNg). Cena nie obejmuje przesyłu, dystrybucji, akcyzy ani VAT. Dane: <a href="https://tge.pl/gaz-rdn" rel="noopener">Towarowa Giełda Energii</a>, opracowanie: <a href="https://energy.instrat.pl/en/prices/gas-dam/" rel="noopener">Instrat (energy.instrat.pl)</a>, licencja <a href="https://creativecommons.org/licenses/by-nc/4.0/deed.pl" rel="noopener">CC BY-NC 4.0</a>. Pobrano: ${esc(new Date(doc.fetched).toLocaleString('pl-PL'))}.</p>`;
    const tick = dayTicks(days);
    drawChart('g-price', $('#g-price-chart'), {
      n, series: [{ name: 'TGEgasDA', color: 'var(--g-gaz)', values: price }], area: true, zero: false, xTicks: tick, height: 240, minSpan: 7,
      label: 'Cena gazu TGEgasDA, zł/MWh',
      tooltip: (i) => tipRows(`dostawa ${fDay.format(dt(days[i]))}`, [{ name: 'TGEgasDA', color: 'var(--g-gaz)', value: zl(price[i]) }, { name: 'Wolumen', value: gwh(vol[i]) }]),
    }, 'gas-price');
    drawChart('g-vol', $('#g-vol-chart'), {
      n, bars: true, series: [{ name: 'Wolumen', color: 'var(--ink-2)', values: vol }], xTicks: tick, height: 140, minSpan: 7,
      label: 'Wolumen obrotu na RDNg, GWh', tooltip: (i) => tipRows(`dostawa ${fDay.format(dt(days[i]))}`, [{ name: 'Wolumen', color: 'var(--ink-2)', value: gwh(vol[i]) }, { name: 'Cena', value: zl(price[i]) }]),
    }, 'gas-price');
  } catch (e) {
    box.innerHTML = empty(`Ceny gazu są niedostępne (${esc(e.message || e)}). Plik data/gas-prices.json tworzy skrypt scripts/fetch_data.py.`);
  }
}

function tipFor(s, list, g, i, on, total) {
  const rows = list.filter((x) => on(x.name)).slice().reverse().flatMap((x) => [
    { name: x.name, color: x.color, value: gwh(g[x.id][i]) },
    ...(x.parts || []).map(([id, name]) => ({ name: `– ${name}`, value: gwh(g[id][i]) })),
  ]);
  if (total) rows.push({ name: total, value: gwh(sum(list.map((x) => g[x.id][i]))) });
  return tipRows(gasDay(s.days[i]), rows);
}

function renderSupply(s, g) {
  const box = $('#g-supply-body');
  const total = s.days.map((_, i) => sum(SUPPLY.map((x) => g[x.id][i])));
  const share = (id) => { const t = sum(total); return t ? (sum(g[id]) / t) * 100 : null; };
  const tiles = SUPPLY.filter((x) => x.id !== 'ugsOut').flatMap((x) => (x.parts ? x.parts.map(([id, name]) => ({ id, name })) : [x]));
  box.innerHTML = tilesHtml(tiles.map((x) => ({ l: x.name, v: pct(share(x.id)), d: `${fmt2.format(sum(g[x.id]) / 1000)} TWh · śr. ${gwh(avgOf(g[x.id]))}/d` }))) +
    '<div class="chart" id="g-supply-chart"></div>' +
    table(['Doba gazowa', ...tiles.map((x) => x.name + ' [GWh]'), 'Odbiór z magazynów [GWh]', 'Razem'], s.days.map((d, i) => [d, ...[...tiles, { id: 'ugsOut' }].map((x) => (g[x.id][i] == null ? '—' : fmt0.format(g[x.id][i]))), fmt0.format(total[i])]).reverse()) +
    '<p class="note">Udziały w całym wybranym okresie. Wydobycie krajowe obejmuje gaz przetworzony w odazotowniach. Import z Ukrainy jest niewielki, dlatego na wykresie tworzy jedną warstwę ze Słowacją; w dymku, kafelkach i tabeli jest osobno. Kierunki z eksportem — w sekcji „Wymiana z sąsiadami”.</p>';
  drawChart('g-supply', $('#g-supply-chart'), {
    n: s.n, stacked: true, series: SUPPLY.map((x) => ({ name: x.name, color: x.color, values: g[x.id] })), xTicks: dayTicks(s.days), height: 300, minSpan: 7,
    yFmt: (v) => `${fmt0.format(v)}`, label: 'Dostawy gazu do systemu przesyłowego według źródeł, GWh na dobę',
    tooltip: (i, on) => tipFor(s, SUPPLY, g, i, on, 'Razem'),
  }, 'gas');
}

function renderUse(s, g) {
  const box = $('#g-use-body');
  const inSum = s.days.map((_, i) => sum(SUPPLY.map((x) => g[x.id][i])));
  const outSum = s.days.map((_, i) => sum(USE.map((x) => g[x.id][i])));
  const diff = inSum.map((v, i) => v - outSum[i]);
  const peak = outSum.reduce((a, v, i) => (v > outSum[a] ? i : a), 0);
  const cons = s.days.map((_, i) => (g.dist[i] ?? 0) + (g.fc[i] ?? 0));
  box.innerHTML = tilesHtml([
    { l: 'Średnie zużycie krajowe', v: `${gwh(avgOf(cons))}/d`, d: `łącznie ${fmt2.format(sum(cons) / 1000)} TWh w okresie` },
    { l: 'Największy odbiór', v: gwh(outSum[peak]), d: fDay.format(dt(s.days[peak])) },
    { l: 'Eksport w okresie', v: `${fmt2.format(sum(g.exp) / 1000)} TWh`, d: `śr. ${gwh(avgOf(g.exp))}/d` },
  ]) +
    '<div class="chart" id="g-use-chart"></div>' +
    '<h3 class="sub-h">Wejścia − wyjścia</h3><div class="chart" id="g-diff-chart"></div>' +
    table(['Doba gazowa', ...USE.map((x) => x.name + ' [GWh]'), 'Wejścia − wyjścia'], s.days.map((d, i) => [d, ...USE.map((x) => (g[x.id][i] == null ? '—' : fmt0.format(g[x.id][i]))), fmt0.format(diff[i])]).reverse()) +
    '<p class="note">„Odbiorcy przyłączeni do przesyłu” to duże zakłady i elektrownie zasilane bezpośrednio z gazociągów GAZ-SYSTEM; pozostali odbiorcy (gospodarstwa domowe, firmy, ciepłownie) są za sieciami dystrybucyjnymi. Różnica wejść i wyjść to głównie zmiana ilości gazu w samych gazociągach (akumulacja) i niedokładności pomiarów — zwykle kilka procent obrotu.</p>';
  drawChart('g-use', $('#g-use-chart'), {
    n: s.n, stacked: true, series: USE.map((x) => ({ name: x.name, color: x.color, values: g[x.id] })), xTicks: dayTicks(s.days), height: 300, minSpan: 7,
    label: 'Odbiór gazu z systemu przesyłowego, GWh na dobę', tooltip: (i, on) => tipFor(s, USE, g, i, on, 'Razem'),
  }, 'gas');
  drawChart('g-diff', $('#g-diff-chart'), {
    n: s.n, bars: true, barColor: () => 'var(--ink-2)', series: [{ name: 'Wejścia − wyjścia', color: 'var(--ink-2)', values: diff }], xTicks: dayTicks(s.days), height: 160, minSpan: 7,
    label: 'Różnica wejść i wyjść, GWh na dobę',
    tooltip: (i) => tipRows(gasDay(s.days[i]), [{ name: 'Wejścia', value: gwh(inSum[i]) }, { name: 'Wyjścia', value: gwh(outSum[i]) }, { name: 'Różnica', color: 'var(--ink-2)', value: gwh(diff[i]) }]),
  }, 'gas');
}

function renderBorders(s) {
  const box = $('#g-borders-body');
  const add = (pts) => s.days.map((_, i) => { let t = null; for (const [k, d] of pts) { const v = s.f(k, d)[i]; if (v != null) t = (t ?? 0) + v; } return t; });
  const bs = BORDERS.map((b) => {
    const imp = add(b.imp);
    const exp = add(b.exp);
    const net = imp.map((v, i) => (v == null && exp[i] == null ? null : (v ?? 0) - (exp[i] ?? 0)));
    return { ...b, imp, exp, net, impT: sum(imp) / 1000, expT: sum(exp) / 1000 };
  });
  const twh = (v) => `${fmt2.format(v)} TWh`;
  const sign = (v) => `${v >= 0 ? '+' : '−'}${gwh(Math.abs(v))}`;
  box.innerHTML = `<div class="legend"><span class="key"><i class="sw" style="background:var(--imp)"></i>import do Polski (+)</span><span class="key"><i class="sw" style="background:var(--exp)"></i>eksport z Polski (−)</span></div>
    <div class="smalls">${bs.map((b, k) => `<div class="small"><h3 class="sub-h">${b.name}</h3><p class="muted small-sum">import ${twh(b.impT)} · eksport ${twh(b.expT)}</p><div class="chart" id="g-border-${k}"></div></div>`).join('')}</div>` +
    table(['Doba gazowa', ...bs.flatMap((b) => [`${b.name}: import [GWh]`, 'eksport [GWh]'])], s.days.map((d, i) => [d, ...bs.flatMap((b) => [b.imp[i] == null ? '—' : fmt0.format(b.imp[i]), b.exp[i] == null ? '—' : fmt0.format(b.exp[i])])]).reverse()) +
    '<p class="note">Przepływy fizyczne w punktach na granicach (saldo doby: import − eksport). Każdy wykres ma własną skalę. Baltic Pipe dostarcza gaz z Norwegii przez Danię; Niemcy to punkt GCP (Lasów) i rewers gazociągu jamalskiego w Mallnow.</p>';
  bs.forEach((b, k) => drawChart(`g-border-${k}`, $(`#g-border-${k}`), {
    n: s.n, bars: true, barColor: (v) => (v >= 0 ? 'var(--imp)' : 'var(--exp)'), series: [{ name: b.name, color: 'var(--imp)', values: b.net }], legend: false,
    xTicks: dayTicks(s.days), height: 150, minSpan: 7, label: `Wymiana gazu z krajem: ${b.name}, GWh na dobę`,
    tooltip: (i) => tipRows(`${b.name} — ${gasDay(s.days[i])}`, [{ name: 'Import', color: 'var(--imp)', value: gwh(b.imp[i]) }, { name: 'Eksport', color: 'var(--exp)', value: gwh(b.exp[i]) }, { name: 'Saldo', value: b.net[i] == null ? '—' : sign(b.net[i]) }]),
  }, 'gas'));
}

function renderStore(s) {
  const box = $('#g-store-body');
  const per = STORAGES.map((st) => ({ ...st, out: s.f(st.key, 'entry'), in: s.f(st.key, 'exit') }));
  const net = s.days.map((_, i) => sum(per.map((p) => (p.in[i] ?? 0) - (p.out[i] ?? 0)))); // + zatłaczanie, − odbiór
  const cum = [];
  net.reduce((a, v, i) => (cum[i] = a + v / 1000), 0);
  const inT = sum(per.map((p) => sum(p.in))) / 1000;
  const outT = sum(per.map((p) => sum(p.out))) / 1000;
  const last = net.length - 1;
  box.innerHTML = tilesHtml([
    { l: 'Zatłoczono w okresie', v: `${fmt2.format(inT)} TWh` },
    { l: 'Odebrano w okresie', v: `${fmt2.format(outT)} TWh` },
    { l: 'Zmiana zapasu', v: `${inT - outT >= 0 ? '+' : '−'}${fmt2.format(Math.abs(inT - outT))} TWh`, d: 'od początku wybranego okresu' },
    { l: `Ostatnia doba (${fDM.format(dt(s.days[last]))})`, v: net[last] >= 0 ? `+${gwh(net[last])}` : `−${gwh(-net[last])}`, d: net[last] >= 0 ? 'zatłaczanie' : 'odbiór' },
  ]) +
    '<div class="chart" id="g-store-chart"></div>' +
    '<h3 class="sub-h">Zmiana zapasu od początku okresu</h3><div class="chart" id="g-cum-chart"></div>' +
    table(['Doba gazowa', ...per.flatMap((p) => [`${p.name}: zatł. [GWh]`, 'odbiór [GWh]']), 'Netto [GWh]'], s.days.map((d, i) => [d, ...per.flatMap((p) => [p.in[i] == null ? '—' : fmt0.format(p.in[i]), p.out[i] == null ? '—' : fmt0.format(p.out[i])]), fmt0.format(net[i])]).reverse()) +
    '<p class="note">Przepływy między systemem przesyłowym a magazynami (dane ENTSOG). Poziomu zapełnienia magazynów nie da się pobrać bez klucza API (GIE AGSI+), dlatego pokazujemy zmianę zapasu w wybranym okresie.</p>';
  drawChart('g-store', $('#g-store-chart'), {
    n: s.n, bars: true, barColor: (v) => (v >= 0 ? 'var(--s2)' : 'var(--s1)'), series: [{ name: 'Magazyny netto', color: 'var(--s2)', values: net }], xTicks: dayTicks(s.days), height: 220, minSpan: 7,
    legend: false, legendExtra: '<span class="key"><i class="sw" style="background:var(--s2)"></i>zatłaczanie (+)</span><span class="key"><i class="sw" style="background:var(--s1)"></i>odbiór (−)</span>',
    label: 'Saldo magazynów gazu, GWh na dobę',
    tooltip: (i) => tipRows(gasDay(s.days[i]), [
      ...per.filter((p) => (p.in[i] ?? 0) + (p.out[i] ?? 0) > 0.05).map((p) => ({ name: p.name, value: `${(p.in[i] ?? 0) - (p.out[i] ?? 0) >= 0 ? '+' : '−'}${gwh(Math.abs((p.in[i] ?? 0) - (p.out[i] ?? 0)))}` })),
      { name: 'Razem', color: net[i] >= 0 ? 'var(--s2)' : 'var(--s1)', value: `${net[i] >= 0 ? '+' : '−'}${gwh(Math.abs(net[i]))}` },
    ]),
  }, 'gas');
  drawChart('g-cum', $('#g-cum-chart'), {
    n: s.n, series: [{ name: 'Zmiana zapasu', color: 'var(--s2)', values: cum }], area: true, xTicks: dayTicks(s.days), height: 200, minSpan: 7,
    yFmt: (v) => `${fmt0.format(v)} TWh`, label: 'Skumulowana zmiana zapasu w magazynach, TWh',
    tooltip: (i) => tipRows(gasDay(s.days[i]), [{ name: 'Zmiana od początku okresu', color: 'var(--s2)', value: `${cum[i] >= 0 ? '+' : '−'}${fmt2.format(Math.abs(cum[i]))} TWh` }]),
  }, 'gas');
}

function renderPoints(s) {
  const box = $('#g-points-body');
  const pts = POINTS.map((p) => {
    const f = s.f(p.key, p.dir);
    const c = s.c(p.key, p.dir);
    const u = f.map((v, i) => (v != null && c[i] ? (v / c[i]) * 100 : null));
    const vals = u.filter((v) => v != null);
    const mx = u.reduce((a, v, i) => (v != null && (a < 0 || v > u[a]) ? i : a), -1);
    const lastCap = [...c].reverse().find((v) => v);
    return { ...p, f, c, u, avg: vals.length ? sum(vals) / vals.length : null, max: mx >= 0 ? u[mx] : null, maxI: mx, last: u[u.length - 1], lastCap, used: sum(f) > 0.5 };
  }).filter((p) => p.lastCap && p.used);
  box.innerHTML = `<div class="legend"><span class="key"><i class="sw" style="background:var(--ink-2)"></i>średnie wykorzystanie w okresie</span><span class="key"><i class="plan-key"></i>maksimum w okresie</span></div>
    <div class="util">${pts
      .map((p) => `<div class="urow"><div class="uname"><i class="sw" style="background:${p.color}"></i>${p.name}<span class="muted"> · ${fmt0.format(p.lastCap)} GWh/d</span></div>
        <div class="utrack"><span class="ubar" style="width:${Math.min(100, p.avg ?? 0)}%;background:${p.color}"></span>${p.max != null ? `<span class="umax" style="left:${Math.min(100, p.max)}%" title="Maksimum: ${pct(p.max)} (${fDay.format(dt(s.days[p.maxI]))})"></span>` : ''}</div>
        <div class="uval">śr. <b>${pct(p.avg)}</b> <span class="muted">maks. ${pct(p.max)} · ostatnio ${pct(p.last)}</span></div></div>`)
      .join('')}</div>
    <h3 class="sub-h">Wykorzystanie głównych punktów wejścia</h3><div class="chart" id="g-points-chart"></div>` +
    table(['Punkt', 'Moc techniczna [GWh/d]', 'Średnio', 'Maksimum', 'Ostatnia doba'], pts.map((p) => [p.name, fmt0.format(p.lastCap), pct(p.avg), pct(p.max), pct(p.last)])) +
    '<p class="note">Wykorzystanie = przepływ fizyczny ÷ moc techniczna ciągła (firm technical capacity) publikowana przez GAZ-SYSTEM w ENTSOG na daną dobę. Pominięto punkty bez przepływu w wybranym okresie. Magazyny: moc zatłaczania i odbioru zależy od stopnia napełnienia, a publikowana wartość jest maksymalna.</p>';
  const lines = pts.filter((p) => p.line);
  drawChart('g-points', $('#g-points-chart'), {
    n: s.n, series: lines.map((p) => ({ name: p.name, color: p.color, values: p.u })), xTicks: dayTicks(s.days), height: 260, minSpan: 7,
    yFmt: (v) => `${fmt0.format(v)}%`, label: 'Wykorzystanie mocy technicznej głównych punktów wejścia',
    tooltip: (i, on) => tipRows(gasDay(s.days[i]), lines.filter((p) => on(p.name)).map((p) => ({ name: p.name, color: p.color, value: p.u[i] == null ? '—' : `${pct(p.u[i])} · ${gwh(p.f[i])} z ${gwh(p.c[i])}` }))),
  }, 'gas');
}

async function renderPower(s) {
  const box = $('#g-power-body');
  try {
    if (!power) {
      box.innerHTML = empty('Ładowanie…');
      power = await loadPower(data.days[0]);
    }
    const gz = s.days.map((d) => power.get(d)?.gz ?? null);
    const gk = s.days.map((d) => power.get(d)?.gk ?? null);
    const tot = gz.map((v, i) => (v == null && gk[i] == null ? null : (v ?? 0) + (gk[i] ?? 0)));
    const idx = tot.map((v, i) => (v == null ? -1 : i)).filter((i) => i >= 0);
    if (!idx.length) return void (box.innerHTML = empty('Brak danych PSE dla wybranego okresu.'));
    const mx = idx.reduce((a, i) => (tot[i] > tot[a] ? i : a), idx[0]);
    const lastI = idx[idx.length - 1];
    box.innerHTML = tilesHtml([
      { l: 'Średnio na dobę', v: `${fmt2.format(avgOf(tot))} GWh`, d: `≈ ${fmt0.format((avgOf(tot) * 1000) / 24)} MW średniej mocy` },
      { l: 'Najwięcej', v: `${fmt2.format(tot[mx])} GWh`, d: fDay.format(dt(s.days[mx])) },
      { l: `Ostatni pełny dzień (${fDM.format(dt(s.days[lastI]))})`, v: `${fmt2.format(tot[lastI])} GWh`, d: `w tym gaz koksowniczy ${fmt2.format(gk[lastI] ?? 0)} GWh` },
    ]) +
      '<div class="chart" id="g-power-chart"></div>' +
      table(['Dzień', 'Gaz ziemny [GWh]', 'Gaz koksowniczy [GWh]', 'Razem [GWh]'], idx.map((i) => [s.days[i], fmt2.format(gz[i] ?? 0), fmt2.format(gk[i] ?? 0), fmt2.format(tot[i])]).reverse()) +
      '<p class="note">Energia elektryczna wyprodukowana z gazu według PSE (his-gen-pal-sire, kody GZ i GK), w dobach kalendarzowych (0:00–24:00), a nie gazowych. To energia elektryczna — zużycie gazu przez elektrownie jest mniej więcej dwukrotnie większe (sprawność bloków gazowych ok. 40–60%, część zużycia to też ciepło z elektrociepłowni).</p>';
    drawChart('g-power', $('#g-power-chart'), {
      n: s.n, bars: true, series: [{ name: 'Energia elektryczna z gazu', color: 'var(--g-gaz)', values: tot }], xTicks: dayTicks(s.days), height: 220, minSpan: 7,
      label: 'Produkcja energii elektrycznej z gazu, GWh na dobę',
      tooltip: (i) => tipRows(fDay.format(dt(s.days[i])), [{ name: 'Gaz ziemny', color: 'var(--g-gaz)', value: gz[i] == null ? '—' : `${fmt2.format(gz[i])} GWh` }, { name: 'Gaz koksowniczy', value: gk[i] == null ? '—' : `${fmt2.format(gk[i])} GWh` }]),
    }, 'gas');
  } catch (e) {
    box.innerHTML = errorBox(e);
  }
}

// ---------- Start ----------
initTheme();
initInstall();
$('#range').innerHTML = `<div class="seg" role="group" aria-label="Zakres">${Object.entries(RANGES).map(([r, l]) => `<button type="button" data-r="${r}">${l}</button>`).join('')}</div>`;
$('#range').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-r]');
  if (!b || !data) return;
  range = +b.dataset.r;
  try { localStorage.setItem('gasRange', range); } catch { /* j.w. */ }
  renderAll();
});

// Dane ENTSOG pobieramy zawsze (potrzebne też w zakładce miesięcznej); Eurostat — dopiero po otwarciu zakładki.
const dataReady = loadData().then((d) => {
  data = d;
  if (d.unknown.some((u) => u.dir === 'entry')) SUPPLY.push(UNK_IN);
  if (d.unknown.some((u) => u.dir === 'exit')) USE.push(UNK_OUT);
});
initTabs({
  d: () => dataReady.then(renderAll, (e) => { for (const id of SECTIONS) $(`#${id}-body`).innerHTML = errorBox(e); }),
  m: () => { renderUsesMonthly(); renderDepMonthly(); },
  r: () => { renderUsesYear(); renderDepYear(); },
});
