import { tipRows, fmt0, fmt2 } from './charts.js';
import { pse, plural, warsaw, todayIso, addDays, MONTHS, $, esc, errorBox, empty, table, tilesHtml, redraws, views, drawChart, initTheme, initInstall } from './common.js';

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
  let last = '';
  for (const r of rows) {
    if (r.pointKey.startsWith('VTP') || r.pointKey === 'ITP-00293') continue; // punkty wirtualne i połączenie wewnętrzne z gazociągiem jamalskim
    const k = `${r.pointKey}|${r.directionKey}`;
    const v = num(r.value);
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
  if (!last || !typical) return { days: [], flow: new Map(), cap: new Map() };
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
  return { days, flow, cap };
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
  const g = Object.fromEntries([...SUPPLY, ...USE, { id: 'sk' }, { id: 'ua' }].map((x) => [x.id, new Array(s.n).fill(null)]));
  for (const [key, dir, id, sign] of RULES) {
    s.f(key, dir).forEach((v, i) => { if (v != null) g[id][i] = (g[id][i] || 0) + sign * v; });
  }
  for (const st of STORAGES) {
    s.f(st.key, 'entry').forEach((v, i) => { if (v != null) g.ugsOut[i] = (g.ugsOut[i] || 0) + v; });
    s.f(st.key, 'exit').forEach((v, i) => { if (v != null) g.ugsIn[i] = (g.ugsIn[i] || 0) + v; });
  }
  return g;
}

// ---------- Renderowanie ----------
const SECTIONS = ['g-day', 'g-price', 'g-supply', 'g-use', 'g-borders', 'g-store', 'g-points', 'g-power'];

function renderAll() {
  redraws.clear();
  views.delete('gas');
  views.delete('gas-price');
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
  box.innerHTML = tilesHtml([
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
    '<p class="note">Przepływy między systemem przesyłowym a magazynami (dane ENTSOG). Poziomu zapełnienia magazynów nie da się pobrać bez klucza API (GIE AGSI+), dlatego pokazujemy zmianę zapasu w wybranym okresie. Pojemność czynna polskich magazynów to ok. 3,3 mld m³ (ok. 36 TWh).</p>';
  drawChart('g-store', $('#g-store-chart'), {
    n: s.n, bars: true, barColor: (v) => (v >= 0 ? 'var(--s2)' : 'var(--s1)'), series: [{ name: 'Magazyny netto', color: 'var(--s2)', values: net }], xTicks: dayTicks(s.days), height: 220, minSpan: 7,
    legend: true, legendExtra: '<span class="key"><i class="sw" style="background:var(--s2)"></i>zatłaczanie (+)</span><span class="key"><i class="sw" style="background:var(--s1)"></i>odbiór (−)</span>',
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

(async () => {
  try {
    data = await loadData();
    renderAll();
  } catch (e) {
    for (const id of SECTIONS) $(`#${id}-body`).innerHTML = errorBox(e);
  }
})();
