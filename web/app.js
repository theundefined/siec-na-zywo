import { renderMix, renderBills, renderRenYear, renderElecYear } from './stats.js';
import { tipRows, placeTip, hideTip, fmt0, fmt2 } from './charts.js';
import { pse, FILES, TZ, HOUR, fKey, warsaw, todayIso, addDays, MONTHS, $, plural, esc, mw, errorBox, empty, table, tilesHtml, redraws, views, drawChart, initTheme, initInstall, initTabs, clearGroups, staleNote, initCountry } from './common.js';

// ---------- Źródła danych (te same co w aplikacji Energetyczny Kompas) ----------

// Dane doby są współdzielone między sekcjami (kse-load, his-gen-pal-sire), więc pobieramy je raz.
const memo = new Map();
function pseDay(endpoint, first) {
  const key = `${endpoint}|${date}`;
  if (!memo.has(key)) {
    const p = pse(endpoint, `business_date eq '${date}'`, first);
    p.catch(() => memo.delete(key));
    memo.set(key, p);
  }
  return memo.get(key);
}

// Dowolne zapytanie z pamięcią podręczną (np. zakresy wielu dni).
function pseMemo(endpoint, filter, first) {
  const key = `${endpoint}|${filter}`;
  if (!memo.has(key)) {
    const p = pse(endpoint, filter, first);
    p.catch(() => memo.delete(key));
    memo.set(key, p);
  }
  return memo.get(key);
}

async function file(name) {
  const r = await fetch(`${FILES}/${name}`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// ---------- Czas (Europe/Warsaw, z obsługą zmiany czasu) ----------
const Q = 15 * 60e3;
const fTime = new Intl.DateTimeFormat('pl-PL', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const fDateLong = new Intl.DateTimeFormat('pl-PL', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const fDateTime = new Intl.DateTimeFormat('pl-PL', { timeZone: TZ, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

function utc(s) {
  const [d, t] = s.split(' ');
  const [Y, M, D] = d.split('-').map(Number);
  const [hh, mm, ss = 0] = t.split(':').map(Number);
  return Date.UTC(Y, M - 1, D, hh, mm, Math.floor(ss));
}
function midnight(iso) {
  const [Y, M, D] = iso.split('-').map(Number);
  for (const off of [1, 2, 0, 3]) {
    const t = Date.UTC(Y, M - 1, D) - off * HOUR;
    if (warsaw(t) === `${iso} 00:00`) return t;
  }
  throw new Error('Nie można wyznaczyć północy dla ' + iso);
}
// Siatka przedziałów doby: 92/96/100 kwadransów lub 23/24/25 godzin.
function dayGrid(iso, step) {
  const a = midnight(iso);
  const b = midnight(addDays(iso, 1));
  const starts = [];
  for (let t = a; t < b; t += step) starts.push(t);
  const index = new Map(starts.map((t, i) => [t, i]));
  return { starts, index, step };
}
// Etykiety osi czasu; gęstość zależy od widocznego zakresu (powiększenie).
function xTicks(grid) {
  const labels = grid.starts.map((t) => fTime.format(t));
  return (v0, v1) => {
    const hours = ((v1 - v0) * grid.step) / HOUR;
    const every = hours > 12 ? 180 : hours > 6 ? 60 : hours > 3 ? 30 : 15; // minuty
    const out = [];
    for (let i = Math.max(0, Math.floor(v0)); i <= Math.min(labels.length - 1, Math.ceil(v1)); i++) {
      const [h, mi] = labels[i].split(':').map(Number);
      if ((h * 60 + mi) % every === 0) out.push({ i, label: labels[i] });
    }
    return out;
  };
}
const period = (grid, i) => `${fTime.format(grid.starts[i])}–${fTime.format(grid.starts[i] + grid.step)}`;
function nowIndex(grid) {
  const now = Date.now();
  return grid.starts.findIndex((t) => now >= t && now < t + grid.step);
}

// ---------- Słowniki ----------
const STATES = {
  0: { name: 'Zalecane użytkowanie', icon: '▲', tip: 'Wykorzystaj nadmiar prądu — to dobry moment na pranie, zmywanie, ładowanie samochodu czy grzanie wody.' },
  1: { name: 'Normalne użytkowanie', icon: '●', tip: 'Normalnie korzystaj z prądu.' },
  2: { name: 'Zalecane oszczędzanie', icon: '▼', tip: 'Ogranicz zużycie: przesuń korzystanie z pralki, suszarki, zmywarki, piekarnika czy czajnika na inne godziny.' },
  3: { name: 'Wymagane ograniczanie', icon: '!', tip: 'Ogranicz swoje zużycie prądu do niezbędnego minimum.' },
};

// Kolejność = kolejność warstw od dołu; paliwa kopalne na dole, kolory „znaczeniowe” (zob. --g-* w style.css).
const GEN_GROUPS = [
  { name: 'Węgiel kamienny', codes: ['WK'], color: 'var(--g-wk)' },
  { name: 'Węgiel brunatny', codes: ['WB'], color: 'var(--g-wb)' },
  { name: 'Gaz', codes: ['GZ', 'GK'], color: 'var(--g-gaz)' },
  { name: 'Woda', codes: ['WP', 'WZ', 'WS'], color: 'var(--g-woda)' },
  { name: 'Wiatr lądowy', codes: ['WI'], color: 'var(--g-wl)' },
  { name: 'Wiatr morski', codes: ['WM'], color: 'var(--g-wm)' },
  { name: 'Słońce (PV)', codes: ['ES'], color: 'var(--g-pv)' },
  { name: 'Biomasa, biogaz i inne', codes: ['BM', 'BG', 'OD', 'OO', 'IN'], color: 'var(--g-bio)' },
];
// Moc osiągalna źródeł (API PSE jej nie udostępnia) — aktualizować ręcznie raz w miesiącu.
// Źródło: ARE S.A. (statystyka publiczna), „Moc elektryczna osiągalna (stan na koniec miesiąca) wg rodzajów paliw
// i technologii wytwarzania”. ARE nie rozdziela wiatru: wartość ARE obejmuje farmy lądowe, bo jedyna farma morska
// (Baltic Power) jest w rozruchu i nie weszła jeszcze do mocy osiągalnej — dla niej przyjmujemy moc nominalną.
// Moc osiągalna: aktualne dane z data/capacity.json (ARE, pobierane przez GitHub Actions); poniższe wartości to zapas,
// gdy pliku brak. Wiatr morski nie jest jeszcze wykazywany przez ARE — stała 1140 MW (Baltic Power) do czasu, aż się pojawi.
const CAPACITY = {
  asOf: '2026-07',
  sources: [
    { name: 'ARE — moc osiągalna wg paliw', url: 'https://www.are.waw.pl/badania-statystyczne/prezentacja-wybranych-danych' },
    { name: 'Baltic Power — 76 turbin × 15 MW', url: 'https://balticpower.pl/o-projekcie/' },
  ],
  groups: [
    { name: 'Węgiel kamienny', codes: ['WK'], are: ['WK'], mw: 20976.839, color: 'var(--g-wk)' },
    { name: 'Węgiel brunatny', codes: ['WB'], are: ['WB'], mw: 7605, color: 'var(--g-wb)' },
    { name: 'Gaz ziemny', codes: ['GZ'], are: ['GZ'], mw: 6035.578, color: 'var(--g-gaz)' },
    { name: 'Biomasa i biogaz', codes: ['BM', 'BG'], are: ['BM', 'BG'], mw: 912.81 + 324.771, color: 'var(--g-bio)' },
    { name: 'Woda (bez szczytowo-pompowych)', codes: ['WP', 'WZ'], are: ['WODA'], mw: 1002.226, color: 'var(--g-woda)' },
    { name: 'Wiatr lądowy', codes: ['WI'], are: ['WIATR'], mw: 10822.661, color: 'var(--g-wl)' },
    { name: 'Wiatr morski (w rozruchu)', codes: ['WM'], mw: 1140, color: 'var(--g-wm)' },
    { name: 'Słońce (PV)', codes: ['ES'], are: ['PV'], mw: 27119.471, color: 'var(--g-pv)' },
  ],
};

const OZE_CODES = new Set(['WI', 'ES', 'WM', 'BM', 'BG', 'WP', 'WZ']);

const COUNTRIES = { SE: 'Szwecja', DE: 'Niemcy', CZ: 'Czechy', SK: 'Słowacja', UA: 'Ukraina', LT: 'Litwa' };

// ---------- Pomocnicze ----------

// Początek renderowania sekcji: zapamiętuje dzień (odrzucamy spóźnione odpowiedzi po zmianie daty)
// oraz stan rozwiniętych paneli <details>, by ciche odświeżenie nie zwijało ich ani nie skakało stroną.
function begin(box, silent) {
  const d = date;
  const open = [...box.querySelectorAll('details')].map((x) => x.open);
  if (!silent) box.innerHTML = empty('Ładowanie…');
  return {
    stale: () => d !== date,
    restore: () => silent && box.querySelectorAll('details').forEach((x, i) => open[i] && (x.open = true)),
  };
}



// ---------- Stan ----------
let date = new URLSearchParams(location.search).get('d') || todayIso();

function setDate(iso) {
  const max = addDays(todayIso(), 1);
  if (iso > max) iso = max;
  date = iso;
  const url = new URL(location.href);
  if (iso === todayIso()) url.searchParams.delete('d');
  else url.searchParams.set('d', iso);
  history.replaceState(null, '', url);
  $('#date').value = iso;
  $('#date').max = max;
  $('#next').disabled = iso >= max;
  const rel = iso === todayIso() ? 'Dziś' : iso === addDays(todayIso(), 1) ? 'Jutro' : iso === addDays(todayIso(), -1) ? 'Wczoraj' : '';
  $('#date-label').textContent = (rel ? rel + ', ' : '') + fDateLong.format(new Date(iso + 'T00:00:00Z'));
  loadDay();
}

// ---------- Kompas (pdgsz) ----------
function hourStrip(rows, grid, { mini = false, now = -1 } = {}) {
  const byIdx = new Map(rows.map((r) => [grid.index.get(utc(r.dtime_utc)), r]));
  return (
    `<div class="strip${mini ? ' mini' : ''}" style="--n:${grid.starts.length}">` +
    grid.starts
      .map((t, i) => {
        const r = byIdx.get(i);
        const s = r ? r.usage_fcst : null;
        const label = `${period(grid, i)} · ${s == null ? 'brak danych' : STATES[s].name}`;
        if (mini) return `<span class="cell s${s ?? 'x'}" title="${label}"></span>`;
        return `<div class="cell s${s ?? 'x'}${i === now ? ' now' : ''}" title="${label}" aria-label="${label}"><span class="hh">${fTime.format(t).slice(0, 2)}</span><span class="ic" aria-hidden="true">${s == null ? '' : STATES[s].icon}</span></div>`;
      })
      .join('') +
    '</div>'
  );
}

function stateLegend() {
  return (
    '<div class="legend states">' +
    [0, 1, 2, 3].map((s) => `<span class="key"><i class="cell-key s${s}" aria-hidden="true">${STATES[s].icon}</i>${STATES[s].name}</span>`).join('') +
    '</div>'
  );
}

function summarize(rows) {
  const c = [0, 0, 0, 0];
  rows.forEach((r) => c[r.usage_fcst]++);
  return [0, 2, 3]
    .filter((s) => c[s])
    .map((s) => `<span class="pill s${s}">${STATES[s].icon} ${c[s]} h · ${STATES[s].name.toLowerCase()}</span>`)
    .join('') || '<span class="pill s1">● cały dzień: normalne użytkowanie</span>';
}

function ranges(rows, grid, state) {
  // Łączy kolejne godziny o danym stanie w przedziały „07:00–10:00”.
  const idx = rows.filter((r) => r.usage_fcst === state).map((r) => grid.index.get(utc(r.dtime_utc))).sort((a, b) => a - b);
  const out = [];
  for (const i of idx) {
    const last = out[out.length - 1];
    if (last && last[1] === i - 1) last[1] = i;
    else out.push([i, i]);
  }
  return out.map(([a, b]) => `${fTime.format(grid.starts[a])}–${fTime.format(grid.starts[b] + grid.step)}`);
}

async function renderKompas({ silent = false } = {}) {
  const box = $('#kompas-body');
  const run = begin(box, silent);
  const isToday = date === todayIso();
  const next = addDays(date, 1);
  try {
    const [all, nextActive] = await Promise.all([
      pse('pdgsz', `business_date eq '${date}'`, 5000),
      isToday ? pse('pdgsz', `business_date eq '${next}' and is_active eq true`, 100).catch(() => []) : Promise.resolve([]),
    ]);
    if (run.stale()) return;
    const active = all.filter((r) => r.is_active);
    const grid = dayGrid(date, HOUR);
    if (!active.length) {
      box.innerHTML = empty('Prognoza dla tego dnia nie została jeszcze opublikowana — PSE publikuje ją zwykle po południu dnia poprzedniego.');
      return;
    }
    let html = '';
    const ni = isToday ? nowIndex(grid) : -1;
    if (ni >= 0) {
      const cur = active.find((r) => grid.index.get(utc(r.dtime_utc)) === ni);
      if (cur) {
        const st = STATES[cur.usage_fcst];
        // Najbliższa zmiana stanu.
        const later = active
          .map((r) => ({ i: grid.index.get(utc(r.dtime_utc)), s: r.usage_fcst }))
          .filter((x) => x.i > ni)
          .sort((a, b) => a.i - b.i);
        const change = later.find((x) => x.s !== cur.usage_fcst);
        html += `<div class="hero s${cur.usage_fcst}">
          <div class="hero-icon" aria-hidden="true">${st.icon}</div>
          <div><div class="hero-kicker">Teraz (${period(grid, ni)})</div>
          <div class="hero-state">${st.name}</div>
          <p class="hero-tip">${st.tip}</p>
          ${change ? `<p class="hero-next">Od ${fTime.format(grid.starts[change.i])}: <b>${STATES[change.s].name.toLowerCase()}</b></p>` : ''}</div>
        </div>`;
      }
    }
    html += `<div class="strip-head"><h3>${isToday ? 'Dziś' : 'Wybrany dzień'}</h3><div class="pills">${summarize(active)}</div></div>`;
    html += hourStrip(active, grid, { now: ni });
    const spans = [0, 2, 3]
      .map((s) => ({ s, r: ranges(active, grid, s) }))
      .filter((x) => x.r.length)
      .map((x) => `<li><span class="cell-key s${x.s}" aria-hidden="true">${STATES[x.s].icon}</span><b>${STATES[x.s].name}:</b> ${x.r.join(', ')}</li>`)
      .join('');
    if (spans) html += `<ul class="spans">${spans}</ul>`;

    if (isToday) {
      const g2 = dayGrid(next, HOUR);
      html += `<div class="strip-head"><h3>Jutro</h3><div class="pills">${nextActive.length ? summarize(nextActive) : ''}</div></div>`;
      html += nextActive.length ? hourStrip(nextActive, g2) : empty('Prognoza na jutro pojawi się zwykle po południu.');
    }
    html += stateLegend();

    // Historia prognoz: kolejne wersje publikacji dla tej doby.
    // Uwaga: lokalne znaczniki (publication_ts, valid_to_ts) w dniu zmiany czasu mają postać „02a:25”,
    // dlatego używamy wyłącznie pól *_utc; moment zastąpienia = publikacja następnej wersji.
    const versions = new Map();
    for (const r of all) {
      const k = r.publication_ts_utc;
      if (!versions.has(k)) versions.set(k, []);
      versions.get(k).push(r);
    }
    const vs = [...versions.entries()].sort((a, b) => utc(b[0]) - utc(a[0]));
    if (vs.length > 1) {
      html += `<details class="history"><summary>Historia prognoz (${vs.length} wersji)</summary><div class="history-list">${vs
        .map(([pub, rows], k) => {
          const act = rows.some((r) => r.is_active);
          const replaced = k > 0 ? ` <span class="muted">→ zastąpiona ${fDateTime.format(utc(vs[k - 1][0]))}</span>` : '';
          return `<div class="hist-row${act ? ' active' : ''}"><div class="hist-meta">Opublikowana ${fDateTime.format(utc(pub))}${
            act ? ' <span class="badge">aktualna</span>' : replaced
          }</div>${hourStrip(rows, grid, { mini: true })}</div>`;
        })
        .join('')}</div></details>`;
    }
    box.innerHTML = html;
    run.restore();
  } catch (e) {
    if (run.stale()) return;
    box.innerHTML = errorBox(e);
  }
}

// ---------- Parsowanie danych doby ----------
function parseLoad(rows, grid) {
  const n = grid.starts.length;
  const fc = new Array(n).fill(null);
  const ac = new Array(n).fill(null);
  for (const r of rows) {
    const i = grid.index.get(utc(r.dtime_utc) - Q);
    if (i == null) continue;
    fc[i] = r.load_fcst;
    ac[i] = r.load_actual;
  }
  return { fc, ac };
}

function parseGen(rows, grid) {
  const n = grid.starts.length;
  const codeGroup = new Map();
  GEN_GROUPS.forEach((g, k) => g.codes.forEach((c) => codeGroup.set(c, k)));
  const series = GEN_GROUPS.map((g) => ({ name: g.name, color: g.color, values: new Array(n).fill(null) }));
  let total = 0;
  let oze = 0;
  for (const r of rows) {
    const i = grid.index.get(utc(r.dtime_utc) - Q);
    const k = codeGroup.get(r.alias_sire);
    if (i == null || k == null) continue;
    const v = parseFloat(String(r.value).replace(',', '.'));
    if (!isFinite(v)) continue;
    series[k].values[i] = (series[k].values[i] || 0) + v;
    total += Math.max(0, v) / 4;
    if (OZE_CODES.has(r.alias_sire)) oze += Math.max(0, v) / 4;
  }
  // Uzupełnij brakujące grupy zerami tam, gdzie są jakiekolwiek dane.
  for (let i = 0; i < n; i++) if (series.some((s) => s.values[i] != null)) series.forEach((s) => (s.values[i] ??= 0));
  const sum = new Array(n).fill(null).map((_, i) => (series[0].values[i] == null ? null : series.reduce((a, s) => a + s.values[i], 0)));
  return { series, total, oze, sum };
}

// ---------- Zapotrzebowanie (kse-load) ----------
async function renderLoad({ silent = false } = {}) {
  const box = $('#load-body');
  const run = begin(box, silent);
  try {
    const rows = await pseDay('kse-load', 500);
    if (run.stale()) return;
    if (!rows.length) return void (box.innerHTML = empty('Brak danych dla wybranego dnia.'));
    const grid = dayGrid(date, Q);
    const n = grid.starts.length;
    const { fc, ac } = parseLoad(rows, grid);
    const series = [
      { name: 'Prognoza', color: 'var(--s1)', values: fc },
      { name: 'Rzeczywiste', color: 'var(--s2)', values: ac },
    ];
    const lastA = ac.reduce((k, v, i) => (v != null ? i : k), -1);
    const peak = fc.reduce((k, v, i) => (v != null && (k < 0 || v > fc[k]) ? i : k), -1);
    const tiles = [
      lastA >= 0 ? { l: `Ostatni pomiar (${period(grid, lastA)})`, v: mw(ac[lastA]), d: fc[lastA] != null ? `${ac[lastA] >= fc[lastA] ? '+' : '−'}${fmt0.format(Math.abs(ac[lastA] - fc[lastA]))} MW względem prognozy` : '' } : null,
      peak >= 0 ? { l: 'Prognozowany szczyt', v: mw(fc[peak]), d: period(grid, peak) } : null,
      { l: 'Prognozowane zużycie doby', v: `${fmt0.format(fc.reduce((s, v) => s + (v || 0), 0) / 4000)} GWh`, d: '' },
    ].filter(Boolean);
    // Dziś: ostatni pomiar PSE powinien być sprzed najwyżej ok. 2 godzin.
    const lastEnd = lastA >= 0 ? grid.starts[lastA] + grid.step : midnight(date);
    const fresh = date === todayIso() ? staleNote({ what: 'o zapotrzebowaniu (PSE)', at: lastEnd, maxMinutes: 120 }) : '';
    box.innerHTML = fresh + tilesHtml(tiles) + '<div class="chart" id="load-chart"></div>' +
      table(['Okres', 'Prognoza [MW]', 'Rzeczywiste [MW]'], grid.starts.map((_, i) => [period(grid, i), fc[i] == null ? '—' : fmt0.format(fc[i]), ac[i] == null ? '—' : fmt0.format(ac[i])]));
    drawChart('load', $('#load-chart'), {
      n, series, xTicks: xTicks(grid), label: 'Zapotrzebowanie KSE: prognoza i wykonanie',
      nowIndex: date === todayIso() ? nowIndex(grid) : null, zero: false,
      tooltip: (i, on) => tipRows(period(grid, i), series.filter((s) => on(s.name)).map((s) => ({ name: s.name, color: s.color, value: mw(s.values[i]) }))),
    });
    run.restore();
  } catch (e) {
    if (run.stale()) return;
    box.innerHTML = errorBox(e);
  }
}

// ---------- Zapotrzebowanie a produkcja (kse-load + his-gen-pal-sire) ----------
async function renderBalance({ silent = false } = {}) {
  const box = $('#bal-body');
  const run = begin(box, silent);
  try {
    const [loadRows, genRows, flowRows, wlkRows] = await Promise.all([
      pseDay('kse-load', 500),
      pseDay('his-gen-pal-sire', 20000),
      pseDay('przeplywy-mocy', 5000).catch(() => []),
      pseDay('his-wlk-cal', 500).catch(() => []),
    ]);
    if (run.stale()) return;
    if (!loadRows.length || !genRows.length) return void (box.innerHTML = empty('Brak danych o zapotrzebowaniu lub generacji dla wybranego dnia.'));
    const grid = dayGrid(date, Q);
    const n = grid.starts.length;
    const { ac } = parseLoad(loadRows, grid);
    const { sum: gen } = parseGen(genRows, grid);
    const diff = gen.map((g, i) => (g == null || ac[i] == null ? null : g - ac[i]));
    // Eksport netto z przepływów fizycznych: wartości < 0 to eksport, > 0 import (każda granica, oba kierunki).
    const exp = new Array(n).fill(null);
    for (const r of flowRows) {
      const i = grid.index.get(utc(r.dtime_utc) - Q);
      if (i != null && r.value != null) exp[i] = (exp[i] || 0) - r.value;
    }
    // Pobór mocy przez elektrownie szczytowo-pompowe (jgm < 0 = pompowanie).
    const pump = new Array(n).fill(null);
    for (const r of wlkRows) {
      const i = grid.index.get(utc(r.dtime_utc) - Q);
      if (i != null && r.jgm != null) pump[i] = Math.max(0, -r.jgm);
    }
    const resid = diff.map((d, i) => (d == null || exp[i] == null ? null : d - exp[i]));
    const rest = resid.map((r, i) => (r == null || pump[i] == null ? null : r - pump[i]));
    const series = [
      { name: 'Zapotrzebowanie (rzeczywiste)', color: 'var(--ink-2)', values: ac },
      { name: 'Produkcja (suma generacji)', color: 'var(--s7)', values: gen },
    ];
    const both = diff.map((d, i) => i).filter((i) => diff[i] != null);
    const last = both[both.length - 1];
    const eGen = both.reduce((a, i) => a + gen[i], 0) / 4000;
    const eLoad = both.reduce((a, i) => a + ac[i], 0) / 4000;
    const saldo = (d) => (d >= 0 ? `nadwyżka ${mw(d)}` : `niedobór ${mw(-d)}`);
    const maxSur = both.reduce((a, i) => (a == null || diff[i] > diff[a] ? i : a), null);
    const maxDef = both.reduce((a, i) => (a == null || diff[i] < diff[a] ? i : a), null);
    const tiles = last == null ? [] : [
      { l: `Ostatni kwadrans (${period(grid, last)})`, v: saldo(diff[last]), d: `produkcja ${mw(gen[last])} · zapotrzebowanie ${mw(ac[last])}` },
      { l: 'Bilans energii doby', v: `${eGen - eLoad >= 0 ? '+' : '−'}${fmt0.format(Math.abs(eGen - eLoad))} GWh`, d: `wyprodukowano ${fmt0.format(eGen)} GWh, zużyto ${fmt0.format(eLoad)} GWh` },
      diff[maxSur] > 0 ? { l: 'Największa nadwyżka', v: mw(diff[maxSur]), d: period(grid, maxSur) } : null,
      diff[maxDef] < 0 ? { l: 'Największy niedobór', v: mw(-diff[maxDef]), d: period(grid, maxDef) } : null,
    ].filter(Boolean);
    const rb = resid.map((_, i) => i).filter((i) => rest[i] != null);
    const avg = (arr) => rb.reduce((a, i) => a + arr[i], 0) / rb.length;
    const maxAbs = (arr) => rb.reduce((a, i) => Math.max(a, Math.abs(arr[i])), 0);
    const residSeries = [
      { name: 'Produkcja − (zapotrzebowanie + eksport)', color: 'var(--ink-2)', values: resid },
      { name: 'Pompowanie w elektrowniach szczytowo-pompowych', color: 'var(--g-woda)', values: pump.map((p, i) => (resid[i] == null ? null : p)) },
    ];
    const residHtml = !rb.length
      ? '<h3 class="sub-h">Czy produkcja = zapotrzebowanie + eksport?</h3>' + empty('Brak danych o przepływach międzysystemowych dla wybranego dnia.')
      : '<h3 class="sub-h">Czy produkcja = zapotrzebowanie + eksport?</h3>' +
        tilesHtml([
          { l: 'Produkcja − (zapotrzebowanie + eksport)', v: `śr. ${mw(avg(resid))}`, d: `maks. ${mw(maxAbs(resid))}` },
          { l: 'W tym pompowanie (elektrownie szczytowo-pompowe)', v: `śr. ${mw(avg(pump))}`, d: `maks. ${mw(maxAbs(pump))}` },
          { l: 'Po uwzględnieniu pompowania', v: `śr. ${avg(rest) >= 0 ? '+' : '−'}${mw(Math.abs(avg(rest)))}`, d: `maks. odchyłka ±${mw(maxAbs(rest))}` },
        ]) +
        '<div class="chart" id="resid-chart"></div>' +
        '<p class="note">Nie pokrywa się: część produkcji zużywają elektrownie szczytowo-pompowe na pompowanie wody (nie jest to ujęte w zapotrzebowaniu KSE). Po jego odjęciu bilans zamyka się z dokładnością do kilkudziesięciu MW. Eksport netto: przepływy fizyczne na wszystkich granicach (PSE, przeplywy-mocy); pompowanie: his-wlk-cal (jgm).</p>';
    box.innerHTML = tilesHtml(tiles) +
      '<div class="chart" id="bal-chart"></div>' +
      '<h3 class="sub-h">Różnica: produkcja − zapotrzebowanie</h3>' +
      '<div class="chart" id="diff-chart"></div>' +
      residHtml +
      table(['Okres', 'Zapotrzebowanie [MW]', 'Produkcja [MW]', 'Produkcja − zapotrz. [MW]', 'Eksport netto [MW]', 'Pompowanie [MW]', 'Niezbilansowane [MW]'],
        grid.starts.map((_, i) => [period(grid, i), ...[ac[i], gen[i], diff[i], exp[i], pump[i], rest[i]].map((v) => (v == null ? '—' : fmt0.format(v)))]));
    drawChart('bal', $('#bal-chart'), {
      n, series, band: { a: 1, b: 0, pos: 'var(--exp)', neg: 'var(--imp)' }, xTicks: xTicks(grid), label: 'Zapotrzebowanie a produkcja energii',
      legendExtra: '<span class="key"><i class="sw wash" style="background:var(--exp)"></i>nadwyżka (eksport)</span><span class="key"><i class="sw wash" style="background:var(--imp)"></i>niedobór (import)</span>',
      nowIndex: date === todayIso() ? nowIndex(grid) : null, zero: false,
      tooltip: (i, on) => tipRows(period(grid, i), [
        ...series.filter((s) => on(s.name)).map((s) => ({ name: s.name, color: s.color, value: mw(s.values[i]) })),
        { name: 'Różnica', color: diff[i] == null ? null : diff[i] >= 0 ? 'var(--exp)' : 'var(--imp)', value: diff[i] == null ? '—' : saldo(diff[i]) },
      ]),
    });
    drawChart('diff', $('#diff-chart'), {
      n, series: [{ name: 'Różnica', color: 'var(--exp)', values: diff }], bars: true, height: 200,
      barColor: (v) => (v >= 0 ? 'var(--exp)' : 'var(--imp)'),
      yFmt: (v) => (v > 0 ? '+' : v < 0 ? '−' : '') + fmt0.format(Math.abs(v)),
      xTicks: xTicks(grid), label: 'Różnica produkcji i zapotrzebowania',
      legendExtra: '<span class="key"><i class="sw" style="background:var(--exp)"></i>nadwyżka (eksport)</span><span class="key"><i class="sw" style="background:var(--imp)"></i>niedobór (import)</span>',
      nowIndex: date === todayIso() ? nowIndex(grid) : null,
      tooltip: (i) => tipRows(period(grid, i), [{ name: 'Różnica', color: diff[i] == null ? null : diff[i] >= 0 ? 'var(--exp)' : 'var(--imp)', value: diff[i] == null ? '—' : saldo(diff[i]) }]),
    });
    if (rb.length)
      drawChart('resid', $('#resid-chart'), {
        n, series: residSeries, xTicks: xTicks(grid), height: 220, label: 'Produkcja minus zapotrzebowanie i eksport, na tle pompowania',
        nowIndex: date === todayIso() ? nowIndex(grid) : null,
        tooltip: (i) => tipRows(period(grid, i), [
          { name: 'Produkcja', value: mw(gen[i]) },
          { name: 'Zapotrzebowanie', value: mw(ac[i]) },
          { name: `Eksport netto`, value: exp[i] == null ? '—' : exp[i] >= 0 ? mw(exp[i]) : `import ${mw(-exp[i])}` },
          { name: 'Różnica', color: 'var(--ink-2)', value: mw(resid[i]) },
          { name: 'Pompowanie', color: 'var(--g-woda)', value: mw(pump[i]) },
          { name: 'Niezbilansowane', value: mw(rest[i]) },
        ]),
      });
    run.restore();
  } catch (e) {
    if (run.stale()) return;
    box.innerHTML = errorBox(e);
  }
}

// ---------- Wykorzystanie mocy osiągalnej (his-gen-pal-sire / capacity.json) ----------
let capP;
function loadCapacity() {
  capP ??= fetch('data/capacity.json', { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then((doc) => ({
      ...CAPACITY, asOf: doc.dataAsOf, fetched: doc.fetched, stale: doc.stale, live: true,
      groups: CAPACITY.groups.map((g) => (g.are ? { ...g, mw: g.are.reduce((a, c) => a + (doc.mw[c] ?? 0), 0) } : g)),
    }))
    .catch(() => ({ ...CAPACITY, live: false }));
  return capP;
}
const monthName = (ym) => `${['styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień'][+ym.slice(5, 7) - 1]} ${ym.slice(0, 4)}`;
async function renderUtil({ silent = false } = {}) {
  const box = $('#util-body');
  const run = begin(box, silent);
  try {
    const [rows, CAP] = await Promise.all([pseDay('his-gen-pal-sire', 20000), loadCapacity()]);
    if (run.stale()) return;
    if (!rows.length) return void (box.innerHTML = empty('Brak danych o generacji dla wybranego dnia.'));
    const grid = dayGrid(date, Q);
    const n = grid.starts.length;
    const codeGroup = new Map();
    CAP.groups.forEach((g, k) => g.codes.forEach((c) => codeGroup.set(c, k)));
    const mwv = CAP.groups.map(() => new Array(n).fill(null));
    for (const r of rows) {
      const i = grid.index.get(utc(r.dtime_utc) - Q);
      const k = codeGroup.get(r.alias_sire);
      if (i == null || k == null) continue;
      const v = parseFloat(String(r.value).replace(',', '.'));
      if (isFinite(v)) mwv[k][i] = (mwv[k][i] || 0) + Math.max(0, v);
    }
    const series = CAP.groups.map((g, k) => ({ name: g.name, color: g.color, values: mwv[k].map((v) => (v == null ? null : (v / g.mw) * 100)) }));
    const idx = series[0].values.map((_, i) => i).filter((i) => series.some((s) => s.values[i] != null));
    const last = idx[idx.length - 1];
    const pct = (v) => (v == null ? '—' : `${fmt0.format(v)}%`);
    const stats = series.map((s) => {
      const vals = idx.map((i) => s.values[i] ?? 0);
      const mx = vals.reduce((a, v, j) => (v > vals[a] ? j : a), 0);
      return { avg: vals.reduce((a, v) => a + v, 0) / vals.length, max: vals[mx], maxI: idx[mx], last: s.values[last] };
    });
    const rowsHtml = CAP.groups
      .map((g, k) => {
        const st = stats[k];
        return `<div class="urow"><div class="uname"><i class="sw" style="background:${g.color}"></i>${g.name}<span class="muted"> · ${fmt0.format(g.mw)} MW</span></div>
          <div class="utrack"><span class="ubar" style="width:${Math.min(100, st.avg)}%;background:${g.color}"></span><span class="umax" style="left:${Math.min(100, st.max)}%" title="Maksimum: ${pct(st.max)} (${period(grid, st.maxI)})"></span></div>
          <div class="uval">śr. <b>${pct(st.avg)}</b> <span class="muted">maks. ${pct(st.max)} · ostatnio ${pct(st.last)}</span></div></div>`;
      })
      .join('');
    box.innerHTML = staleNote({ what: 'o mocy osiągalnej (ARE)', asOf: CAP.asOf, maxDays: 120, fetched: CAP.fetched, stale: CAP.stale }) + `<div class="legend"><span class="key"><i class="sw" style="background:var(--ink-2)"></i>średnie wykorzystanie w dobie</span><span class="key"><i class="plan-key"></i>maksimum w dobie</span></div>
      <div class="util">${rowsHtml}</div>` +
      '<h3 class="sub-h">Wykorzystanie w ciągu doby</h3>' + '<div class="chart" id="util-chart"></div>' +
      table(['Okres', ...CAP.groups.map((g) => g.name + ' [%]')], grid.starts.map((_, i) => [period(grid, i), ...series.map((s) => (s.values[i] == null ? '—' : fmt0.format(s.values[i])))])) +
      `<p class="note">Wykorzystanie = bieżąca generacja (PSE) ÷ moc osiągalna danego rodzaju źródeł, stan na koniec: ${monthName(CAP.asOf)}${CAP.live ? ' (pobierane automatycznie z ARE)' : ' (wartości zapasowe — nie udało się wczytać aktualnych danych ARE)'}. Źródła mocy: ${CAP.sources.map((x) => `<a href="${x.url}" rel="noopener">${x.name}</a>`).join(', ')}. Moc to wartość stała — nie uwzględnia bieżących remontów i ubytków. Wiatr morski: ARE jeszcze go nie wykazuje, dlatego przyjmujemy ręcznie wpisaną moc nominalną Baltic Power (1140 MW; farma jest w rozruchu). ARE nie rozdziela wiatru na lądowy i morski — gdy zacznie wykazywać morski, trzeba to rozdzielić. Instalacje hybrydowe OZE (ok. 28 MW) pominięto. Pominięto elektrownie szczytowo-pompowe (ARE nie podaje ich mocy osobno) oraz gaz koksowniczy, olej i odpady.</p>`;
    drawChart('util', $('#util-chart'), {
      n, series, xTicks: xTicks(grid), height: 280, label: 'Wykorzystanie mocy osiągalnej według rodzaju źródła',
      yFmt: (v) => `${fmt0.format(v)}%`,
      nowIndex: date === todayIso() ? nowIndex(grid) : null,
      tooltip: (i, on) => tipRows(period(grid, i), series.map((s, k) => [s, k]).filter(([s]) => on(s.name)).map(([s, k]) => ({ name: s.name, color: s.color, value: s.values[i] == null ? '—' : `${pct(s.values[i])} · ${fmt0.format(mwv[k][i])} MW` }))),
    });
    run.restore();
  } catch (e) {
    if (run.stale()) return;
    box.innerHTML = errorBox(e);
  }
}

// ---------- Dobowa struktura generacji (his-gen-pal-sire) ----------
async function renderGen({ silent = false } = {}) {
  const box = $('#gen-body');
  const run = begin(box, silent);
  try {
    const rows = await pseDay('his-gen-pal-sire', 20000);
    if (run.stale()) return;
    if (!rows.length) return void (box.innerHTML = empty(date > todayIso() ? 'Dane o generacji pojawiają się na bieżąco w trakcie doby.' : 'Brak danych dla wybranego dnia.'));
    const grid = dayGrid(date, Q);
    const n = grid.starts.length;
    const { series, total, oze } = parseGen(rows, grid);
    const sumAt = (i) => series.reduce((a, s) => a + (s.values[i] || 0), 0);
    const energy = series.map((s) => s.values.reduce((a, v) => a + (v || 0), 0) / 4);
    const top = energy.map((e, k) => [e, k]).sort((a, b) => b[0] - a[0])[0];
    const tiles = [
      { l: 'Udział OZE w wybranej dobie', v: `${fmt0.format((oze / total) * 100)}%`, d: 'wiatr, słońce, biomasa, biogaz, woda (bez elektrowni szczytowo-pompowych)' },
      { l: 'Energia wyprodukowana', v: `${fmt0.format(total / 1000)} GWh`, d: 'suma dla dostępnych kwadransów' },
      { l: 'Największe źródło', v: GEN_GROUPS[top[1]].name, d: `${fmt0.format((top[0] / total) * 100)}% energii` },
    ];
    box.innerHTML = tilesHtml(tiles) + '<div class="chart" id="gen-chart"></div>' +
      table(['Okres', ...GEN_GROUPS.map((g) => g.name), 'Suma'], grid.starts.map((_, i) => [period(grid, i), ...series.map((s) => (s.values[i] == null ? '—' : fmt0.format(s.values[i]))), series[0].values[i] == null ? '—' : fmt0.format(sumAt(i))]));
    drawChart('gen', $('#gen-chart'), {
      n, series, stacked: true, xTicks: xTicks(grid), height: 300, label: 'Dobowa struktura generacji mocy według źródeł',
      nowIndex: date === todayIso() ? nowIndex(grid) : null,
      tooltip: (i, on) => {
        if (series[0].values[i] == null) return tipRows(period(grid, i), [{ name: 'brak danych', value: '' }]);
        const tot = sumAt(i);
        return tipRows(period(grid, i), [
          ...series.slice().reverse().filter((s) => on(s.name)).map((s) => ({ name: s.name, color: s.color, value: `${fmt0.format(s.values[i])} MW · ${fmt0.format((s.values[i] / tot) * 100)}%` })),
          { name: 'Razem', value: mw(tot) },
        ]);
      },
    });
    run.restore();
  } catch (e) {
    if (run.stale()) return;
    box.innerHTML = errorBox(e);
  }
}

// ---------- RCE (rce-pln) ----------
async function renderRce({ silent = false } = {}) {
  const box = $('#rce-body');
  const run = begin(box, silent);
  try {
    const rows = await pse('rce-pln', `business_date eq '${date}'`, 500);
    if (run.stale()) return;
    if (!rows.length) return void (box.innerHTML = empty('Ceny RCE dla tego dnia nie zostały jeszcze opublikowane (zwykle ok. 14:00 dnia poprzedniego).'));
    const grid = dayGrid(date, Q);
    const n = grid.starts.length;
    const v = new Array(n).fill(null);
    for (const r of rows) {
      const i = grid.index.get(utc(r.dtime_utc) - Q);
      if (i != null) v[i] = r.rce_pln;
    }
    const idx = v.map((x, i) => i).filter((i) => v[i] != null);
    const min = idx.reduce((a, i) => (v[i] < v[a] ? i : a), idx[0]);
    const max = idx.reduce((a, i) => (v[i] > v[a] ? i : a), idx[0]);
    const avg = idx.reduce((s, i) => s + v[i], 0) / idx.length;
    const kwh = (x) => `${fmt2.format(x / 1000)} zł/kWh`;
    const ni = date === todayIso() ? nowIndex(grid) : -1;
    const tiles = [
      ni >= 0 && v[ni] != null ? { l: `Teraz (${period(grid, ni)})`, v: `${fmt2.format(v[ni])} zł/MWh`, d: kwh(v[ni]) } : null,
      { l: 'Średnia doby', v: `${fmt2.format(avg)} zł/MWh`, d: kwh(avg) },
      { l: 'Najtaniej', v: `${fmt2.format(v[min])} zł/MWh`, d: period(grid, min) },
      { l: 'Najdrożej', v: `${fmt2.format(v[max])} zł/MWh`, d: period(grid, max) },
    ].filter(Boolean);
    const series = [{ name: 'RCE', color: 'var(--s1)', values: v }];
    box.innerHTML = tilesHtml(tiles) + '<div class="chart" id="rce-chart"></div>' +
      table(['Okres', 'RCE [zł/MWh]', 'zł/kWh'], grid.starts.map((_, i) => [period(grid, i), v[i] == null ? '—' : fmt2.format(v[i]), v[i] == null ? '—' : fmt2.format(v[i] / 1000)]));
    drawChart('rce', $('#rce-chart'), {
      n, series, step: true, area: true, xTicks: xTicks(grid), label: 'Rynkowa cena energii (RCE) w kwadransach',
      nowIndex: ni >= 0 ? ni : null,
      tooltip: (i) => tipRows(period(grid, i), [{ name: 'RCE', color: 'var(--s1)', value: v[i] == null ? '—' : `${fmt2.format(v[i])} zł/MWh` }, { name: '', value: v[i] == null ? '' : kwh(v[i]) }]),
    });
    run.restore();
  } catch (e) {
    if (run.stale()) return;
    box.innerHTML = errorBox(e);
  }
}

// ---------- RCEm (RCEm.json) ----------
async function renderRcem() {
  const box = $('#rcem-body');
  try {
    const d = await file('RCEm.json');
    const years = d.lata.slice().sort((a, b) => b.rok - a.rok).slice(0, 3).reverse();
    const colors = ['var(--s3)', 'var(--s2)', 'var(--s1)']; // najnowszy rok = slot 1
    const series = years.map((y, k) => {
      const values = new Array(12).fill(null);
      y.miesiace.forEach((m) => (values[m.miesiac - 1] = Number(m.cena)));
      return { name: String(y.rok), color: colors[3 - years.length + k], values };
    });
    const latest = series[series.length - 1];
    const lastM = latest.values.reduce((k, v, i) => (v != null ? i : k), -1);
    const tiles = lastM >= 0 ? [{ l: `RCEm ${MONTHS[lastM]} ${latest.name}`, v: `${fmt2.format(latest.values[lastM])} zł/MWh`, d: `${fmt2.format(latest.values[lastM] / 1000)} zł/kWh` }] : [];
    box.innerHTML = tilesHtml(tiles) + '<div class="chart" id="rcem-chart"></div>' +
      table(['Miesiąc', ...series.map((s) => s.name)], MONTHS.map((m, i) => [m, ...series.map((s) => (s.values[i] == null ? '—' : fmt2.format(s.values[i])))])) +
      `<p class="note">Aktualizacja pliku: ${esc(d.timestamp)}</p>`;
    drawChart('rcem', $('#rcem-chart'), {
      n: 12, series, markers: true, minSpan: 3, xTicks: MONTHS.map((label, i) => ({ i, label, at: 'center' })), label: 'Miesięczna rynkowa cena energii RCEm',
      tooltip: (i, on) => tipRows(MONTHS[i], series.slice().reverse().filter((s) => on(s.name)).map((s) => ({ name: s.name, color: s.color, value: s.values[i] == null ? '—' : `${fmt2.format(s.values[i])} zł/MWh` }))),
    }, 'rcem');
  } catch (e) {
    box.innerHTML = errorBox(e);
  }
}

// ---------- Obciążenie połączeń transgranicznych ----------
// Punkty odniesienia (100%) dla przepływu na granicy; każdy zwraca {KRAJ: {exp, imp}} w MW (null = brak danych).
// Kolejne źródła (np. zdolności z JAO) dodaje się jako nowy wpis w FLOW_REFS.
// Moc techniczna: tylko wartości potwierdzone w źródłach. Połączenia AC (DE, CZ, SK, UA, LT po synchronizacji
// w 2025 r.) nie mają jednej stałej przepustowości — dopuszczalny przepływ zależy od stanu sieci — więc na razie null.
const TECH_CAPACITY = {
  SE: { exp: 600, imp: 600, src: 'SwePol Link, HVDC 450 kV, moc znamionowa 600 MW (URE)' },
  DE: null,
  CZ: null,
  SK: null,
  UA: null,
  LT: null,
};

let histPromise;
function loadHistMax() {
  // Największy przepływ w każdym kierunku z ostatnich 12 miesięcy (PSE przeplywy-mocy): PL-XX < 0 = eksport, XX-PL > 0 = import.
  if (histPromise) return histPromise;
  const from = addDays(todayIso(), -365);
  const key = `histmax|${todayIso()}`;
  try {
    const c = JSON.parse(localStorage.getItem('histmax') || 'null');
    if (c && c.key === key) return (histPromise = Promise.resolve(c.data));
  } catch { /* brak localStorage */ }
  const one = (sc, dir) =>
    fetch(`${PSE_HOSTS[0]}/przeplywy-mocy?$filter=${encodeURIComponent(`section_code eq '${sc}' and business_date ge '${from}'`)}&$orderby=value ${dir}&$first=1`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j) => (j.value && j.value[0] ? { v: Math.abs(j.value[0].value), t: j.value[0].dtime } : null));
  histPromise = Promise.all(
    Object.keys(COUNTRIES).map(async (id) => {
      const [e, i] = await Promise.all([one(`PL-${id}`, 'asc'), one(`${id}-PL`, 'desc')]);
      return [id, { exp: e && e.v > 0 ? e.v : null, imp: i && i.v > 0 ? i.v : null, src: `maks. z 12 mies. — eksport ${e ? `${fmt0.format(e.v)} MW (${e.t.slice(0, 16)})` : '—'}, import ${i ? `${fmt0.format(i.v)} MW (${i.t.slice(0, 16)})` : '—'}` }];
    }),
  ).then((entries) => {
    const data = Object.fromEntries(entries);
    try { localStorage.setItem('histmax', JSON.stringify({ key, data })); } catch { /* j.w. */ }
    return data;
  });
  histPromise.catch(() => (histPromise = null));
  return histPromise;
}

const FLOW_REFS = {
  mw: { label: 'MW', title: 'Przepływy w MW' },
  tech: { label: '% mocy technicznej', title: 'Obciążenie względem mocy znamionowej połączenia', load: async () => TECH_CAPACITY },
  hist: { label: '% maks. historycznego', title: 'Obciążenie względem największego przepływu z ostatnich 12 miesięcy', load: loadHistMax },
};
let flowRef = 'mw';
try { flowRef = FLOW_REFS[localStorage.getItem('flowRef')] ? localStorage.getItem('flowRef') : 'mw'; } catch { /* j.w. */ }
let lastNow = null;

// ---------- Bieżący bilans (przesyly.json) ----------
async function renderNow() {
  const box = $('#now-body');
  try {
    lastNow = await file('przesyly.json');
    await drawNow();
  } catch (e) {
    box.innerHTML = errorBox(e);
  }
}

async function drawNow() {
  const box = $('#now-body');
  const j = lastNow;
  let refs = null;
  let refErr = null;
  if (FLOW_REFS[flowRef].load) {
    try { refs = await FLOW_REFS[flowRef].load(); } catch (e) { refErr = e; }
  }
  {
    const p = j.data.podsumowanie;
    const flows = j.data.przesyly;
    const saldo = flows.reduce((s, f) => s + f.wartosc, 0);
    const ts = new Date(j.timestamp);
    $('#now-time').textContent = `stan na ${fTime.format(ts)}`;
    const st = j.data.status_pse_w_platformach_bilansujacych || {};
    const tiles = [
      { l: 'Zapotrzebowanie', v: mw(p.zapotrzebowanie), d: '' },
      { l: 'Generacja', v: mw(p.generacja), d: '' },
      { l: saldo < 0 ? 'Saldo wymiany: eksport' : 'Saldo wymiany: import', v: mw(Math.abs(saldo)), d: 'suma przepływów fizycznych' },
      { l: 'Częstotliwość', v: `${String(p.czestotliwosc).replace('.', ',')} Hz`, d: `odchyłka ${p.czestotliwosc >= 50 ? '+' : '−'}${fmt0.format(Math.abs(p.czestotliwosc - 50) * 1000)} mHz` },
    ];

    // Wymiana międzynarodowa: wykres rozbieżny, eksport w lewo, import w prawo.
    // Tryb MW: skala do największego przepływu; tryby %: skala 0–100% obciążenia w kierunku przepływu.
    const pctMode = !!refs;
    const refFor = (id, v) => { const r = refs && refs[id]; return r ? (v < 0 ? r.exp : r.imp) : null; };
    const loadOf = (id, v) => { const ref = refFor(id, v); return ref ? (Math.abs(v) / ref) * 100 : null; };
    const maxAbs = Math.max(1, ...flows.flatMap((f) => [Math.abs(f.wartosc), Math.abs(f.wartosc_plan)]));
    const half = (id, v) => (pctMode ? Math.min(100, loadOf(id, v) ?? 0) / 2 : (Math.abs(v) / maxAbs) * 50);
    const pctTxt = (x) => (x == null ? '' : ` · <b>${fmt0.format(x)}%</b>${x >= 90 ? ' <span class="warn" title="Obciążenie ≥ 90%">▲ wysokie</span>' : ''}`);
    const flowRows = flows
      .slice()
      .sort((a, b) => a.wartosc - b.wartosc)
      .map((f) => {
        const imp = f.wartosc >= 0;
        const load = pctMode ? loadOf(f.id, f.wartosc) : null;
        const noRef = pctMode && load == null;
        const bar = noRef ? '' : `<span class="fbar ${imp ? 'imp' : 'exp'}${load > 100 ? ' over' : ''}" style="${imp ? 'left:50%' : `right:50%`};width:${half(f.id, f.wartosc)}%"></span>`;
        const planPos = pctMode ? (loadOf(f.id, f.wartosc_plan) == null ? null : Math.sign(f.wartosc_plan) * Math.min(102, loadOf(f.id, f.wartosc_plan)) / 2) : (f.wartosc_plan / maxAbs) * 50;
        const plan = planPos == null ? '' : `<span class="fplan" style="left:${50 + planPos}%" title="Plan: ${fmt0.format(f.wartosc_plan)} MW"></span>`;
        const txt = `${imp ? 'import' : 'eksport'} <b>${fmt0.format(Math.abs(f.wartosc))} MW</b>${pctTxt(load)} <span class="muted">plan ${f.wartosc_plan >= 0 ? 'import' : 'eksport'} ${fmt0.format(Math.abs(f.wartosc_plan))}</span>${noRef ? ' <span class="muted">· brak danych o punkcie odniesienia</span>' : ''}`;
        return `<div class="frow" data-id="${esc(f.id)}" data-tip="${esc(`${COUNTRIES[f.id] || f.id}|${f.wartosc}|${f.wartosc_plan}|${f.rownolegly}`)}">
          <div class="fname">${COUNTRIES[f.id] || f.id}${f.rownolegly ? '<sup title="Profil synchroniczny (DE+CZ+SK) — handel odbywa się łącznie na tym przekroju">*</sup>' : ''}</div>
          <div class="ftrack${pctMode ? ' pct' : ''}">${bar}${plan}<span class="fzero"></span></div>
          <div class="fval">${txt}</div></div>`;
      })
      .join('');
    const refCtl = `<div class="seg" role="group" aria-label="Skala obciążenia połączeń">${Object.entries(FLOW_REFS)
      .map(([k, r]) => `<button type="button" data-ref="${k}" title="${r.title}" aria-pressed="${k === flowRef}"${k === flowRef ? ' class="on"' : ''}>${r.label}</button>`)
      .join('')}</div>`;
    const refNote = refErr
      ? `<p class="note error-note">Nie udało się pobrać punktu odniesienia (${esc(refErr.message || refErr)}).</p>`
      : flowRef === 'tech'
        ? '<p class="note">100% = moc znamionowa połączenia. Dane potwierdzone tylko dla Szwecji (SwePol, 600 MW); połączenia prądu przemiennego (DE, CZ, SK, UA, LT) nie mają jednej stałej przepustowości — wartości do uzupełnienia w <code>TECH_CAPACITY</code>.</p>'
        : flowRef === 'hist'
          ? '<p class="note">100% = największy przepływ w danym kierunku w ostatnich 12 miesiącach (PSE, przeplywy-mocy). To nie jest fizyczna granica linii, lecz miara „jak blisko rekordu”. Skala: znaczniki co 50%.</p>'
          : '';

    // Aktualna struktura generacji (z podsumowania).
    const mix = [
      { n: 'Cieplne (węgiel, gaz, biomasa)', v: p.cieplne },
      { n: 'Słońce (PV)', v: p.PV },
      { n: 'Wiatr lądowy', v: p.ladowewiatrowe },
      { n: 'Wiatr morski', v: p.morskiewiatrowe },
      { n: 'Woda', v: p.wodne },
      { n: 'Inne', v: p.inne },
    ].sort((a, b) => b.v - a.v);
    const mixMax = Math.max(...mix.map((m) => m.v), 1);
    const mixRows = mix
      .map((m) => `<div class="mrow"><div class="mname">${m.n}</div><div class="mtrack"><span class="mbar" style="width:${(m.v / mixMax) * 100}%"></span></div><div class="mval">${fmt0.format(m.v)} MW <span class="muted">${fmt0.format((m.v / p.generacja) * 100)}%</span></div></div>`)
      .join('');
    const status = (v) => (v === 1 ? '<span class="ok">● aktywny</span>' : `<span class="off">○ nieaktywny (${esc(v)})</span>`);

    box.innerHTML = staleNote({ what: 'bieżące (plik aplikacji)', at: ts.getTime(), maxMinutes: 20 }) + `${tilesHtml(tiles)}
      <div class="grid2">
        <div><h3>Wymiana międzynarodowa <span class="muted">(przepływy fizyczne)</span></h3>
          ${refCtl}
          <div class="legend"><span class="key"><i class="sw" style="background:var(--exp)"></i>eksport z Polski</span><span class="key"><i class="sw" style="background:var(--imp)"></i>import do Polski</span><span class="key"><i class="plan-key"></i>plan (wymiana handlowa)</span></div>
          <div class="flows">${flowRows}</div>
          ${refNote}
          <p class="note">* profil synchroniczny DE+CZ+SK.</p></div>
        <div><h3>Aktualna struktura generacji</h3><div class="mix">${mixRows}</div>
          <p class="note">Platformy bilansujące — IGCC: ${status(st.IGCC_status)} · CMO: ${status(st.CMO_status)}</p></div>
      </div>`;
    box.querySelectorAll('.seg button').forEach((b) =>
      b.addEventListener('click', () => {
        flowRef = b.dataset.ref;
        try { localStorage.setItem('flowRef', flowRef); } catch { /* j.w. */ }
        drawNow();
      }),
    );
    box.querySelectorAll('.frow').forEach((row) => {
      row.addEventListener('pointermove', (e) => {
        const [name, v, plan] = row.dataset.tip.split('|');
        const id = row.dataset.id;
        const r = refs && refs[id];
        const ref = refFor(id, +v);
        placeTip(tipRows(name, [
          { name: 'Rzeczywisty przepływ', color: +v >= 0 ? 'var(--imp)' : 'var(--exp)', value: `${+v >= 0 ? 'import' : 'eksport'} ${fmt0.format(Math.abs(v))} MW` },
          { name: 'Plan', value: `${+plan >= 0 ? 'import' : 'eksport'} ${fmt0.format(Math.abs(plan))} MW` },
          { name: 'Różnica', value: `${fmt0.format(v - plan)} MW` },
          ...(pctMode ? [
            { name: 'Obciążenie', value: ref ? `${fmt0.format((Math.abs(v) / ref) * 100)}% z ${fmt0.format(ref)} MW` : 'brak danych' },
            ...(r && r.src ? [{ name: r.src, value: '' }] : []),
          ] : []),
        ]), e.clientX, e.clientY);
      });
      row.addEventListener('pointerleave', hideTip);
    });
  }
}



// ---------- Ceny energii: RDN i rynek bilansujący (energy-prices, price-fcst, sk) ----------
// Oznaczenia jak w raporcie PSE „Ceny energii na RB”: CSDAC – cena z jednolitego łączenia rynków dnia następnego (RDN),
// CEN – cena energii niezbilansowania, CEB – cena energii bilansującej (pole ceb_pp_cost, jak w raporcie PSE),
// COR – składnik ceny za rezerwę operacyjną, EN – energia niezbilansowania, SK – stan kontraktacji [MWh w kwadransie].
async function renderPrices({ silent = false } = {}) {
  const box = $('#prices-body');
  const run = begin(box, silent);
  try {
    const [ep, pf, sk] = await Promise.all([
      pseDay('energy-prices', 500),
      pseDay('price-fcst', 500).catch(() => []),
      pseDay('sk', 500).catch(() => []),
    ]);
    if (run.stale()) return;
    if (!ep.length && !pf.length) return void (box.innerHTML = empty('Brak danych o cenach dla wybranego dnia.'));
    const grid = dayGrid(date, Q);
    const n = grid.starts.length;
    const arr = () => new Array(n).fill(null);
    const [rdn, cen, ceb, cor, en, skv, cenF, corF, imbF, skD, skD1] = Array.from({ length: 11 }, arr);
    const at = (r) => grid.index.get(utc(r.dtime_utc) - Q);
    for (const r of ep) {
      const i = at(r);
      if (i == null) continue;
      [rdn[i], cen[i], ceb[i], cor[i], en[i], skv[i]] = [r.csdac_pln, r.cen_cost, r.ceb_pp_cost, r.cor_cost, r.balance, r.sk_cost];
    }
    for (const r of pf) {
      const i = at(r);
      if (i != null) [cenF[i], corF[i], imbF[i]] = [r.cen_fcst, r.cor_fcst, r.imb_energy];
    }
    for (const r of sk) {
      const i = at(r);
      if (i == null) continue;
      [skD[i], skD1[i]] = [r.sk_d_fcst, r.sk_d1_fcst];
      if (skv[i] == null) skv[i] = r.sk_cost;
    }
    // Tam, gdzie nie ma jeszcze wartości rozliczeniowych, pokazujemy bieżące (wstępne) wartości PSE jako osobne serie.
    const pre = (fin, fc) => fin.map((v, i) => (v == null ? fc[i] : null));
    const cenPre = pre(cen, cenF);
    const enPre = pre(en, imbF);
    const corAll = cor.map((v, i) => v ?? corF[i]);
    const has = (a) => a.some((v) => v != null);
    const series = [
      { name: 'RDN (CSDAC)', color: 'var(--s1)', values: rdn },
      { name: 'CEN — cena niezbilansowania', color: 'var(--s8)', values: cen },
      has(cenPre) && { name: 'CEN wstępna (bieżąca PSE)', color: 'var(--s5)', values: cenPre },
      has(ceb) && { name: 'CEB — cena energii bilansującej', color: 'var(--s2)', values: ceb },
      { name: 'COR — rezerwa operacyjna', color: 'var(--s7)', values: corAll },
    ].filter((s) => s && has(s.values));
    const vol = [
      { name: 'EN — energia niezbilansowania', color: 'var(--s8)', values: en },
      has(enPre) && { name: 'EN wstępna (bieżąca PSE)', color: 'var(--s5)', values: enPre },
      { name: 'SK — stan kontraktacji', color: 'var(--s1)', values: skv },
      { name: 'SK — prognoza D', color: 'var(--s3)', values: skD },
      { name: 'SK — prognoza D-1', color: 'var(--s4)', values: skD1 },
    ].filter((s) => s && has(s.values));

    const zl = (v) => (v == null ? '—' : `${fmt2.format(v)} zł/MWh`);
    const mwh = (v) => (v == null ? '—' : `${v >= 0 ? '+' : '−'}${fmt0.format(Math.abs(v))} MWh`);
    const idx = (a) => a.map((v, i) => i).filter((i) => a[i] != null);
    const avg = (a) => { const ii = idx(a); return ii.length ? ii.reduce((s, i) => s + a[i], 0) / ii.length : null; };
    const cenBest = has(cen) ? cen : cenPre;
    const iMax = idx(cenBest).reduce((a, i) => (a == null || cenBest[i] > cenBest[a] ? i : a), null);
    const both = idx(cenBest).filter((i) => rdn[i] != null);
    const spread = both.length ? both.reduce((s, i) => s + (cenBest[i] - rdn[i]), 0) / both.length : null;
    const enBest = en.map((v, i) => v ?? enPre[i]);
    const enIdx = idx(enBest);
    const shortQ = enIdx.filter((i) => enBest[i] < 0).length;
    const tiles = [
      { l: 'Średnia cena RDN', v: zl(avg(rdn)), d: 'CSDAC, polska strefa' },
      { l: has(cen) ? 'Średnia CEN' : 'Średnia CEN (wstępna)', v: zl(avg(cenBest)), d: spread == null ? '' : `średnio ${spread >= 0 ? '+' : '−'}${fmt2.format(Math.abs(spread))} zł/MWh względem RDN` },
      iMax != null && { l: 'Najwyższa CEN', v: zl(cenBest[iMax]), d: period(grid, iMax) },
      enIdx.length && { l: 'System krótki (niedobór energii)', v: `${fmt0.format((shortQ / enIdx.length) * 100)}% kwadransów`, d: `${shortQ} z ${enIdx.length}` },
    ].filter(Boolean);
    const status = has(cen) ? '' : '<p class="note">Wartości rozliczeniowe PSE publikuje z 1–2-dniowym opóźnieniem; do tego czasu pokazujemy bieżące, wstępne wartości CEN i EN.</p>';
    box.innerHTML = tilesHtml(tiles) + status +
      '<div class="chart" id="prices-chart"></div>' +
      '<h3 class="sub-h">Niezbilansowanie i stan kontraktacji systemu <span class="muted">[MWh w kwadransie]</span></h3>' +
      '<div class="chart" id="imb-chart"></div>' +
      table(['Okres', 'RDN', 'CEN', 'CEN wstępna', 'CEB', 'COR', 'EN [MWh]', 'SK [MWh]', 'SK D [MWh]', 'SK D-1 [MWh]'],
        grid.starts.map((_, i) => [period(grid, i), ...[rdn[i], cen[i], cenPre[i], ceb[i], corAll[i]].map((v) => (v == null ? '—' : fmt2.format(v))), ...[enBest[i], skv[i], skD[i], skD1[i]].map((v) => (v == null ? '—' : fmt2.format(v)))])) +
      '<p class="note">Ujemne EN/SK = system „krótki” (w kontraktach brakuje energii, PSE musi ją dokupić), dodatnie = „długi”. Oznaczenia jak w raporcie PSE „Ceny energii na Rynku Bilansującym”.</p>';
    const now = date === todayIso() ? nowIndex(grid) : null;
    drawChart('prices', $('#prices-chart'), {
      n, series, step: true, xTicks: xTicks(grid), height: 280, label: 'Ceny energii: RDN i rynek bilansujący', nowIndex: now,
      yFmt: (v) => fmt0.format(v),
      tooltip: (i, on) => tipRows(period(grid, i), series.filter((s) => on(s.name)).map((s) => ({ name: s.name, color: s.color, value: zl(s.values[i]) }))),
    });
    drawChart('imb', $('#imb-chart'), {
      n, series: vol, xTicks: xTicks(grid), height: 220, label: 'Energia niezbilansowania i stan kontraktacji', nowIndex: now,
      yFmt: (v) => (v > 0 ? '+' : v < 0 ? '−' : '') + fmt0.format(Math.abs(v)),
      tooltip: (i, on) => tipRows(period(grid, i), vol.filter((s) => on(s.name)).map((s) => ({ name: s.name, color: s.color, value: s.values[i] == null ? '—' : `${mwh(s.values[i])} · ${s.values[i] < 0 ? 'krótki' : 'długi'}` }))),
    });
    run.restore();
  } catch (e) {
    if (run.stale()) return;
    box.innerHTML = errorBox(e);
  }
}

// ---------- Redukcje generacji OZE poleceniem PSE (poze-redoze) ----------
async function renderCurt({ silent = false } = {}) {
  const box = $('#curt-body');
  const run = begin(box, silent);
  try {
    const rows = await pseDay('poze-redoze', 500);
    if (run.stale()) return;
    if (!rows.length) return void (box.innerHTML = empty('Brak danych o redukcjach dla wybranego dnia.'));
    const grid = dayGrid(date, Q);
    const n = grid.starts.length;
    const defs = [
      ['pv_red_balance', 'PV — względy bilansowe', 'var(--g-pv)'],
      ['pv_red_network', 'PV — względy sieciowe', 'var(--s2)'],
      ['wi_red_balance', 'Wiatr — względy bilansowe', 'var(--g-wl)'],
      ['wi_red_network', 'Wiatr — względy sieciowe', 'var(--g-wm)'],
    ];
    const series = defs.map(([, name, color]) => ({ name, color, values: new Array(n).fill(null) }));
    for (const r of rows) {
      const i = grid.index.get(utc(r.dtime_utc) - Q);
      if (i != null) defs.forEach(([f], k) => (series[k].values[i] = Math.abs(r[f] || 0)));
    }
    const energy = series.map((s) => s.values.reduce((a, v) => a + (v || 0), 0) / 4);
    const tot = series[0].values.map((_, i) => series.reduce((a, s) => a + (s.values[i] || 0), 0));
    const iMax = tot.reduce((a, v, i) => (v > tot[a] ? i : a), 0);
    const pvE = energy[0] + energy[1];
    const wiE = energy[2] + energy[3];
    const tiles = [
      { l: 'Ograniczona energia PV', v: `${fmt0.format(pvE)} MWh`, d: `bilansowo ${fmt0.format(energy[0])} · sieciowo ${fmt0.format(energy[1])}` },
      { l: 'Ograniczona energia wiatru', v: `${fmt0.format(wiE)} MWh`, d: `bilansowo ${fmt0.format(energy[2])} · sieciowo ${fmt0.format(energy[3])}` },
      { l: 'Największa łączna redukcja', v: mw(tot[iMax]), d: tot[iMax] > 0 ? period(grid, iMax) : 'brak redukcji' },
    ];
    box.innerHTML = tilesHtml(tiles) + '<div class="chart" id="curt-chart"></div>' +
      table(['Okres', ...defs.map((d) => d[1] + ' [MW]')], grid.starts.map((_, i) => [period(grid, i), ...series.map((s) => (s.values[i] == null ? '—' : fmt0.format(s.values[i])))])) +
      '<p class="note">Nierynkowe redysponowanie: moc, o jaką PSE poleciły zmniejszyć generację źródeł PV i wiatrowych — ze względów bilansowych (nadpodaż energii w systemie) lub sieciowych (ograniczenia przesyłu).</p>';
    drawChart('curt', $('#curt-chart'), {
      n, series, stacked: true, xTicks: xTicks(grid), height: 240, label: 'Redukcje generacji OZE', nowIndex: date === todayIso() ? nowIndex(grid) : null,
      tooltip: (i, on) => tipRows(period(grid, i), [...series.filter((s) => on(s.name)).map((s) => ({ name: s.name, color: s.color, value: mw(s.values[i]) })), { name: 'Razem', value: mw(tot[i]) }]),
    });
    run.restore();
  } catch (e) {
    if (run.stale()) return;
    box.innerHTML = errorBox(e);
  }
}

// ---------- Praca dużych elektrowni (gen-jw: jednostki wytwórcze centralnie dysponowane) ----------
async function renderUnits({ silent = false } = {}) {
  const box = $('#units-body');
  const run = begin(box, silent);
  try {
    const rows = await pseDay('gen-jw', 50000);
    if (run.stale()) return;
    if (!rows.length) return void (box.innerHTML = empty('Brak danych o pracy elektrowni dla wybranego dnia (PSE publikuje je zwykle po zakończeniu doby).'));
    const grid = dayGrid(date, Q);
    const n = grid.starts.length;
    const plants = new Map();
    for (const r of rows) {
      const i = grid.index.get(utc(r.dtime_utc) - Q);
      if (i == null || r.value == null) continue;
      if (!plants.has(r.power_plant)) plants.set(r.power_plant, { name: r.power_plant, net: new Array(n).fill(null), gen: 0, pump: 0, units: new Set() });
      const p = plants.get(r.power_plant);
      p.units.add(r.resource_code);
      p.net[i] = (p.net[i] || 0) + r.value;
      if (r.value >= 0) p.gen += r.value / 4;
      else p.pump += -r.value / 4;
    }
    const list = [...plants.values()].map((p) => ({ ...p, max: Math.max(...p.net.filter((v) => v != null)), avg: p.net.filter((v) => v != null).reduce((a, v) => a + v, 0) / Math.max(1, p.net.filter((v) => v != null).length) })).sort((a, b) => b.gen - a.gen);
    const total = list.reduce((a, p) => a + p.gen, 0);
    const colors = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--s6)', 'var(--s7)', 'var(--s8)'];
    const series = list.slice(0, 8).map((p, k) => ({ name: p.name, color: colors[k], values: p.net }));
    const eMax = list[0]?.gen || 1;
    const rowHtml = (p) => `<div class="mrow"><div class="mname">${esc(p.name)} <span class="muted">· ${p.units.size} ${plural(p.units.size, ['blok', 'bloki', 'bloków'])}</span></div><div class="mtrack"><span class="mbar" style="width:${(p.gen / eMax) * 100}%"></span></div><div class="mval">${fmt2.format(p.gen / 1000)} GWh <span class="muted">śr. ${fmt0.format(p.avg)} · maks. ${fmt0.format(p.max)} MW${p.pump ? ` · pompowanie ${fmt0.format(p.pump)} MWh` : ''}</span></div></div>`;
    box.innerHTML = tilesHtml([
      { l: 'Energia z dużych elektrowni', v: `${fmt0.format(total / 1000)} GWh`, d: (() => { const u = list.reduce((a, p) => a + p.units.size, 0); return `${list.length} ${plural(list.length, ['elektrownia', 'elektrownie', 'elektrowni'])}, ${u} ${plural(u, ['jednostka', 'jednostki', 'jednostek'])}`; })() },
      { l: 'Największa', v: esc(list[0].name), d: `${fmt0.format((list[0].gen / total) * 100)}% tej energii` },
    ]) +
      '<div class="chart" id="units-chart"></div>' +
      `<h3 class="sub-h">Ranking elektrowni — energia w dobie</h3><div class="mix">${list.slice(0, 12).map(rowHtml).join('')}</div>` +
      (list.length > 12 ? `<details class="table-view"><summary>Pozostałe elektrownie (${list.length - 12})</summary><div class="mix" style="margin-top:8px">${list.slice(12).map(rowHtml).join('')}</div></details>` : '') +
      '<p class="note">Jednostki wytwórcze centralnie dysponowane (JWCD) — duże bloki sterowane przez PSE; bez małych źródeł, wiatru i PV. Na wykresie 8 elektrowni o największej produkcji; ujemne wartości to pompowanie w elektrowniach szczytowo-pompowych.</p>';
    drawChart('units', $('#units-chart'), {
      n, series, xTicks: xTicks(grid), height: 280, label: 'Moc największych elektrowni', nowIndex: date === todayIso() ? nowIndex(grid) : null,
      tooltip: (i, on) => tipRows(period(grid, i), series.filter((s) => on(s.name)).map((s) => ({ name: s.name, color: s.color, value: mw(s.values[i]) }))),
    });
    run.restore();
  } catch (e) {
    if (run.stale()) return;
    box.innerHTML = errorBox(e);
  }
}

// ---------- Prognoza PSE na 7 dni (pk5l-wp) ----------
function rangeGrid(isoFrom, days, step) {
  const a = midnight(isoFrom);
  const b = midnight(addDays(isoFrom, days));
  const starts = [];
  for (let t = a; t < b; t += step) starts.push(t);
  return { starts, index: new Map(starts.map((t, i) => [t, i])), step };
}
const fDayShort = new Intl.DateTimeFormat('pl-PL', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'numeric' });
function multiDayTicks(grid) {
  const hm = grid.starts.map((t) => fTime.format(t));
  return (v0, v1) => {
    const hours = ((v1 - v0) * grid.step) / HOUR;
    const every = hours > 96 ? 24 : hours > 48 ? 12 : hours > 24 ? 6 : hours > 12 ? 3 : 1;
    const out = [];
    for (let i = Math.max(0, Math.floor(v0)); i <= Math.min(hm.length - 1, Math.ceil(v1)); i++) {
      const [h, mi] = hm[i].split(':').map(Number);
      if (mi !== 0 || h % every) continue;
      out.push({ i, label: h === 0 ? fDayShort.format(grid.starts[i]) : hm[i] });
    }
    return out;
  };
}
const periodLong = (grid, i) => `${fDayShort.format(grid.starts[i])}, ${fTime.format(grid.starts[i])}–${fTime.format(grid.starts[i] + grid.step)}`;

let planDays = 7;
try { planDays = +(localStorage.getItem('planDays') ?? 7) || 7; } catch { /* brak localStorage */ }
async function renderPlan({ silent = false } = {}) {
  const box = $('#plan-body');
  const run = begin(box, silent);
  try {
    const days = planDays;
    const to = addDays(date, days - 1);
    const rows = await pseMemo('pk5l-wp', `business_date ge '${date}' and business_date le '${to}'`, 3000);
    if (run.stale()) return;
    if (!rows.length) return void (box.innerHTML = empty('Brak prognozy dla wybranego okresu.'));
    const grid = rangeGrid(date, days, HOUR);
    const n = grid.starts.length;
    const f = (k) => {
      const a = new Array(n).fill(null);
      for (const r of rows) {
        const i = grid.index.get(utc(r.plan_dtime_utc) - HOUR);
        if (i != null) a[i] = r[k];
      }
      return a;
    };
    const dem = f('grid_demand_fcst');
    const wi = f('fcst_wi_tot_gen');
    const pv = f('fcst_pv_tot_gen');
    const surplus = f('gen_surplus_avail_tso_above');
    const req = f('req_pow_res');
    const avail = f('surplus_cap_avail_tso');
    const s1 = [
      { name: 'Zapotrzebowanie (prognoza)', color: 'var(--ink-2)', values: dem },
      { name: 'Wiatr (prognoza)', color: 'var(--g-wl)', values: wi },
      { name: 'Słońce PV (prognoza)', color: 'var(--g-pv)', values: pv },
    ];
    const s2 = [
      { name: 'Nadwyżka mocy ponad wymaganą rezerwę', color: 'var(--s1)', values: surplus },
      { name: 'Nadwyżka mocy dostępna dla PSE', color: 'var(--s3)', values: avail },
      { name: 'Wymagana rezerwa mocy', color: 'var(--s8)', values: req },
    ];
    const ii = surplus.map((v, i) => i).filter((i) => surplus[i] != null);
    const iMin = ii.reduce((a, i) => (a == null || surplus[i] < surplus[a] ? i : a), null);
    const iPv = pv.reduce((a, v, i) => (v != null && (a == null || v > pv[a]) ? i : a), null);
    const iWi = wi.reduce((a, v, i) => (v != null && (a == null || v > wi[a]) ? i : a), null);
    const seg = `<div class="seg" role="group" aria-label="Horyzont prognozy">${[7, 14, 31].map((d) => `<button type="button" data-d="${d}" class="${d === days ? 'on' : ''}">${d} dni</button>`).join('')}</div>`;
    box.innerHTML = seg + tilesHtml([
      iMin != null && { l: 'Najmniejsza nadwyżka ponad rezerwę', v: mw(surplus[iMin]), d: periodLong(grid, iMin) },
      iPv != null && { l: 'Szczyt PV (prognoza)', v: mw(pv[iPv]), d: periodLong(grid, iPv) },
      iWi != null && { l: 'Szczyt wiatru (prognoza)', v: mw(wi[iWi]), d: periodLong(grid, iWi) },
    ].filter(Boolean)) +
      '<div class="chart" id="plan-chart"></div>' +
      '<h3 class="sub-h">Zapas mocy w systemie</h3><div class="chart" id="plan-res-chart"></div>' +
      table(['Godzina', 'Zapotrzebowanie', 'Wiatr', 'PV', 'Nadwyżka ponad rezerwę', 'Nadwyżka dla PSE', 'Wymagana rezerwa'], grid.starts.map((_, i) => [periodLong(grid, i), ...[dem, wi, pv, surplus, avail, req].map((a) => (a[i] == null ? '—' : fmt0.format(a[i])))])) +
      `<p class="note">Plan koordynacyjny PSE (wielkości podstawowe), godzinowo, od wybranego dnia na ${days} dni (im dalej, tym mniej pewna). Publikacja: ${esc(rows[0].publication_ts?.slice(0, 16) || '—')}.</p>`;
    const now = grid.starts.findIndex((t) => Date.now() >= t && Date.now() < t + HOUR);
    const common = { n, xTicks: multiDayTicks(grid), minSpan: 6, nowIndex: now >= 0 ? now : null };
    drawChart('plan', $('#plan-chart'), {
      ...common, series: s1, height: 260, label: `Prognoza zapotrzebowania, wiatru i PV na ${days} dni`,
      tooltip: (i, on) => tipRows(periodLong(grid, i), s1.filter((s) => on(s.name)).map((s) => ({ name: s.name, color: s.color, value: mw(s.values[i]) }))),
    }, 'plan');
    drawChart('plan-res', $('#plan-res-chart'), {
      ...common, series: s2, height: 220, label: `Prognozowany zapas mocy na ${days} dni`,
      tooltip: (i, on) => tipRows(periodLong(grid, i), s2.filter((s) => on(s.name)).map((s) => ({ name: s.name, color: s.color, value: mw(s.values[i]) }))),
    }, 'plan');
    box.querySelector('.seg').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-d]');
      if (!b || +b.dataset.d === planDays) return;
      planDays = +b.dataset.d;
      try { localStorage.setItem('planDays', planDays); } catch { /* j.w. */ }
      clearGroups('plan');
      renderPlan();
    });
    run.restore();
  } catch (e) {
    if (run.stale()) return;
    box.innerHTML = errorBox(e);
  }
}

// ---------- LOLP: prawdopodobieństwo niedoboru mocy (lolp) ----------
async function renderLolp({ silent = false } = {}) {
  const box = $('#lolp-body');
  const run = begin(box, silent);
  try {
    const rows = await pseDay('lolp', 500);
    if (run.stale()) return;
    if (!rows.length) return void (box.innerHTML = empty('Brak danych LOLP dla wybranego dnia.'));
    const grid = dayGrid(date, Q);
    const n = grid.starts.length;
    const ks = [4, 5, 6, 7, 8];
    const ramp = ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#104281'];
    const ref = rows[0];
    const series = ks.map((k, j) => ({ name: `rezerwa ${fmt0.format(ref['b' + k])} MW`, color: ramp[j], values: new Array(n).fill(null) }));
    for (const r of rows) {
      const i = grid.index.get(utc(r.dtime_utc) - Q);
      if (i != null) ks.forEach((k, j) => (series[j].values[i] = r['p' + k] == null ? null : r['p' + k] * 100));
    }
    const pct = (v) => (v == null ? '—' : `${fmt2.format(v)}%`);
    box.innerHTML = '<div class="chart" id="lolp-chart"></div>' +
      table(['Okres', ...series.map((s) => s.name)], grid.starts.map((_, i) => [period(grid, i), ...series.map((s) => pct(s.values[i]))])) +
      `<p class="note">LOLP (loss of load probability) — publikowane przez PSE prawdopodobieństwo niedoboru mocy, gdy w systemie pozostaje dana rezerwa. Parametr służy do wyceny rezerw (składnik COR w cenach rynku bilansującego); jest stały w okresach (${esc([...new Set(rows.map((r) => r.ojnz_id))].join(', '))}), publikacja: ${esc(ref.publication_ts?.slice(0, 10) || '—')}.</p>`;
    drawChart('lolp', $('#lolp-chart'), {
      n, series, xTicks: xTicks(grid), height: 240, label: 'Prawdopodobieństwo niedoboru mocy przy danej rezerwie', nowIndex: date === todayIso() ? nowIndex(grid) : null,
      yFmt: (v) => `${fmt0.format(v)}%`,
      tooltip: (i, on) => tipRows(period(grid, i), series.filter((s) => on(s.name)).map((s) => ({ name: s.name, color: s.color, value: pct(s.values[i]) }))),
    });
    run.restore();
  } catch (e) {
    if (run.stale()) return;
    box.innerHTML = errorBox(e);
  }
}

// ---------- Ceny uprawnień do emisji CO₂ (rcco2) — cała historia API PSE (od czerwca 2024), domyślnie ostatni rok ----------
let co2Range = 365;
try { co2Range = +(localStorage.getItem('co2Range') ?? 365); } catch { /* brak localStorage */ }
async function renderCo2() {
  const box = $('#co2-body');
  try {
    const rows = (await pse('rcco2', `business_date ge '2024-01-01'`, 3000)).sort((a, b) => (a.business_date < b.business_date ? -1 : 1));
    if (!rows.length) return void (box.innerHTML = empty('Brak danych.'));
    const n = rows.length;
    const eur = rows.map((r) => r.rcco2_eur);
    const last = rows[n - 1];
    // Zakres: ostatni rok albo całość (widok wspólny dla wykresu; tabela i kafelki dla całego okresu widoku).
    const setRange = (d) => { co2Range = d; views.set('co2', d && d < n ? [n - rows.filter((r) => r.business_date > addDays(last.business_date, -d)).length, n] : null); };
    setRange(co2Range);
    const inView = () => { const v = views.get('co2') || [0, n]; return rows.slice(v[0], v[1]); };
    const back = rows.find((r) => r.business_date >= addDays(last.business_date, -30)) || rows[0];
    const vr = inView();
    const mn = vr.reduce((a, r) => (r.rcco2_eur < a.rcco2_eur ? r : a));
    const mx = vr.reduce((a, r) => (r.rcco2_eur > a.rcco2_eur ? r : a));
    const ch = ((last.rcco2_eur - back.rcco2_eur) / back.rcco2_eur) * 100;
    const fD = (iso) => new Intl.DateTimeFormat('pl-PL', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso + 'T00:00:00Z'));
    const ticks = rows.map((r, i) => ({ r, i })).filter(({ r }, k) => k > 0 && r.business_date.slice(0, 7) !== rows[k - 1].business_date.slice(0, 7)).map(({ r, i }) => ({ i, label: MONTHS[+r.business_date.slice(5, 7) - 1] + (r.business_date.slice(5, 7) === '01' ? ` ${r.business_date.slice(0, 4)}` : '') }));
    const seg = `<div class="seg" role="group" aria-label="Zakres">${[[365, '12 miesięcy'], [0, `całość (od ${fD(rows[0].business_date)})`]].map(([d, l]) => `<button type="button" data-d="${d}" class="${d === co2Range ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    box.innerHTML = staleNote({ what: 'o cenach CO₂ (PSE)', asOf: last.business_date, maxDays: 5 }) + seg + tilesHtml([
      { l: `Ostatnia cena (${fD(last.business_date)})`, v: `${fmt2.format(last.rcco2_eur)} €/t`, d: `${fmt2.format(last.rcco2_pln)} zł/t` },
      { l: 'Zmiana w 30 dni', v: `${ch >= 0 ? '+' : '−'}${fmt0.format(Math.abs(ch))}%`, d: `od ${fmt2.format(back.rcco2_eur)} €/t` },
      { l: co2Range ? 'Zakres 12 miesięcy' : 'Zakres w całym okresie', v: `${fmt0.format(mn.rcco2_eur)}–${fmt0.format(mx.rcco2_eur)} €/t`, d: `min ${fD(mn.business_date)}, maks ${fD(mx.business_date)}` },
    ]) + '<div class="chart" id="co2-chart"></div>' +
      table(['Dzień', '€/t', 'zł/t'], rows.slice().reverse().map((r) => [r.business_date, fmt2.format(r.rcco2_eur), fmt2.format(r.rcco2_pln)])) +
      '<p class="note">Cena uprawnień do emisji CO₂ (EUA) publikowana przez PSE — koszt, który ponoszą elektrownie węglowe i gazowe za każdą tonę CO₂. Historia sięga czerwca 2024 (od tej daty dane udostępnia nowe API PSE).</p>';
    drawChart('co2', $('#co2-chart'), {
      n, series: [{ name: 'Cena EUA', color: 'var(--s1)', values: eur }], xTicks: ticks, area: true, zero: false, height: 240, minSpan: 7, label: 'Cena uprawnień do emisji CO₂',
      tooltip: (i) => tipRows(fD(rows[i].business_date), [{ name: 'EUR', color: 'var(--s1)', value: `${fmt2.format(rows[i].rcco2_eur)} €/t` }, { name: 'PLN', value: `${fmt2.format(rows[i].rcco2_pln)} zł/t` }]),
    }, 'co2');
    box.querySelector('.seg').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-d]');
      if (!b) return;
      try { localStorage.setItem('co2Range', b.dataset.d); } catch { /* j.w. */ }
      co2Range = +b.dataset.d;
      renderCo2();
    });
  } catch (e) {
    box.innerHTML = errorBox(e);
  }
}

// ---------- Alert ----------
async function renderAlert() {
  try {
    const a = await file('alert.json');
    const box = $('#alert');
    if (a.show) {
      box.innerHTML = `<b>${esc(a.title)}</b> ${esc(a.body)}`;
      box.hidden = false;
    } else box.hidden = true;
  } catch {
    /* alert jest opcjonalny */
  }
}

// ---------- Start ----------
function loadDay() {
  clearGroups('day', 'plan');
  memo.clear();
  renderKompas();
  renderLoad();
  renderBalance();
  renderUtil();
  renderPrices();
  renderCurt();
  renderUnits();
  renderPlan();
  renderLolp();
  renderGen();
  renderRce();
}

$('#prev').addEventListener('click', () => setDate(addDays(date, -1)));
$('#next').addEventListener('click', () => setDate(addDays(date, 1)));
$('#today').addEventListener('click', () => setDate(todayIso()));
$('#date').addEventListener('change', (e) => e.target.value && setDate(e.target.value));


initTheme();
initInstall();
initCountry();
renderAlert();
// Zakładki: dane dzienne ładujemy od razu (domyślny widok i odświeżanie), miesięczne i roczne — przy pierwszym otwarciu.
initTabs({
  d: () => { setDate(date); renderNow(); renderCo2(); },
  m: () => { renderRcem(); renderMix(); },
  r: () => { renderElecYear(); renderRenYear(); renderBills(); },
});

// Odświeżanie: bilans co minutę, dane doby co 5 minut (gdy oglądamy dziś).
setInterval(renderNow, 60e3);
setInterval(() => {
  if (date === todayIso()) {
    const silent = { silent: true };
    memo.clear();
    renderLoad(silent);
    renderBalance(silent);
    renderUtil(silent);
    renderPrices(silent);
    renderCurt(silent);
    renderUnits(silent);
    renderGen(silent);
    renderKompas(silent);
    renderRce(silent);
  }
}, 5 * 60e3);
