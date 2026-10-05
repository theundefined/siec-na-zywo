import { renderMix, renderBills, renderRenYear, renderElecYear } from './stats.js';
import { tipRows, placeTip, hideTip, fmt0, fmt2 } from './charts.js';
import { pse, FILES, TZ, HOUR, fKey, warsaw, todayIso, addDays, MONTHS, $, plural, esc, mw, errorBox, empty, table, tilesHtml, redraws, views, drawChart as drawChartC, initTheme, initInstall, initTabs, clearGroups, staleNote, initCountry } from './common.js';

// ---------- Źródła danych (te same co w aplikacji Energetyczny Kompas) ----------

// Dane wybranego zakresu dni. Pobieramy je porcjami po 7 dni wyrównanymi do stałego kalendarza (te same porcje
// dla różnych zakresów → pamięć podręczna działa przy przesuwaniu i rozszerzaniu zakresu), najwyżej 4 zapytania naraz.
// perDay — spodziewana liczba rekordów na dobę (limit $first dla porcji).
const memo = new Map();
const CHUNK = 7;
let pseActive = 0;
const pseWaiting = [];
async function pseQ(endpoint, filter, first) {
  if (pseActive >= 4) await new Promise((res) => pseWaiting.push(res));
  pseActive++;
  try { return await pse(endpoint, filter, first); } finally { pseActive--; pseWaiting.shift()?.(); }
}
const dayNum = (iso) => Math.floor(Date.parse(iso + 'T12:00:00Z') / 864e5);
const isoOf = (n) => new Date(n * 864e5 + 12 * 36e5).toISOString().slice(0, 10);
function chunksOf(a, b) {
  const out = [];
  for (let c = Math.floor(dayNum(a) / CHUNK) * CHUNK; c <= dayNum(b); c += CHUNK) out.push([isoOf(c), isoOf(c + CHUNK - 1)]);
  return out;
}
function pseDay(endpoint, perDay) {
  return Promise.all(chunksOf(from, date).map(([a, b]) => {
    const key = `${endpoint}|${a}|${b}`;
    if (!memo.has(key)) {
      const p = pseQ(endpoint, `business_date ge '${a}' and business_date le '${b}'`, Math.min(100000, perDay * CHUNK + 200));
      p.catch(() => memo.delete(key));
      memo.set(key, p);
    }
    return memo.get(key);
  })).then((parts) => parts.flat().filter((r) => !r.business_date || (r.business_date >= from && r.business_date <= date)));
}
// Odświeżenie danych bieżących: zapominamy tylko porcje zawierające dziś.
function forgetToday() {
  const [[a, b]] = chunksOf(todayIso(), todayIso());
  for (const k of [...memo.keys()]) if (k.endsWith(`|${a}|${b}`) || !k.includes(`|${a}|`) && k.includes(todayIso())) memo.delete(k);
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
const period = (grid, i) => `${grid.multi ? `${fDayShort.format(grid.starts[i])}, ` : ''}${fTime.format(grid.starts[i])}–${fTime.format(grid.starts[i] + grid.step)}`;
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
  const d = `${from}|${date}`;
  const open = [...box.querySelectorAll('details')].map((x) => x.open);
  if (!silent) box.innerHTML = empty('Ładowanie…');
  return {
    stale: () => d !== `${from}|${date}`,
    restore: () => silent && box.querySelectorAll('details').forEach((x, i) => open[i] && (x.open = true)),
  };
}



// ---------- Stan: zakres dni ----------
// date = ostatni dzień zakresu (także „dziś” dla sekcji bieżących), from = pierwszy, days = liczba dni.
// W adresie: ?d=RRRR-MM-DD (koniec) i ?dni=N (gdy więcej niż 1). Historia API PSE zaczyna się 14.06.2024.
const PSE_START = '2024-06-14';
const LADDER = [1, 3, 7, 14, 31, 92];
const qs0 = new URLSearchParams(location.search);
let date = qs0.get('d') || todayIso();
let days = LADDER.includes(+qs0.get('dni')) ? +qs0.get('dni') : 1;
let from = addDays(date, -(days - 1));
const fDM = new Intl.DateTimeFormat('pl-PL', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });

function setRange(end, n = days) {
  const max = addDays(todayIso(), 1);
  if (end > max) end = max;
  if (addDays(end, -(n - 1)) < PSE_START) end = addDays(PSE_START, n - 1) > max ? max : addDays(PSE_START, n - 1);
  date = end;
  days = n;
  from = addDays(end, -(n - 1));
  if (from < PSE_START) from = PSE_START;
  const url = new URL(location.href);
  if (end === todayIso()) url.searchParams.delete('d');
  else url.searchParams.set('d', end);
  if (n === 1) url.searchParams.delete('dni');
  else url.searchParams.set('dni', n);
  history.replaceState(null, '', url);
  $('#date').value = end;
  $('#date').max = max;
  $('#date').min = PSE_START;
  $('#days').value = String(n);
  $('#next').disabled = end >= max;
  $('#prev').disabled = from <= PSE_START;
  $('#one-day').hidden = n === 1;
  const rel = end === todayIso() ? 'Dziś' : end === addDays(todayIso(), 1) ? 'Jutro' : end === addDays(todayIso(), -1) ? 'Wczoraj' : '';
  $('#date-label').textContent = n === 1
    ? (rel ? rel + ', ' : '') + fDateLong.format(new Date(end + 'T00:00:00Z'))
    : `${fDM.format(new Date(from + 'T00:00:00Z'))} – ${fDM.format(new Date(end + 'T00:00:00Z'))} (${days} ${plural(days, ['dzień', 'dni', 'dni'])})`;
  loadDay();
}
const setDate = (iso) => setRange(iso, days);
// Oddalenie wykresu przy pełnym widoku: następny szczebel długości; zakres rośnie głównie w przeszłość.
function widenRange() {
  const i = LADDER.indexOf(days);
  if (i < 0 || i >= LADDER.length - 1) return;
  const n = LADDER[i + 1];
  setRange(addDays(date, Math.floor((n - days) / 3)), n);
}
// Wykresy zakładki dziennej: oddalanie poza pełny widok rozszerza zakres dni.
function drawChart(key, el, o, group = 'day') {
  return drawChartC(key, el, group === 'day' ? { ...o, onZoomOutFull: days < LADDER[LADDER.length - 1] ? widenRange : null } : o, group);
}

// ---------- Siatka zakresu i rozdzielczość wyświetlania ----------
// Dane liczymy zawsze na siatce kwadransów całego zakresu (kafelki i sumy z pełnych danych), a do wykresów i tabel
// uśredniamy: do 3 dni — kwadranse, do 14 dni — godziny, dłużej — doby (doby liczone od północy, z 23/25-godzinnymi).
const baseGrid = (step = Q) => rangeGrid(from, days, step);
function disp(grid) {
  const target = days <= 3 ? Q : days <= 14 ? HOUR : 'D';
  const n0 = grid.starts.length;
  let bucket; // indeks przedziału dla każdego punktu siatki bazowej
  let starts;
  let ends;
  if (target === 'D') {
    const keys = grid.starts.map((t) => warsaw(t).slice(0, 10));
    starts = [];
    ends = [];
    bucket = keys.map((k, i) => {
      if (i === 0 || k !== keys[i - 1]) { starts.push(midnight(k)); ends.push(midnight(addDays(k, 1))); }
      return starts.length - 1;
    });
  } else if (target <= grid.step) {
    starts = grid.starts.slice();
    ends = starts.map((t) => t + grid.step);
    bucket = starts.map((_, i) => i);
  } else {
    starts = [];
    ends = [];
    bucket = grid.starts.map((t, i) => {
      const h = t - (t % target);
      if (i === 0 || h !== grid.starts[i - 1] - (grid.starts[i - 1] % target)) { starts.push(h); ends.push(h + target); }
      return starts.length - 1;
    });
  }
  const n = starts.length;
  const same = n === n0;
  const down = (a) => {
    if (same) return a;
    const sum = new Array(n).fill(0);
    const cnt = new Array(n).fill(0);
    a.forEach((v, i) => { if (v != null) { sum[bucket[i]] += v; cnt[bucket[i]]++; } });
    return sum.map((v, k) => (cnt[k] ? v / cnt[k] : null));
  };
  // Suma zamiast średniej (dla wielkości sumowanych w czasie, np. zł za przedział).
  const total = (a) => {
    if (same) return a;
    const sum = new Array(n).fill(null);
    a.forEach((v, i) => { if (v != null) sum[bucket[i]] = (sum[bucket[i]] ?? 0) + v; });
    return sum;
  };
  const daily = target === 'D';
  const lab = (i) => (daily
    ? `${fDayShort.format(starts[i])} (średnio w dobie)`
    : `${days > 1 ? `${fDayShort.format(starts[i])}, ` : ''}${fTime.format(starts[i])}–${fTime.format(ends[i])}${same ? '' : ' (średnio)'}`);
  const now = Date.now();
  const ni = starts.findIndex((t, i) => now >= t && now < ends[i]);
  return {
    n, starts, down, total, lab, daily, same,
    ticks: timeTicks(starts),
    now: ni >= 0 ? ni : null,
    unit: same ? '' : daily ? ' — średnie dobowe' : ' — średnie godzinowe',
  };
}
// Etykiety osi czasu według widocznego okresu: godziny → północe z datą → dni → początki miesięcy.
function timeTicks(starts) {
  const keys = starts.map((t) => warsaw(t));
  return (v0, v1) => {
    const a = Math.max(0, Math.floor(v0));
    const b = Math.min(starts.length - 1, Math.ceil(v1));
    const spanH = (starts[b] - starts[a]) / HOUR;
    const out = [];
    for (let i = a; i <= b; i++) {
      const k = keys[i];
      const hh = +k.slice(11, 13);
      const mi = +k.slice(14, 16);
      const newDay = i > 0 && k.slice(0, 10) !== keys[i - 1].slice(0, 10);
      if (spanH <= 50) {
        const every = spanH > 26 ? 360 : spanH > 12 ? 180 : spanH > 6 ? 60 : spanH > 3 ? 30 : 15;
        if ((hh * 60 + mi) % every === 0 || newDay) out.push({ i, label: (hh === 0 && mi === 0) || newDay ? (days > 1 ? fDayShort.format(starts[i]) : k.slice(11, 16)) : k.slice(11, 16) });
      } else if (spanH <= 24 * 20) {
        if (newDay || i === 0) out.push({ i, label: fDayShort.format(starts[i]) });
      } else if (spanH <= 24 * 100) {
        const d = +k.slice(8, 10);
        if ((newDay || i === 0) && [1, 8, 15, 22].includes(d)) out.push({ i, label: `${d}.${k.slice(5, 7)}` });
      } else if ((newDay || i === 0) && k.slice(8, 10) === '01') out.push({ i, label: `${MONTHS[+k.slice(5, 7) - 1]} ${k.slice(0, 4)}` });
    }
    return out;
  };
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
    if (days > 1) {
      // Zakres wielu dni: pasek godzin dla każdej doby (aktualna wersja prognozy) i podsumowanie okresu.
      const act = await pse('pdgsz', `business_date ge '${from}' and business_date le '${date}' and is_active eq true`, days * 30 + 50);
      if (run.stale()) return;
      if (!act.length) return void (box.innerHTML = empty('Brak prognoz PSE dla wybranego okresu.'));
      const byDay = new Map();
      for (const r of act) (byDay.get(r.business_date) || byDay.set(r.business_date, []).get(r.business_date)).push(r);
      const c = [0, 0, 0, 0];
      act.forEach((r) => c[r.usage_fcst]++);
      const mini = days > 7;
      const rowsHtml = [...byDay.keys()].sort().reverse().map((d) => {
        const g = dayGrid(d, HOUR);
        const ni = d === todayIso() ? nowIndex(g) : -1;
        return `<div class="kday"><div class="kday-h">${esc(fDayShort.format(midnight(d)))}${d === todayIso() ? ' <span class="badge">dziś</span>' : ''} <span class="pills">${summarize(byDay.get(d))}</span></div>${hourStrip(byDay.get(d), g, { mini, now: ni })}</div>`;
      }).join('');
      box.innerHTML = tilesHtml([0, 2, 3].map((s) => ({ l: STATES[s].name, v: `${c[s]} h`, d: `${fmt0.format((c[s] / act.length) * 100)}% godzin w okresie` })).concat([{ l: 'Doby z prognozą', v: `${byDay.size}`, d: `z ${days} w zakresie` }])) +
        stateLegend() + `<div class="kdays">${rowsHtml}</div>` +
        '<p class="note">Aktualna (ostatnia) wersja prognozy PSE dla każdej doby. Historia zmian prognozy jest dostępna po wybraniu jednego dnia.</p>';
      run.restore();
      return;
    }
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
    const grid = baseGrid();
    const D = disp(grid);
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
      { l: days > 1 ? 'Prognozowane zużycie w okresie' : 'Prognozowane zużycie doby', v: `${fmt0.format(fc.reduce((s, v) => s + (v || 0), 0) / 4000)} GWh`, d: '' },
    ].filter(Boolean);
    // Dziś: ostatni pomiar PSE powinien być sprzed najwyżej ok. 2 godzin.
    const lastEnd = lastA >= 0 ? grid.starts[lastA] + grid.step : midnight(date);
    const fresh = date === todayIso() || (from <= todayIso() && todayIso() <= date) ? staleNote({ what: 'o zapotrzebowaniu (PSE)', at: lastEnd, maxMinutes: 120 }) : '';
    const S = series.map((x) => ({ ...x, values: D.down(x.values) }));
    box.innerHTML = fresh + tilesHtml(tiles) + '<div class="chart" id="load-chart"></div>' +
      table(['Okres', 'Prognoza [MW]', 'Rzeczywiste [MW]'], D.starts.map((_, i) => [D.lab(i), S[0].values[i] == null ? '—' : fmt0.format(S[0].values[i]), S[1].values[i] == null ? '—' : fmt0.format(S[1].values[i])]));
    drawChart('load', $('#load-chart'), {
      n: D.n, series: S, xTicks: D.ticks, label: `Zapotrzebowanie KSE: prognoza i wykonanie${D.unit}`,
      nowIndex: D.now, zero: false,
      tooltip: (i, on) => tipRows(D.lab(i), S.filter((x) => on(x.name)).map((x) => ({ name: x.name, color: x.color, value: mw(x.values[i]) }))),
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
    const grid = baseGrid();
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
      { l: days > 1 ? 'Bilans energii w okresie' : 'Bilans energii doby', v: `${eGen - eLoad >= 0 ? '+' : '−'}${fmt0.format(Math.abs(eGen - eLoad))} GWh`, d: `wyprodukowano ${fmt0.format(eGen)} GWh, zużyto ${fmt0.format(eLoad)} GWh` },
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
    const D = disp(grid);
    const acD = D.down(ac);
    const genD = D.down(gen);
    const diffD = D.down(diff);
    const expD = D.down(exp);
    const pumpD = D.down(pump);
    const residD = D.down(resid);
    const restD = D.down(rest);
    const seriesD = series.map((x) => ({ ...x, values: D.down(x.values) }));
    const residSeriesD = residSeries.map((x) => ({ ...x, values: D.down(x.values) }));
    box.innerHTML = tilesHtml(tiles) +
      '<div class="chart" id="bal-chart"></div>' +
      '<h3 class="sub-h">Różnica: produkcja − zapotrzebowanie</h3>' +
      '<div class="chart" id="diff-chart"></div>' +
      residHtml +
      table(['Okres', 'Zapotrzebowanie [MW]', 'Produkcja [MW]', 'Produkcja − zapotrz. [MW]', 'Eksport netto [MW]', 'Pompowanie [MW]', 'Niezbilansowane [MW]'],
        D.starts.map((_, i) => [D.lab(i), ...[acD[i], genD[i], diffD[i], expD[i], pumpD[i], restD[i]].map((v) => (v == null ? '—' : fmt0.format(v)))]));
    drawChart('bal', $('#bal-chart'), {
      n: D.n, series: seriesD, band: { a: 1, b: 0, pos: 'var(--exp)', neg: 'var(--imp)' }, xTicks: D.ticks, label: `Zapotrzebowanie a produkcja energii${D.unit}`,
      legendExtra: '<span class="key"><i class="sw wash" style="background:var(--exp)"></i>nadwyżka (eksport)</span><span class="key"><i class="sw wash" style="background:var(--imp)"></i>niedobór (import)</span>',
      nowIndex: D.now, zero: false,
      tooltip: (i, on) => tipRows(D.lab(i), [
        ...seriesD.filter((s) => on(s.name)).map((s) => ({ name: s.name, color: s.color, value: mw(s.values[i]) })),
        { name: 'Różnica', color: diffD[i] == null ? null : diffD[i] >= 0 ? 'var(--exp)' : 'var(--imp)', value: diffD[i] == null ? '—' : saldo(diffD[i]) },
      ]),
    });
    drawChart('diff', $('#diff-chart'), {
      n: D.n, series: [{ name: 'Różnica', color: 'var(--exp)', values: diffD }], bars: true, height: 200,
      barColor: (v) => (v >= 0 ? 'var(--exp)' : 'var(--imp)'),
      yFmt: (v) => (v > 0 ? '+' : v < 0 ? '−' : '') + fmt0.format(Math.abs(v)),
      xTicks: D.ticks, label: 'Różnica produkcji i zapotrzebowania',
      legendExtra: '<span class="key"><i class="sw" style="background:var(--exp)"></i>nadwyżka (eksport)</span><span class="key"><i class="sw" style="background:var(--imp)"></i>niedobór (import)</span>',
      nowIndex: D.now,
      tooltip: (i) => tipRows(D.lab(i), [{ name: 'Różnica', color: diffD[i] == null ? null : diffD[i] >= 0 ? 'var(--exp)' : 'var(--imp)', value: diffD[i] == null ? '—' : saldo(diffD[i]) }]),
    });
    if (rb.length)
      drawChart('resid', $('#resid-chart'), {
        n: D.n, series: residSeriesD, xTicks: D.ticks, height: 220, label: 'Produkcja minus zapotrzebowanie i eksport, na tle pompowania',
        nowIndex: D.now,
        tooltip: (i) => tipRows(D.lab(i), [
          { name: 'Produkcja', value: mw(genD[i]) },
          { name: 'Zapotrzebowanie', value: mw(acD[i]) },
          { name: `Eksport netto`, value: expD[i] == null ? '—' : expD[i] >= 0 ? mw(expD[i]) : `import ${mw(-expD[i])}` },
          { name: 'Różnica', color: 'var(--ink-2)', value: mw(residD[i]) },
          { name: 'Pompowanie', color: 'var(--g-woda)', value: mw(pumpD[i]) },
          { name: 'Niezbilansowane', value: mw(restD[i]) },
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
    const grid = baseGrid();
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
    const D = disp(grid);
    const seriesD = series.map((x) => ({ ...x, values: D.down(x.values) }));
    box.innerHTML = staleNote({ what: 'o mocy osiągalnej (ARE)', asOf: CAP.asOf, maxDays: 120, fetched: CAP.fetched, stale: CAP.stale }) + `<div class="legend"><span class="key"><i class="sw" style="background:var(--ink-2)"></i>średnie wykorzystanie ${days > 1 ? 'w okresie' : 'w dobie'}</span><span class="key"><i class="plan-key"></i>maksimum ${days > 1 ? 'w okresie' : 'w dobie'}</span></div>
      <div class="util">${rowsHtml}</div>` +
      `<h3 class="sub-h">Wykorzystanie w czasie${D.unit}</h3>` + '<div class="chart" id="util-chart"></div>' +
      table(['Okres', ...CAP.groups.map((g) => g.name + ' [%]')], D.starts.map((_, i) => [D.lab(i), ...seriesD.map((s) => (s.values[i] == null ? '—' : fmt0.format(s.values[i])))])) +
      `<p class="note">Wykorzystanie = bieżąca generacja (PSE) ÷ moc osiągalna danego rodzaju źródeł, stan na koniec: ${monthName(CAP.asOf)}${CAP.live ? ' (pobierane automatycznie z ARE)' : ' (wartości zapasowe — nie udało się wczytać aktualnych danych ARE)'}. Źródła mocy: ${CAP.sources.map((x) => `<a href="${x.url}" rel="noopener">${x.name}</a>`).join(', ')}. Moc to wartość stała — nie uwzględnia bieżących remontów i ubytków. Wiatr morski: ARE jeszcze go nie wykazuje, dlatego przyjmujemy ręcznie wpisaną moc nominalną Baltic Power (1140 MW; farma jest w rozruchu). ARE nie rozdziela wiatru na lądowy i morski — gdy zacznie wykazywać morski, trzeba to rozdzielić. Instalacje hybrydowe OZE (ok. 28 MW) pominięto. Pominięto elektrownie szczytowo-pompowe (ARE nie podaje ich mocy osobno) oraz gaz koksowniczy, olej i odpady.</p>`;
    const mwvD = mwv.map(D.down);
    drawChart('util', $('#util-chart'), {
      n: D.n, series: seriesD, xTicks: D.ticks, height: 280, label: 'Wykorzystanie mocy osiągalnej według rodzaju źródła',
      yFmt: (v) => `${fmt0.format(v)}%`,
      nowIndex: D.now,
      tooltip: (i, on) => tipRows(D.lab(i), seriesD.map((s, k) => [s, k]).filter(([s]) => on(s.name)).map(([s, k]) => ({ name: s.name, color: s.color, value: s.values[i] == null ? '—' : `${pct(s.values[i])} · ${fmt0.format(mwvD[k][i])} MW` }))),
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
    const grid = baseGrid();
    const n = grid.starts.length;
    const { series, total, oze } = parseGen(rows, grid);
    const sumAt = (i) => series.reduce((a, s) => a + (s.values[i] || 0), 0);
    const energy = series.map((s) => s.values.reduce((a, v) => a + (v || 0), 0) / 4);
    const top = energy.map((e, k) => [e, k]).sort((a, b) => b[0] - a[0])[0];
    const tiles = [
      { l: days > 1 ? 'Udział OZE w wybranym okresie' : 'Udział OZE w wybranej dobie', v: `${fmt0.format((oze / total) * 100)}%`, d: 'wiatr, słońce, biomasa, biogaz, woda (bez elektrowni szczytowo-pompowych)' },
      { l: 'Energia wyprodukowana', v: `${fmt0.format(total / 1000)} GWh`, d: 'suma dla dostępnych kwadransów' },
      { l: 'Największe źródło', v: GEN_GROUPS[top[1]].name, d: `${fmt0.format((top[0] / total) * 100)}% energii` },
    ];
    const D = disp(grid);
    const seriesD = series.map((x) => ({ ...x, values: D.down(x.values) }));
    box.innerHTML = tilesHtml(tiles) + '<div class="chart" id="gen-chart"></div>' +
      table(['Okres', ...GEN_GROUPS.map((g) => g.name), 'Suma'], D.starts.map((_, i) => [D.lab(i), ...seriesD.map((s) => (s.values[i] == null ? '—' : fmt0.format(s.values[i]))), seriesD[0].values[i] == null ? '—' : fmt0.format(seriesD.reduce((a, s) => a + (s.values[i] || 0), 0))]));
    drawChart('gen', $('#gen-chart'), {
      n: D.n, series: seriesD, stacked: true, xTicks: D.ticks, height: 300, label: `Struktura generacji mocy według źródeł${D.unit}`,
      nowIndex: D.now,
      tooltip: (i, on) => {
        if (seriesD[0].values[i] == null) return tipRows(D.lab(i), [{ name: 'brak danych', value: '' }]);
        const tot = seriesD.reduce((a, s) => a + (s.values[i] || 0), 0);
        return tipRows(D.lab(i), [
          ...seriesD.slice().reverse().filter((s) => on(s.name)).map((s) => ({ name: s.name, color: s.color, value: `${fmt0.format(s.values[i])} MW · ${fmt0.format((s.values[i] / tot) * 100)}%` })),
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
    const rows = await pseDay('rce-pln', 110);
    if (run.stale()) return;
    if (!rows.length) return void (box.innerHTML = empty('Ceny RCE dla tego dnia nie zostały jeszcze opublikowane (zwykle ok. 14:00 dnia poprzedniego).'));
    const grid = baseGrid();
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
      { l: days > 1 ? 'Średnia w okresie' : 'Średnia doby', v: `${fmt2.format(avg)} zł/MWh`, d: kwh(avg) },
      { l: 'Najtaniej', v: `${fmt2.format(v[min])} zł/MWh`, d: period(grid, min) },
      { l: 'Najdrożej', v: `${fmt2.format(v[max])} zł/MWh`, d: period(grid, max) },
    ].filter(Boolean);
    const series = [{ name: 'RCE', color: 'var(--s1)', values: v }];
    const D = disp(grid);
    const vD = D.down(v);
    const seriesD = series.map((x) => ({ ...x, values: D.down(x.values) }));
    box.innerHTML = tilesHtml(tiles) + '<div class="chart" id="rce-chart"></div>' +
      table(['Okres', 'RCE [zł/MWh]', 'zł/kWh'], D.starts.map((_, i) => [D.lab(i), vD[i] == null ? '—' : fmt2.format(vD[i]), vD[i] == null ? '—' : fmt2.format(vD[i] / 1000)]));
    drawChart('rce', $('#rce-chart'), {
      n: D.n, series: seriesD, step: true, area: true, xTicks: D.ticks, label: `Rynkowa cena energii (RCE)${D.unit}`,
      nowIndex: D.now,
      tooltip: (i) => tipRows(D.lab(i), [{ name: 'RCE', color: 'var(--s1)', value: vD[i] == null ? '—' : `${fmt2.format(vD[i])} zł/MWh` }, { name: '', value: vD[i] == null ? '' : kwh(vD[i]) }]),
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
    const grid = baseGrid();
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
    const D = disp(grid);
    const rdnD = D.down(rdn);
    const cenD = D.down(cen);
    const cenPreD = D.down(cenPre);
    const cebD = D.down(ceb);
    const corAllD = D.down(corAll);
    const enBestD = D.down(enBest);
    const skvD = D.down(skv);
    const skDD = D.down(skD);
    const skD1D = D.down(skD1);
    const seriesD = series.map((x) => ({ ...x, values: D.down(x.values) }));
    const volD = vol.map((x) => ({ ...x, values: D.down(x.values) }));
    box.innerHTML = tilesHtml(tiles) + status +
      '<div class="chart" id="prices-chart"></div>' +
      `<h3 class="sub-h">Niezbilansowanie i stan kontraktacji systemu <span class="muted">[MWh w kwadransie${D.same ? '' : ', średnio'}]</span></h3>` +
      '<div class="chart" id="imb-chart"></div>' +
      table(['Okres', 'RDN', 'CEN', 'CEN wstępna', 'CEB', 'COR', 'EN [MWh]', 'SK [MWh]', 'SK D [MWh]', 'SK D-1 [MWh]'],
        D.starts.map((_, i) => [D.lab(i), ...[rdnD[i], cenD[i], cenPreD[i], cebD[i], corAllD[i]].map((v) => (v == null ? '—' : fmt2.format(v))), ...[enBestD[i], skvD[i], skDD[i], skD1D[i]].map((v) => (v == null ? '—' : fmt2.format(v)))])) +
      '<p class="note">Ujemne EN/SK = system „krótki” (w kontraktach brakuje energii, PSE musi ją dokupić), dodatnie = „długi”. Oznaczenia jak w raporcie PSE „Ceny energii na Rynku Bilansującym”.</p>';
    const now = D.now;
    drawChart('prices', $('#prices-chart'), {
      n: D.n, series: seriesD, step: true, xTicks: D.ticks, height: 280, label: `Ceny energii: RDN i rynek bilansujący${D.unit}`, nowIndex: now,
      yFmt: (v) => fmt0.format(v),
      tooltip: (i, on) => tipRows(D.lab(i), seriesD.filter((s) => on(s.name)).map((s) => ({ name: s.name, color: s.color, value: zl(s.values[i]) }))),
    });
    drawChart('imb', $('#imb-chart'), {
      n: D.n, series: volD, xTicks: D.ticks, height: 220, label: 'Energia niezbilansowania i stan kontraktacji', nowIndex: now,
      yFmt: (v) => (v > 0 ? '+' : v < 0 ? '−' : '') + fmt0.format(Math.abs(v)),
      tooltip: (i, on) => tipRows(D.lab(i), volD.filter((s) => on(s.name)).map((s) => ({ name: s.name, color: s.color, value: s.values[i] == null ? '—' : `${mwh(s.values[i])} · ${s.values[i] < 0 ? 'krótki' : 'długi'}` }))),
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
    const [rows, rce] = await Promise.all([pseDay('poze-redoze', 500), pseDay('rce-pln', 110)]);
    if (run.stale()) return;
    if (!rows.length) return void (box.innerHTML = empty('Brak danych o redukcjach dla wybranego dnia.'));
    const grid = baseGrid();
    const n = grid.starts.length;
    const price = new Array(n).fill(null);
    for (const r of rce) {
      const i = grid.index.get(utc(r.dtime_utc) - Q);
      if (i != null) price[i] = r.rce_pln;
    }
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
    // Wartość ograniczonej energii po RCE: MW × ¼ h × zł/MWh, w każdym kwadransie (null, gdy brak ceny).
    const worth = (a, b) => a.values.map((v, i) => (price[i] == null ? null : ((v || 0) + (b.values[i] || 0)) / 4 * price[i]));
    const pvZ = worth(series[0], series[1]);
    const wiZ = worth(series[2], series[3]);
    const totZ = pvZ.map((v, i) => (v == null ? null : v + wiZ[i]));
    const sumOf = (a) => a.reduce((s, v) => s + (v || 0), 0);
    const hasPrice = price.some((v) => v != null);
    const zl = (v) => {
      if (v == null) return '—';
      const a = Math.abs(v);
      return a >= 1e6 ? `${fmt2.format(v / 1e6)} mln zł` : a >= 1e4 ? `${fmt0.format(v / 1e3)} tys. zł` : `${fmt0.format(v)} zł`;
    };
    const tiles = [
      { l: 'Ograniczona energia PV', v: `${fmt0.format(pvE)} MWh`, d: `bilansowo ${fmt0.format(energy[0])} · sieciowo ${fmt0.format(energy[1])}` },
      { l: 'Ograniczona energia wiatru', v: `${fmt0.format(wiE)} MWh`, d: `bilansowo ${fmt0.format(energy[2])} · sieciowo ${fmt0.format(energy[3])}` },
      { l: 'Największa łączna redukcja', v: mw(tot[iMax]), d: tot[iMax] > 0 ? period(grid, iMax) : 'brak redukcji' },
      hasPrice ? { l: 'Wartość ograniczonej energii (RCE)', v: zl(sumOf(totZ)), d: `PV ${zl(sumOf(pvZ))} · wiatr ${zl(sumOf(wiZ))}${pvE + wiE > 0 ? ` · średnio ${fmt0.format(sumOf(totZ) / (pvE + wiE))} zł/MWh` : ''}` } : null,
    ].filter(Boolean);
    const D = disp(grid);
    const totD = D.down(tot);
    const seriesD = series.map((x) => ({ ...x, values: D.down(x.values) }));
    const pvZD = D.total(pvZ);
    const wiZD = D.total(wiZ);
    const totZD = D.total(totZ);
    const priceD = D.down(price);
    const zUnit = D.same ? ' — w kwadransie' : D.daily ? ' — w dobie' : ' — w godzinie';
    box.innerHTML = tilesHtml(tiles) + '<div class="chart" id="curt-chart"></div>' +
      (hasPrice ? `<h3 class="sub-h">Wartość ograniczonej energii po RCE, zł${zUnit}</h3><div class="chart" id="curt-pln"></div>` : '') +
      table(['Okres', ...defs.map((d) => d[1] + ' [MW]'), ...(hasPrice ? ['RCE [zł/MWh]', 'Wartość [zł]'] : [])], D.starts.map((_, i) => [D.lab(i), ...seriesD.map((s) => (s.values[i] == null ? '—' : fmt0.format(s.values[i]))), ...(hasPrice ? [priceD[i] == null ? '—' : fmt2.format(priceD[i]), totZD[i] == null ? '—' : fmt0.format(totZD[i])] : [])])) +
      '<p class="note">Nierynkowe redysponowanie: moc, o jaką PSE poleciły zmniejszyć generację źródeł PV i wiatrowych — ze względów bilansowych (nadpodaż energii w systemie) lub sieciowych (ograniczenia przesyłu).' +
      (hasPrice ? ' Wartość = ograniczona energia w kwadransie × rynkowa cena energii (RCE) w tym kwadransie — to wycena rynkowa niewyprodukowanej energii, a nie kwota rekompensat wypłacanych przez PSE. Przy ujemnej RCE wartość jest ujemna: produkcja tej energii kosztowałaby wytwórców.' : '') + '</p>';
    drawChart('curt', $('#curt-chart'), {
      n: D.n, series: seriesD, stacked: true, xTicks: D.ticks, height: 240, label: `Redukcje generacji OZE${D.unit}`, nowIndex: D.now,
      tooltip: (i, on) => tipRows(D.lab(i), [...seriesD.filter((s) => on(s.name)).map((s) => ({ name: s.name, color: s.color, value: mw(s.values[i]) })), { name: 'Razem', value: mw(totD[i]) }]),
    });
    if (hasPrice) drawChart('curt-pln', $('#curt-pln'), {
      n: D.n, series: [{ name: 'Wartość', color: 'var(--s1)', values: totZD }], bars: true, height: 200,
      barColor: (v) => (v >= 0 ? 'var(--s1)' : 'var(--exp)'),
      yFmt: (v) => (Math.abs(v) >= 1e6 ? `${fmt2.format(v / 1e6)} mln` : Math.abs(v) >= 1e3 ? `${fmt0.format(v / 1e3)} tys.` : fmt0.format(v)),
      xTicks: D.ticks, label: `Wartość ograniczonej energii OZE po RCE, zł${zUnit}`, nowIndex: D.now,
      legendExtra: '<span class="key"><i class="sw" style="background:var(--s1)"></i>RCE dodatnia</span><span class="key"><i class="sw" style="background:var(--exp)"></i>RCE ujemna</span>',
      tooltip: (i) => tipRows(D.lab(i).replace(' (średnio)', '').replace(' (średnio w dobie)', ''), [
        { name: 'PV', color: 'var(--g-pv)', value: zl(pvZD[i]) },
        { name: 'Wiatr', color: 'var(--g-wl)', value: zl(wiZD[i]) },
        { name: 'Razem', value: zl(totZD[i]) },
        { name: D.same ? 'RCE' : 'RCE (średnio)', value: priceD[i] == null ? '—' : `${fmt2.format(priceD[i])} zł/MWh` },
      ]),
    });
    run.restore();
  } catch (e) {
    if (run.stale()) return;
    box.innerHTML = errorBox(e);
  }
}

// ---------- Trafność prognoz wiatru i PV (pdgopkd, pk5l-wp, his-gen-pal-sire, poze-redoze) ----------
// Prognozę porównujemy z produkcją możliwą = produkcja + redukcje poleceniem PSE: plan dnia poprzedniego (PKD)
// prognozuje produkcję bez redukcji (sprawdzone np. 3.05.2026: PV w południe PKD 12,4 GW, produkcja 10,2 GW + redukcje 2,9 GW).
// pk5l-wp dla minionych godzin zawiera ostatnią wersję sprzed danej godziny, a pdgobpkd — wersję z końca doby (nie jest prognozą).
const FCST_SRC = [
  { key: 'wi', name: 'Wiatr', codes: ['WI', 'WM'], pkd: 'gen_wi', wp: 'fcst_wi_tot_gen', red: ['wi_red_balance', 'wi_red_network'], color: 'var(--g-wl)' },
  { key: 'pv', name: 'Słońce (PV)', codes: ['ES'], pkd: 'gen_fv', wp: 'fcst_pv_tot_gen', red: ['pv_red_balance', 'pv_red_network'], color: 'var(--g-pv)' },
];
async function renderFcst({ silent = false } = {}) {
  const box = $('#fcst-body');
  const run = begin(box, silent);
  try {
    const [gen, red, pkd, wp] = await Promise.all([
      pseDay('his-gen-pal-sire', 20000),
      pseDay('poze-redoze', 500).catch(() => []),
      pseDay('pdgopkd', 500),
      pseDay('pk5l-wp', 30).catch(() => []),
    ]);
    if (run.stale()) return;
    if (!pkd.length && !wp.length) return void (box.innerHTML = empty('Brak prognoz PSE dla wybranego okresu.'));
    const grid = baseGrid();
    const n = grid.starts.length;
    const arr = () => new Array(n).fill(null);
    const at = (r) => grid.index.get(utc(r.dtime_utc) - Q);
    const D = disp(grid);
    const en = (mwh) => (Math.abs(mwh) >= 1e5 ? `${fmt0.format(mwh / 1000)} GWh` : Math.abs(mwh) >= 1000 ? `${fmt2.format(mwh / 1000)} GWh` : `${fmt0.format(mwh)} MWh`);
    const pct = (v) => `${v >= 0 ? '+' : '−'}${fmt0.format(Math.abs(v))}%`;
    const parts = FCST_SRC.map((src) => {
      const act = arr();
      const cut = arr();
      const fP = arr();
      const fW = arr();
      for (const r of gen) {
        if (!src.codes.includes(r.alias_sire)) continue;
        const i = at(r);
        const v = parseFloat(String(r.value).replace(',', '.'));
        if (i != null && isFinite(v)) act[i] = (act[i] || 0) + v;
      }
      for (const r of red) { const i = at(r); if (i != null) cut[i] = src.red.reduce((a, f) => a + Math.abs(r[f] || 0), 0); }
      for (const r of pkd) { const i = at(r); if (i != null && r[src.pkd] != null) fP[i] = r[src.pkd]; }
      // pk5l-wp jest godzinowy (plan_dtime = koniec godziny): wartość na 4 kwadranse.
      for (const r of wp) {
        const i = grid.index.get(utc(r.plan_dtime_utc) - HOUR);
        if (i == null || r[src.wp] == null) continue;
        for (let k = i; k < Math.min(n, i + HOUR / Q); k++) fW[k] = r[src.wp];
      }
      const pot = act.map((v, i) => (v == null ? null : v + (cut[i] || 0)));
      // Statystyki z kwadransów, dla których jest i prognoza, i wykonanie.
      const stat = (f) => {
        const ii = pot.map((_, i) => i).filter((i) => pot[i] != null && f[i] != null);
        if (!ii.length) return null;
        const potE = ii.reduce((a, i) => a + pot[i], 0) / 4;
        const fE = ii.reduce((a, i) => a + f[i], 0) / 4;
        const mae = ii.reduce((a, i) => a + Math.abs(f[i] - pot[i]), 0) / ii.length;
        const mean = (potE * 4) / ii.length;
        return { mae, rel: mean > 0 ? (mae / mean) * 100 : null, bias: potE > 0 ? ((fE - potE) / potE) * 100 : null, potE, fE, count: ii.length };
      };
      const sP = stat(fP);
      const sW = stat(fW);
      const has = act.some((v) => v != null);
      const actE = act.reduce((a, v) => a + (v || 0), 0) / 4;
      const cutE = act.reduce((a, v, i) => a + (v == null ? 0 : cut[i] || 0), 0) / 4;
      const series = [
        { name: 'Prognoza D-1 (plan PKD)', color: 'var(--s1)', values: D.down(fP) },
        { name: 'Prognoza bieżąca (pk5l-wp)', color: 'var(--s7)', values: D.down(fW) },
        { name: 'Produkcja możliwa (z redukcjami)', color: 'var(--exp)', values: D.down(pot) },
        { name: 'Produkcja', color: src.color, values: D.down(act) },
      ];
      const cutD = D.down(act.map((v, i) => (v == null ? null : cut[i] || 0)));
      const tiles = [
        sP && { l: 'Średni błąd prognozy D-1', v: mw(sP.mae), d: sP.rel == null ? '' : `${fmt0.format(sP.rel)}% średniej możliwej produkcji` },
        sP && sP.bias != null && { l: 'Prognoza D-1 a możliwa produkcja', v: pct(sP.bias), d: `prognoza ${en(sP.fE)} · możliwa ${en(sP.potE)}${sP.count < n ? ' (okres z pomiarami)' : ''}` },
        sW && { l: 'Średni błąd prognozy bieżącej', v: mw(sW.mae), d: sW.bias == null ? '' : `energia ${pct(sW.bias)} względem możliwej produkcji` },
        has && { l: 'Redukcje poleceniem PSE', v: en(cutE), d: actE + cutE > 0 ? `${fmt0.format((cutE / (actE + cutE)) * 100)}% możliwej produkcji · wyprodukowano ${en(actE)}` : 'brak produkcji w okresie' },
      ];
      return { src, series, cutD, tiles, has };
    });
    box.innerHTML = (!parts[0].has ? empty(date > todayIso() ? 'Pomiary produkcji pojawiają się w trakcie doby — poniżej tylko prognozy.' : 'Brak pomiarów produkcji dla wybranego okresu — poniżej tylko prognozy.') : '') +
      parts.map((p) => `<h3 class="sub-h">${p.src.name}</h3>${tilesHtml(p.tiles)}<div class="chart" id="fcst-${p.src.key}"></div>`).join('') +
      table(['Okres', ...parts.flatMap((p) => [`${p.src.name}: prognoza D-1`, 'prognoza bieżąca', 'produkcja', 'redukcje'])], D.starts.map((_, i) => [D.lab(i), ...parts.flatMap((p) => [p.series[0].values[i], p.series[1].values[i], p.series[3].values[i], p.cutD[i]].map((v) => (v == null ? '—' : fmt0.format(v))))])) +
      '<p class="note">Prognoza D-1 — plan koordynacyjny dobowy PSE sporządzony dzień wcześniej (pdgopkd); prognoza bieżąca — plan koordynacyjny pk5l-wp (ten sam co w sekcji „Prognoza PSE na 7 dni”), dla minionych godzin w ostatniej wersji sprzed danej godziny, godzinowo; w dniach dużych redukcji bywa wyraźnie niższa od produkcji możliwej, a nawet od rzeczywistej (np. PV 3.05.2026) — możliwe, że uwzględnia redukcje planowane przez PSE, czego PSE nie opisuje. ' +
      'Prognozy porównujemy z produkcją możliwą, czyli rzeczywistą produkcją powiększoną o redukcje poleceniem PSE (zacieniowane pasmo; sekcja „Redukcje generacji OZE”) — bez nich prognoza w godzinach redukcji wyglądałaby na zawyżoną. ' +
      'Nie są uwzględnione ograniczenia, o których wytwórcy decydują sami (np. wyłączanie PV przy ujemnych cenach). Średni błąd = średnia bezwzględna różnica w kwadransach; dla PV liczona także z godzin nocnych.</p>';
    for (const p of parts) {
      const S = p.series;
      drawChart(`fcst-${p.src.key}`, $(`#fcst-${p.src.key}`), {
        n: D.n, series: S, xTicks: D.ticks, height: 260, nowIndex: D.now,
        band: { a: 2, b: 3, pos: 'var(--exp)', neg: 'var(--exp)' },
        label: `${p.src.name}: prognoza PSE, produkcja i redukcje, MW${D.unit}`,
        legendExtra: '<span class="key"><i class="sw" style="background:var(--exp);opacity:.3"></i>Redukcje poleceniem PSE</span>',
        tooltip: (i, on) => tipRows(D.lab(i), [
          ...S.filter((s) => on(s.name)).map((s) => ({ name: s.name, color: s.color, value: mw(s.values[i]) })),
          { name: 'Redukcje PSE', value: mw(p.cutD[i]) },
          S[0].values[i] != null && S[2].values[i] != null ? { name: 'Błąd prognozy D-1', value: `${S[0].values[i] >= S[2].values[i] ? '+' : '−'}${mw(Math.abs(S[0].values[i] - S[2].values[i]))}` } : null,
        ].filter(Boolean)),
      });
    }
    run.restore();
  } catch (e) {
    if (run.stale()) return;
    box.innerHTML = errorBox(e);
  }
}

// ---------- Praca dużych elektrowni (gen-jw: jednostki wytwórcze centralnie dysponowane) ----------
// Paliwo elektrowni JWCD — PSE go nie publikuje, więc lista jest prowadzona ręcznie na podstawie informacji właścicieli
// (stan: wrzesień 2026). Nowe nazwy z API trafiają do „paliwo nieznane”, żeby było widać, co trzeba uzupełnić.
const FUELS = {
  wk: { name: 'węgiel kamienny', color: 'var(--g-wk)' },
  wb: { name: 'węgiel brunatny', color: 'var(--g-wb)' },
  gaz: { name: 'gaz ziemny', color: 'var(--g-gaz)' },
  bio: { name: 'biomasa', color: 'var(--g-bio)' },
  pump: { name: 'woda (szczytowo-pompowa)', color: 'var(--g-woda)' },
  wm: { name: 'wiatr morski', color: 'var(--g-wm)' },
  pv: { name: 'fotowoltaika', color: 'var(--g-pv)' },
  unk: { name: 'paliwo nieznane', color: 'var(--ink-2)' },
};
const PLANT_FUEL = {
  'Bełchatów': 'wb', 'Turów': 'wb', 'Pątnów 2': 'wb',
  'Opole': 'wk', 'Kozienice 1': 'wk', 'Kozienice 2': 'wk', 'Jaworzno 2 JWCD': 'wk', 'Jaworzno 3': 'wk', 'Połaniec': 'wk', 'Rybnik': 'wk',
  'Ostrołęka B': 'wk', 'Łagisza': 'wk', 'Łaziska 3': 'wk', 'Siersza': 'wk', 'Skawina': 'wk', 'Katowice': 'wk', 'Chorzów': 'wk',
  'EC Siekierki': 'wk', 'EC Łódź-4': 'wk', 'Kraków Łęg': 'wk', 'Karolin 2': 'wk', 'Wrocław': 'wk',
  'Gryfino': 'gaz', 'EC Czechnica-2': 'gaz', 'EC Rzeszów': 'gaz', 'EC Stalowa Wola': 'gaz', 'EC Wrotków': 'gaz', 'EC Włocławek': 'gaz',
  'EC Żerań 2': 'gaz', 'Płock': 'gaz', 'Zielona Góra': 'gaz', 'Ostrołęka C': 'gaz',
  'Połaniec 2-Pasywna': 'bio',
  'Żarnowiec': 'pump', 'Porąbka Żar': 'pump', 'Solina': 'pump', 'Żydowo': 'pump',
  'MFW Baltic Power': 'wm', 'Zwartowo': 'pv',
};
const plantFuel = (name) => PLANT_FUEL[name] || (/Żarnowiec|Porąbka|Solina|Żydowo/.test(name) ? 'pump' : 'unk');

async function renderUnits({ silent = false } = {}) {
  const box = $('#units-body');
  const run = begin(box, silent);
  try {
    // gen-jw ma ok. 10 tys. rekordów na dobę — dłuższych zakresów nie pobieramy.
    if (days > 14) return void (box.innerHTML = empty('Dane o pracy poszczególnych elektrowni pokazujemy dla zakresu do 14 dni (PSE publikuje ok. 10 tys. rekordów na dobę). Wybierz krótszy zakres.'));
    const rows = await pseDay('gen-jw', 12000);
    if (run.stale()) return;
    if (!rows.length) return void (box.innerHTML = empty('Brak danych o pracy elektrowni dla wybranego dnia (PSE publikuje je zwykle po zakończeniu doby).'));
    const grid = baseGrid();
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
    const list = [...plants.values()].map((p) => ({ ...p, fuel: plantFuel(p.name), max: Math.max(...p.net.filter((v) => v != null)), avg: p.net.filter((v) => v != null).reduce((a, v) => a + v, 0) / Math.max(1, p.net.filter((v) => v != null).length) })).sort((a, b) => b.gen - a.gen);
    const total = list.reduce((a, p) => a + p.gen, 0);
    const colors = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--s6)', 'var(--s7)', 'var(--s8)'];
    const series = list.slice(0, 8).map((p, k) => ({ name: `${p.name} (${FUELS[p.fuel].name})`, color: colors[k], values: p.net }));
    // Energia JWCD według paliwa (bez pompowania).
    const byFuel = Object.keys(FUELS).map((f) => ({ f, e: list.filter((p) => p.fuel === f).reduce((a, p) => a + p.gen, 0) })).filter((x) => x.e > 0).sort((a, b) => b.e - a.e);
    // Moc według paliwa w ciągu doby (warstwy w stałej kolejności, bez pompowania).
    const fuelSeries = Object.keys(FUELS).map((f) => ({ name: FUELS[f].name, color: FUELS[f].color, values: grid.starts.map((_, i) => {
      let t = null;
      for (const p of list) if (p.fuel === f && p.net[i] != null) t = (t ?? 0) + Math.max(0, p.net[i]);
      return t;
    }) })).filter((s) => s.values.some((v) => v > 0));
    const eMax = list[0]?.gen || 1;
    const rowHtml = (p) => `<div class="mrow"><div class="mname"><i class="sw" style="background:${FUELS[p.fuel].color}"></i> ${esc(p.name)} <span class="muted">· ${FUELS[p.fuel].name} · ${p.units.size} ${plural(p.units.size, ['blok', 'bloki', 'bloków'])}</span></div><div class="mtrack"><span class="mbar" style="width:${(p.gen / eMax) * 100}%;background:${FUELS[p.fuel].color}"></span></div><div class="mval">${fmt2.format(p.gen / 1000)} GWh <span class="muted">śr. ${fmt0.format(p.avg)} · maks. ${fmt0.format(p.max)} MW${p.pump ? ` · pompowanie ${fmt0.format(p.pump)} MWh` : ''}</span></div></div>`;
    const D = disp(grid);
    const seriesD = series.map((x) => ({ ...x, values: D.down(x.values) }));
    const fuelSeriesD = fuelSeries.map((x) => ({ ...x, values: D.down(x.values) }));
    box.innerHTML = tilesHtml([
      { l: 'Energia z dużych elektrowni', v: `${fmt0.format(total / 1000)} GWh`, d: (() => { const u = list.reduce((a, p) => a + p.units.size, 0); return `${list.length} ${plural(list.length, ['elektrownia', 'elektrownie', 'elektrowni'])}, ${u} ${plural(u, ['jednostka', 'jednostki', 'jednostek'])}`; })() },
      { l: 'Największa', v: esc(list[0].name), d: `${fmt0.format((list[0].gen / total) * 100)}% tej energii` },
    ]) +
      `<h3 class="sub-h">Energia według paliwa</h3>
      <div class="stackbar" role="img" aria-label="Energia z dużych elektrowni według paliwa">${byFuel.map((x) => `<span style="flex:${x.e};background:${FUELS[x.f].color}" title="${FUELS[x.f].name}: ${fmt2.format(x.e / 1000)} GWh"></span>`).join('')}</div>
      <div class="legend">${byFuel.map((x) => `<span class="key"><i class="sw" style="background:${FUELS[x.f].color}"></i>${FUELS[x.f].name}: <b>${fmt2.format(x.e / 1000)} GWh</b> (${fmt0.format((x.e / total) * 100)}%)</span>`).join('')}</div>` +
      '<div class="chart" id="units-fuel-chart"></div>' +
      '<h3 class="sub-h">Największe elektrownie</h3><div class="chart" id="units-chart"></div>' +
      `<h3 class="sub-h">Ranking elektrowni — energia ${days > 1 ? 'w okresie' : 'w dobie'}</h3><div class="mix">${list.slice(0, 12).map(rowHtml).join('')}</div>` +
      (list.length > 12 ? `<details class="table-view"><summary>Pozostałe elektrownie (${list.length - 12})</summary><div class="mix" style="margin-top:8px">${list.slice(12).map(rowHtml).join('')}</div></details>` : '') +
      `<p class="note">Jednostki wytwórcze centralnie dysponowane (JWCD) — duże jednostki sterowane przez PSE; bez małych źródeł. Na wykresie 8 elektrowni o największej produkcji; ujemne wartości to pompowanie w elektrowniach szczytowo-pompowych. Paliwo: PSE go nie publikuje — przypisane ręcznie według informacji właścicieli elektrowni (stan: wrzesień 2026); podane jest paliwo podstawowe, bez współspalania biomasy w blokach węglowych.${list.some((p) => p.fuel === 'unk') ? ` Bez przypisanego paliwa: ${list.filter((p) => p.fuel === 'unk').map((p) => esc(p.name)).join(', ')}.` : ''}</p>`;
    drawChart('units-fuel', $('#units-fuel-chart'), {
      n: D.n, stacked: true, series: fuelSeriesD, xTicks: D.ticks, height: 240, label: `Moc dużych elektrowni według paliwa${D.unit}`, nowIndex: D.now,
      tooltip: (i, on) => tipRows(D.lab(i), [...fuelSeriesD.slice().reverse().filter((s) => on(s.name) && s.values[i] > 0).map((s) => ({ name: s.name, color: s.color, value: mw(s.values[i]) })), { name: 'Razem', value: mw(fuelSeriesD.reduce((a, s) => a + (s.values[i] ?? 0), 0)) }]),
    });
    drawChart('units', $('#units-chart'), {
      n: D.n, series: seriesD, xTicks: D.ticks, height: 280, label: `Moc największych elektrowni${D.unit}`, nowIndex: D.now,
      tooltip: (i, on) => tipRows(D.lab(i), seriesD.filter((s) => on(s.name)).map((s) => ({ name: s.name, color: s.color, value: mw(s.values[i]) }))),
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
  return { starts, index: new Map(starts.map((t, i) => [t, i])), step, multi: days > 1 };
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
    const grid = baseGrid();
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
    const D = disp(grid);
    const seriesD = series.map((x) => ({ ...x, values: D.down(x.values) }));
    box.innerHTML = '<div class="chart" id="lolp-chart"></div>' +
      table(['Okres', ...seriesD.map((s) => s.name)], D.starts.map((_, i) => [D.lab(i), ...seriesD.map((s) => pct(s.values[i]))])) +
      `<p class="note">LOLP (loss of load probability) — publikowane przez PSE prawdopodobieństwo niedoboru mocy, gdy w systemie pozostaje dana rezerwa. Parametr służy do wyceny rezerw (składnik COR w cenach rynku bilansującego); jest stały w okresach (${esc([...new Set(rows.map((r) => r.ojnz_id))].join(', '))}), publikacja: ${esc(ref.publication_ts?.slice(0, 10) || '—')}.</p>`;
    drawChart('lolp', $('#lolp-chart'), {
      n: D.n, series: seriesD, xTicks: D.ticks, height: 240, label: `Prawdopodobieństwo niedoboru mocy przy danej rezerwie${D.unit}`, nowIndex: D.now,
      yFmt: (v) => `${fmt0.format(v)}%`,
      tooltip: (i, on) => tipRows(D.lab(i), seriesD.filter((s) => on(s.name)).map((s) => ({ name: s.name, color: s.color, value: pct(s.values[i]) }))),
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

// ---------- Rezerwy mocy i ubytki w godzinach szczytu (his-bil-mocy) ----------
// PSE publikuje wykonany bilans mocy dla dwóch szczytów doby: SR (poranny/przedpołudniowy) i SW (wieczorny).
// jg = jednostki aktywnie uczestniczące w rynku bilansującym (JWCD, magazyny, OZE sterowane), prb = pozostałe.
const PEAKS = { SR: 'szczyt poranny', SW: 'szczyt wieczorny' };
const UB_CAUSES = [['rk', 'remonty kapitalne'], ['rs', 'remonty średnie'], ['rb', 'remonty bieżące'], ['ra', 'remonty awaryjne'], ['we', 'warunki eksploatacyjne (m.in. brak wiatru i słońca)'], ['ciep', 'ograniczenia ciepłownicze'], ['inw', 'inwestycje']];
let resPeak = 'SW';
let resHist;
async function renderReserve({ silent = false } = {}) {
  const box = $('#reserve-body');
  const run = begin(box, silent);
  try {
    resHist ??= pse('his-bil-mocy', "business_date ge '2024-01-01'", 5000).catch((e) => { resHist = null; throw e; });
    const all = (await resHist).slice().sort((a, b) => (a.business_date + a.peak < b.business_date + b.peak ? -1 : 1));
    if (run.stale()) return;
    const day = all.filter((r) => r.business_date === date);
    const r = day.find((x) => x.peak === resPeak) || day[0];
    const seg = `<div class="seg" role="group" aria-label="Szczyt">${Object.entries(PEAKS).map(([k, l]) => `<button type="button" data-p="${k}" class="${k === resPeak ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    let dayHtml;
    if (!r) {
      dayHtml = empty('PSE publikuje bilans mocy następnego dnia rano — dla wybranej doby jeszcze go nie ma.');
    } else {
      const causes = UB_CAUSES.map(([k, l]) => ({ l, v: (r[`${k}_jg`] ?? 0) + (r[`${k}_prb`] ?? 0) })).filter((x) => x.v > 0.5).sort((a, b) => b.v - a.v);
      const rows = [
        ['Moc osiągalna wszystkich źródeł', r.pos_sum, 'var(--ink-2)'],
        ['— ubytki mocy', -r.ub_sum, 'var(--exp)'],
        ['= moc dyspozycyjna', r.pdysp_sum, 'var(--ink-2)'],
        ['Obciążenie (praca)', r.obc_sum, 'var(--s2)'],
        ['Rezerwa mocy', r.rez, 'var(--s1)'],
      ];
      const mx = Math.max(...rows.map((x) => Math.abs(x[1] ?? 0)));
      dayHtml = tilesHtml([
        { l: `Rezerwa mocy — ${PEAKS[r.peak]} (${esc(r.peak_hour?.slice(11, 16) || '')})`, v: mw(r.rez), d: `zapotrzebowanie ${mw(r.demand)}` },
        { l: 'Rezerwa wirująca (bloki JWCD w ruchu)', v: mw(r.rez_jgw_wir), d: 'dostępna od razu' },
        { l: 'Rezerwa zimna (bloki JWCD w postoju)', v: mw(r.rez_jgw_zim), d: 'wymaga uruchomienia bloku' },
        { l: 'Ubytki mocy', v: mw(r.ub_sum), d: `${fmt0.format((r.ub_sum / r.pos_sum) * 100)}% mocy osiągalnej` },
      ]) +
        `<div class="util">${rows.map(([l, v, c]) => `<div class="urow"><div class="uname">${l}</div><div class="utrack"><span class="ubar" style="width:${(Math.abs(v ?? 0) / mx) * 100}%;background:${c}"></span></div><div class="uval"><b>${mw(Math.abs(v ?? 0))}</b></div></div>`).join('')}</div>` +
        `<h3 class="sub-h">Przyczyny ubytków mocy</h3><div class="util">${causes.map((x) => `<div class="urow"><div class="uname">${x.l}</div><div class="utrack"><span class="ubar" style="width:${(x.v / causes[0].v) * 100}%;background:var(--exp)"></span></div><div class="uval"><b>${mw(x.v)}</b></div></div>`).join('')}</div>` +
        `<p class="muted small-sum">Rezerwa: wirująca ${mw(r.rez_jgw_wir)}, zimna ${mw(r.rez_jgw_zim)}, elektrownie szczytowo-pompowe i magazyny ${mw(r.rez_jgm)}, OZE sterowane ${mw(r.rez_jgz)}, pozostałe źródła ${mw(r.rez_prb)}. Saldo wymiany z zagranicą: ${r.swm >= 0 ? 'import' : 'eksport'} ${mw(Math.abs(r.swm))}.</p>`;
    }
    // Trend: wybrany szczyt, cała historia API (od czerwca 2024).
    const tr = all.filter((x) => x.peak === resPeak);
    const tDays = tr.map((x) => x.business_date);
    const fD = (iso) => new Intl.DateTimeFormat('pl-PL', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso + 'T00:00:00Z'));
    const ticks = tDays.map((d, i) => ({ i, label: MONTHS[+d.slice(5, 7) - 1] + (d.slice(5, 7) === '01' ? ` ${d.slice(0, 4)}` : '') })).filter((x, k) => k > 0 && tDays[k].slice(0, 7) !== tDays[k - 1].slice(0, 7));
    const sel = tDays.indexOf(date);
    const tSeries = [
      { name: 'Rezerwa mocy ogółem', color: 'var(--ink-2)', values: tr.map((x) => x.rez) },
      { name: 'Rezerwa wirująca JWCD', color: 'var(--s1)', values: tr.map((x) => x.rez_jgw_wir) },
      { name: 'Rezerwa zimna JWCD', color: 'var(--s3)', values: tr.map((x) => x.rez_jgw_zim) },
    ];
    box.innerHTML = seg + dayHtml +
      `<h3 class="sub-h">Rezerwy w ${PEAKS[resPeak].replace('szczyt', 'szczycie').replace('poranny', 'porannym').replace('wieczorny', 'wieczornym')}, ${fD(tDays[0])} – ${fD(tDays[tDays.length - 1])}</h3><div class="chart" id="reserve-trend"></div>` +
      table(['Doba', 'Godzina szczytu', 'Zapotrzebowanie', 'Rezerwa ogółem', 'Wirująca JWCD', 'Zimna JWCD', 'Ubytki'], tr.slice().reverse().slice(0, 120).map((x) => [x.business_date, esc(x.peak_hour?.slice(11, 16) || ''), fmt0.format(x.demand), fmt0.format(x.rez), fmt0.format(x.rez_jgw_wir), fmt0.format(x.rez_jgw_zim), fmt0.format(x.ub_sum)])) +
      '<p class="note">Wykonany bilans mocy KSE w godzinie szczytu (PSE, his-bil-mocy), publikowany następnego dnia. Rezerwa wirująca to wolna moc bloków, które już pracują — mogą ją oddać w ciągu minut; rezerwa zimna to bloki w postoju gotowe do uruchomienia (godziny). Ubytki to moc niedostępna: remonty, ograniczenia ciepłownicze, warunki eksploatacyjne — w tym niedostępność wiatru i PV, gdy nie wieje i nie świeci. PSE nie publikuje samej bezwładności (inercji) systemu.</p>';
    box.querySelector('.seg').addEventListener('click', (e) => { const b = e.target.closest('button[data-p]'); if (!b) return; resPeak = b.dataset.p; renderReserve(); });
    drawChart('reserve-trend', $('#reserve-trend'), {
      n: tr.length, series: tSeries, xTicks: ticks, height: 240, minSpan: 7, nowIndex: sel >= 0 ? sel : null,
      label: 'Rezerwy mocy w godzinie szczytu, MW',
      tooltip: (i, on) => tipRows(`${fD(tDays[i])}, ${esc(tr[i].peak_hour?.slice(11, 16) || '')}`, tSeries.filter((s) => on(s.name)).map((s) => ({ name: s.name, color: s.color, value: mw(s.values[i]) }))),
    }, 'reserve-trend');
    run.restore();
  } catch (e) {
    if (run.stale()) return;
    box.innerHTML = errorBox(e);
  }
}

// ---------- Plan koordynacyjny dobowy: zapas mocy (pdgopkd — PKD z dnia poprzedniego, pdgobpkd — bieżący BPKD) ----------
async function renderPkd({ silent = false } = {}) {
  const box = $('#pkd-body');
  const run = begin(box, silent);
  try {
    const [pkd, bpkd] = await Promise.all([pseDay('pdgopkd', 500), pseDay('pdgobpkd', 500)]);
    if (run.stale()) return;
    if (!pkd.length && !bpkd.length) return void (box.innerHTML = empty('Brak planu PSE dla wybranej doby.'));
    const grid = baseGrid();
    const n = grid.starts.length;
    const f = (rows, k) => {
      const a = new Array(n).fill(null);
      for (const r of rows) { const i = grid.index.get(utc(r.dtime_utc) - Q); if (i != null && r[k] != null) a[i] = r[k]; }
      return a;
    };
    const overP = f(pkd, 'rez_over_demand');
    const overB = f(bpkd, 'rez_over_demand');
    const underP = f(pkd, 'rez_under');
    const underB = f(bpkd, 'rez_under');
    const best = bpkd.length ? bpkd : pkd;
    const dem = f(best, 'kse_pow_dem');
    const wi = f(best, 'gen_wi');
    const pv = f(best, 'gen_fv');
    const ogr = f(best, 'ogr_mwe');
    const minOf = (a) => a.reduce((m, v, i) => (v != null && (m < 0 || v < a[m]) ? i : m), -1);
    const iO = minOf(overB.some((v) => v != null) ? overB : overP);
    const iU = minOf(underB.some((v) => v != null) ? underB : underP);
    const oArr = overB.some((v) => v != null) ? overB : overP;
    const uArr = underB.some((v) => v != null) ? underB : underP;
    const s1 = [{ name: 'Plan dnia poprzedniego (PKD)', color: 'var(--s1)', values: overP }, { name: 'Plan bieżący (BPKD)', color: 'var(--s2)', values: overB }];
    const s2 = [{ name: 'Plan dnia poprzedniego (PKD)', color: 'var(--s1)', values: underP }, { name: 'Plan bieżący (BPKD)', color: 'var(--s2)', values: underB }];
    const D = disp(grid);
    const demD = D.down(dem);
    const wiD = D.down(wi);
    const pvD = D.down(pv);
    const overPD = D.down(overP);
    const overBD = D.down(overB);
    const underPD = D.down(underP);
    const underBD = D.down(underB);
    const s1D = s1.map((x) => ({ ...x, values: D.down(x.values) }));
    const s2D = s2.map((x) => ({ ...x, values: D.down(x.values) }));
    box.innerHTML = tilesHtml([
      iO >= 0 && { l: 'Najmniejszy zapas mocy w górę', v: mw(oArr[iO]), d: period(grid, iO) },
      iU >= 0 && { l: 'Najmniejsza rezerwa w dół', v: mw(uArr[iU]), d: `${period(grid, iU)} — ile można jeszcze zmniejszyć produkcję` },
      { l: 'Planowane ograniczenia dostępności źródeł', v: mw(Math.max(...ogr.filter((v) => v != null), 0)), d: days > 1 ? 'maksimum w okresie' : 'maksimum w dobie' },
    ].filter(Boolean)) +
      '<h3 class="sub-h">Zapas mocy ponad zapotrzebowanie</h3><div class="chart" id="pkd-over"></div>' +
      '<h3 class="sub-h">Rezerwa w dół (poniżej zapotrzebowania)</h3><div class="chart" id="pkd-under"></div>' +
      table(['Okres', 'Zapotrzebowanie', 'Wiatr', 'PV', 'Zapas w górę PKD', 'Zapas w górę BPKD', 'Rezerwa w dół PKD', 'Rezerwa w dół BPKD'], D.starts.map((_, i) => [D.lab(i), ...[demD, wiD, pvD, overPD, overBD, underPD, underBD].map((a) => (a[i] == null ? '—' : fmt0.format(a[i])))])) +
      '<p class="note">Plan koordynacyjny dobowy PSE — wielkości podstawowe (pdgopkd: plan sporządzony dzień wcześniej, pdgobpkd: plan bieżący, aktualizowany w trakcie doby). Zapas w górę to moc, którą źródła mogą jeszcze dołożyć ponad planowane zapotrzebowanie; rezerwa w dół — o ile można zmniejszyć produkcję, gdy energii jest za dużo (mały zapas w dół to typowa przyczyna redukcji OZE i zaleceń zużywania prądu w Kompasie).</p>';
    const common = { n: D.n, xTicks: D.ticks, height: 220, nowIndex: D.now };
    const tip = (series) => (i, on) => tipRows(D.lab(i), [...series.filter((s) => on(s.name)).map((s) => ({ name: s.name, color: s.color, value: mw(s.values[i]) })), { name: 'Zapotrzebowanie', value: mw(demD[i]) }, { name: 'Wiatr + PV', value: mw((wiD[i] ?? 0) + (pvD[i] ?? 0)) }]);
    drawChart('pkd-over', $('#pkd-over'), { ...common, series: s1D, label: `Zapas mocy ponad zapotrzebowanie, MW${D.unit}`, tooltip: tip(s1D) });
    drawChart('pkd-under', $('#pkd-under'), { ...common, series: s2D, label: `Rezerwa mocy w dół, MW${D.unit}`, tooltip: tip(s2D) });
    run.restore();
  } catch (e) {
    if (run.stale()) return;
    box.innerHTML = errorBox(e);
  }
}

// ---------- Ograniczenia i niedostępność bloków (pdwkseub, ogr-oper, unav-pk5l) ----------
const OUT_REASONS = { RA: 'remont awaryjny', RS: 'remont średni', RK: 'remont kapitalny', RB: 'remont bieżący', OS: 'oswajanie inwestycji', WE: 'warunki eksploatacyjne', Q: 'ciepłownictwo' };
async function renderLimits({ silent = false } = {}) {
  const box = $('#limits-body');
  const run = begin(box, silent);
  try {
    const next = addDays(date, 1);
    const [av, ogr, unav] = await Promise.all([
      days > 14 ? Promise.resolve([]) : pseDay('pdwkseub', 5000), // ok. 4 tys. rekordów na dobę
      pseDay('ogr-oper', 2000),
      pseMemo('unav-pk5l', `start_dtime le '${next} 00:00' and end_dtime ge '${from} 00:00'`, 5000),
    ]);
    if (run.stale()) return;
    const grid = baseGrid();
    const n = grid.starts.length;
    // Dostępna moc według paliwa (paliwo z PLANT_FUEL, jak w sekcji elektrowni).
    const byFuel = new Map();
    const unit = new Map();
    const nonUs = new Array(n).fill(null);
    const gridLim = new Array(n).fill(null);
    for (const r of av) {
      const i = grid.index.get(utc(r.dtime_utc) - Q);
      if (i == null) continue;
      const fuel = plantFuel(r.power_plant);
      if (!byFuel.has(fuel)) byFuel.set(fuel, new Array(n).fill(null));
      byFuel.get(fuel)[i] = (byFuel.get(fuel)[i] ?? 0) + (r.non_us_cap ?? 0) + (r.grid_lim ?? 0);
      nonUs[i] = (nonUs[i] ?? 0) + (r.non_us_cap ?? 0);
      gridLim[i] = (gridLim[i] ?? 0) + (r.grid_lim ?? 0);
      const u = unit.get(r.resource_code) || { plant: r.power_plant, code: r.resource_code, avail: 0, non: 0, grid: 0, k: 0, maxNon: 0 };
      u.avail += r.available_capacity ?? 0; u.non += r.non_us_cap ?? 0; u.grid += r.grid_lim ?? 0; u.k++; u.maxNon = Math.max(u.maxNon, r.non_us_cap ?? 0);
      unit.set(r.resource_code, u);
    }
    const fuels = Object.keys(FUELS).filter((f) => byFuel.has(f) && byFuel.get(f).some((v) => v > 0));
    const avSeries = fuels.map((f) => ({ name: FUELS[f].name, color: FUELS[f].color, values: byFuel.get(f) }));
    const avg = (a) => { const x = a.filter((v) => v != null); return x.length ? x.reduce((s, v) => s + v, 0) / x.length : null; };
    const units = [...unit.values()].map((u) => ({ ...u, avail: u.avail / u.k, non: u.non / u.k, grid: u.grid / u.k }));
    const topGrid = units.filter((u) => u.grid > 0.5).sort((a, b) => b.grid - a.grid);
    // Postoje: aktywne zgłoszenia (AK), ostatnia wersja każdego zgłoszenia.
    const outMap = new Map();
    for (const o of unav) {
      if (o.state !== 'AK') continue;
      const prev = outMap.get(o.mrid_zas);
      if (!prev || prev.publication_ts < o.publication_ts) outMap.set(o.mrid_zas, o);
    }
    const outs = [...outMap.values()].sort((a, b) => (a.power_plant + a.unit_code < b.power_plant + b.unit_code ? -1 : 1));
    const unitMw = (code) => unit.get(code)?.maxNon;
    const outByReason = Object.entries(OUT_REASONS).map(([k, l]) => ({ l, k, list: outs.filter((o) => o.reason === k) })).filter((x) => x.list.length);
    const fDT = (s) => (s ? `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)} ${s.slice(11, 16)}` : '—');
    const ogrRows = ogr.slice().sort((a, b) => (a.from_dtime < b.from_dtime ? -1 : 1));
    const D = disp(grid);
    const nonUsD = D.down(nonUs);
    const gridLimD = D.down(gridLim);
    const avSeriesD = avSeries.map((x) => ({ ...x, values: D.down(x.values) }));
    box.innerHTML = (av.length ? tilesHtml([
      { l: 'Bloki ze zgłoszonymi ubytkami', v: `${unit.size}`, d: `w ${new Set(units.map((u) => u.plant)).size} elektrowniach` },
      { l: 'Ubytki elektrowniane', v: mw(avg(nonUsD)), d: 'średnio: remonty, awarie, ograniczenia techniczne' },
      { l: 'Ubytki sieciowe', v: mw(avg(gridLimD)), d: 'średnio: moc, której nie da się wyprowadzić przez sieć' },
      { l: 'Postoje bloków', v: `${outs.length}`, d: outByReason.map((x) => `${x.l}: ${x.list.length}`).join(', ') },
    ]) +
      '<h3 class="sub-h">Ubytki mocy (elektrowniane + sieciowe) według paliwa</h3><div class="chart" id="limits-av"></div>' +
      (topGrid.length ? `<h3 class="sub-h">Bloki ograniczane przez sieć</h3><div class="util">${topGrid.slice(0, 12).map((u) => `<div class="urow"><div class="uname"><i class="sw" style="background:${FUELS[plantFuel(u.plant)].color}"></i>${esc(u.plant)} <span class="muted">· ${esc(u.code)}</span></div><div class="utrack"><span class="ubar" style="width:${(u.grid / topGrid[0].grid) * 100}%;background:var(--exp)"></span></div><div class="uval"><b>${mw(u.grid)}</b> <span class="muted">średnio</span></div></div>`).join('')}</div>` : '') : empty(days > 14 ? 'Ubytki poszczególnych jednostek pokazujemy dla zakresu do 14 dni (ok. 4 tys. rekordów na dobę); poniżej ograniczenia i postoje w całym okresie.' : 'Brak danych o dostępności jednostek dla wybranego okresu.')) +
      `<h3 class="sub-h">Ograniczenia pracy bloków nałożone przez PSE (${ogrRows.length})</h3>` +
      (ogrRows.length ? table(['Od', 'Do', 'Bloki', 'Kierunek', 'Min. liczba bloków', 'Min. moc [MW]', 'Maks. liczba bloków', 'Maks. moc [MW]', 'Przyczyna', 'Element ograniczający'], ogrRows.map((o) => [fDT(o.from_dtime), fDT(o.to_dtime), esc(o.resource_code || o.resource_name || ''), esc(o.direction || ''), o.pol_min_power_of_unit_plant ?? '—', o.pol_min_power_of_unit == null ? '—' : fmt0.format(o.pol_min_power_of_unit), o.pol_max_power_of_unit ?? '—', o.pol_max_power_of_unit_plant == null ? '—' : fmt0.format(o.pol_max_power_of_unit_plant), esc(o.add_cond || ''), esc(o.limiting_element || '')])).replace('<details class="table-view">', '<details class="table-view" open>') : `<p class="muted">Brak ograniczeń operacyjnych ${days > 1 ? 'w okresie' : 'w tej dobie'}.</p>`) +
      `<h3 class="sub-h">Postoje bloków ${days > 1 ? 'w okresie' : 'w tej dobie'} (${outs.length})</h3>` +
      (outs.length ? table(['Elektrownia', 'Blok', 'Paliwo', 'Przyczyna', 'Od', 'Do', 'Ubytek [MW]'], outs.map((o) => [esc(o.power_plant), esc(o.unit_code), FUELS[plantFuel(o.power_plant)].name, OUT_REASONS[o.reason] || esc(o.reason), fDT(o.start_dtime), fDT(o.end_dtime), unitMw(o.unit_code) ? fmt0.format(unitMw(o.unit_code)) : '—'])) : '<p class="muted">Brak zgłoszonych postojów.</p>') +
      '<p class="note">Ubytki jednostek (PSE, pdwkseub): ubytki elektrowniane (remonty, awarie, ograniczenia techniczne) i sieciowe (moc, której sieć nie jest w stanie przyjąć) co 15 minut — PSE podaje tu tylko jednostki, które zgłosiły ubytki, więc suma „dostępnych zdolności” z tego raportu nie jest mocą całego systemu (tę pokazuje sekcja „Rezerwy mocy i ubytki”). Ograniczenia operacyjne (ogr-oper): wymagania PSE co do liczby pracujących bloków i ich mocy w danym węźle sieci — np. minimalna liczba bloków, które muszą pracować, żeby utrzymać napięcia i niezawodność pracy KSE (kierunek „G/P” jak w raporcie PSE). Postoje (unav-pk5l): aktywne zgłoszenia remontów i niedostępności w planie koordynacyjnym; ubytek w MW to największa deklarowana niedostępność bloku w tej dobie.</p>';
    if (av.length) drawChart('limits-av', $('#limits-av'), {
      n: D.n, stacked: true, series: avSeriesD, xTicks: D.ticks, height: 240, label: `Ubytki mocy dużych jednostek według paliwa, MW${D.unit}`, nowIndex: D.now,
      tooltip: (i, on) => tipRows(D.lab(i), [...avSeriesD.slice().reverse().filter((s) => on(s.name) && s.values[i] > 0).map((s) => ({ name: s.name, color: s.color, value: mw(s.values[i]) })), { name: 'Ubytki elektrowniane', value: mw(nonUsD[i]) }, { name: 'Ubytki sieciowe', value: mw(gridLimD[i]) }]),
    });
    run.restore();
  } catch (e) {
    if (run.stale()) return;
    box.innerHTML = errorBox(e);
  }
}

// ---------- Rynek bilansujący: uruchomiona energia i zakupione rezerwy (eb-rozl, mbp-tp + mbu-tu, cmbp-tp) ----------
const RES_TYPES = [['fcr', 'FCR (regulacja pierwotna)', 'var(--s1)'], ['afrr', 'aFRR (automatyczna wtórna)', 'var(--s2)'], ['mfrrd', 'mFRR (ręczna)', 'var(--s3)'], ['rr', 'RR (rezerwa zastępcza)', 'var(--s4)']];
async function renderBalAct({ silent = false } = {}) {
  const box = $('#balact-body');
  const run = begin(box, silent);
  try {
    // Rezerwy kupowane są w trybie podstawowym (mbp-tp, dzień wcześniej, godzinowo) i uzupełniającym (mbu-tu, kwadransowo).
    const [eb, mbu, mbp, cmbp] = await Promise.all([pseDay('eb-rozl', 500), pseDay('mbu-tu', 500), pseDay('mbp-tp', 100), pseDay('cmbp-tp', 100)]);
    if (run.stale()) return;
    const grid = baseGrid();
    const n = grid.starts.length;
    const f = (rows, k, sign = 1) => {
      const a = new Array(n).fill(null);
      for (const r of rows) { const i = grid.index.get(utc(r.dtime_utc) - Q); if (i != null && r[k] != null) a[i] = sign * r[k]; }
      return a;
    };
    const sumE = (a) => a.reduce((s, v) => s + (v ?? 0), 0);
    // Dane godzinowe (dtime_utc = koniec godziny) rozkładamy na kwadranse tej godziny.
    const fh = (rows, k, sign = 1) => {
      const byH = new Map(rows.map((r) => [utc(r.dtime_utc) - HOUR, r[k]]));
      return grid.starts.map((t) => { const v = byH.get(t - (t % HOUR)); return v == null ? null : sign * v; });
    };
    const tot = (k, sign = 1) => { const a = fh(mbp, k, sign); const b = f(mbu, k, sign); return a.map((v, i) => (v == null && b[i] == null ? null : (v ?? 0) + (b[i] ?? 0))); };
    const mbuAll = mbp.length || mbu.length;
    const up = f(eb, 'eb_d_pp');
    const down = f(eb, 'eb_w_pp');
    const aUp = f(eb, 'eb_afrrg');
    const aDown = f(eb, 'eb_afrrd');
    const ebSeries = [
      { name: 'Energia bilansująca dostarczona (w górę)', color: 'var(--s2)', values: up },
      { name: 'Energia bilansująca odebrana (w dół)', color: 'var(--s1)', values: down },
      { name: 'w tym aFRR w górę', color: 'var(--s4)', values: aUp },
      { name: 'w tym aFRR w dół', color: 'var(--s3)', values: aDown },
    ];
    const capSeries = RES_TYPES.flatMap(([k, l, c]) => [{ name: `${l} ↑`, color: c, values: tot(`${k}_g`) }, { name: `${l} ↓`, color: c, values: tot(`${k}_d`, -1) }]).filter((x) => x.values.some((v) => v));
    const priceSeries = RES_TYPES.map(([k, l, c]) => ({ name: `${l} ↑`, color: c, values: fh(cmbp, `${k}_g`) })).filter((x) => x.values.some((v) => v != null));
    const avgUp = (k) => sumE(tot(`${k}_g`)) / n;
    const hasEb = eb.length > 0;
    const D = disp(grid);
    const upD = D.down(up);
    const downD = D.down(down);
    const aUpD = D.down(aUp);
    const aDownD = D.down(aDown);
    const ebSeriesD = ebSeries.map((x) => ({ ...x, values: D.down(x.values) }));
    const capSeriesD = capSeries.map((x) => ({ ...x, values: D.down(x.values) }));
    const priceSeriesD = priceSeries.map((x) => ({ ...x, values: D.down(x.values) }));
    box.innerHTML = tilesHtml([
      hasEb && { l: 'Energia bilansująca w górę', v: `${fmt0.format(sumE(up))} MWh`, d: `w tym aFRR ${fmt0.format(sumE(aUp))} MWh` },
      hasEb && { l: 'Energia bilansująca w dół', v: `${fmt0.format(Math.abs(sumE(down)))} MWh`, d: `w tym aFRR ${fmt0.format(Math.abs(sumE(aDown)))} MWh` },
      mbuAll && { l: 'Zakupione rezerwy w górę (średnio)', v: mw(RES_TYPES.reduce((s, [k]) => s + avgUp(k), 0)), d: RES_TYPES.filter(([k]) => avgUp(k) > 0.5).map(([k, l]) => `${l.split(' ')[0]} ${fmt0.format(avgUp(k))}`).join(' · ') + ' MW' },
    ].filter(Boolean)) +
      `<h3 class="sub-h">Uruchomiona energia bilansująca, MWh w kwadransie${D.same ? '' : ' (średnio)'}</h3>${hasEb ? '<div class="chart" id="balact-eb"></div>' : '<p class="muted">Dane rozliczeniowe PSE publikuje z opóźnieniem 1–2 dni.</p>'}` +
      `<h3 class="sub-h">Zakupione rezerwy mocy bilansującej, MW</h3>${mbuAll ? '<div class="chart" id="balact-cap"></div>' : '<p class="muted">Brak danych.</p>'}` +
      `<h3 class="sub-h">Cena zakupu rezerw w górę (tryb podstawowy), zł/MW/h</h3>${cmbp.length ? '<div class="chart" id="balact-price"></div>' : '<p class="muted">Brak danych.</p>'}` +
      table(['Okres', 'EB w górę', 'EB w dół', 'aFRR w górę', 'aFRR w dół', ...capSeriesD.map((x) => `${x.name.split(' ')[0]} ${x.name.endsWith('↑') ? '↑' : '↓'} [MW]`)], D.starts.map((_, i) => [D.lab(i), ...[upD, downD, aUpD, aDownD].map((a) => (a[i] == null ? '—' : fmt0.format(a[i]))), ...capSeriesD.map((s) => (s.values[i] == null ? '—' : fmt0.format(Math.abs(s.values[i]))))])) +
      '<p class="note">Energia bilansująca (PSE, eb-rozl) — ile energii PSE faktycznie „przywołało” w każdym kwadransie: dostarczonej (zwiększenie produkcji lub zmniejszenie poboru) i odebranej (odwrotnie), w tym przez automatyczną regulację aFRR; dane rozliczeniowe z opóźnieniem. Rezerwy — moc bilansująca zakupiona w trybie podstawowym (mbp-tp, aukcja dzień wcześniej, godzinowo) i uzupełniającym (mbu-tu, kwadransowo); na wykresie suma obu. Cena to cena zakupu w trybie podstawowym (cmbp-tp). FCR stabilizuje częstotliwość w sekundach, aFRR automatycznie w minutach, mFRR na polecenie dyspozytora, RR zastępuje wykorzystane rezerwy. Wezwania z rynku mocy (okresy zagrożenia) PSE ogłasza komunikatami — nie ma ich w API.</p>';
    const common = { n: D.n, xTicks: D.ticks, nowIndex: D.now };
    const tip = (series, unit) => (i, on) => tipRows(D.lab(i), series.filter((s) => on(s.name)).map((s) => ({ name: s.name, color: s.color, value: s.values[i] == null ? '—' : `${fmt0.format(Math.abs(s.values[i]))} ${unit}` })));
    if (hasEb) drawChart('balact-eb', $('#balact-eb'), { ...common, series: ebSeriesD, step: true, height: 240, label: 'Uruchomiona energia bilansująca, MWh', tooltip: tip(ebSeriesD, 'MWh') });
    if (mbuAll) drawChart('balact-cap', $('#balact-cap'), { ...common, series: capSeriesD, step: true, height: 240, label: `Zakupione rezerwy mocy bilansującej (w dół ujemne), MW${D.unit}`, tooltip: tip(capSeriesD, 'MW') });
    if (cmbp.length) drawChart('balact-price', $('#balact-price'), { ...common, series: priceSeriesD, step: true, height: 200, label: 'Cena zakupu rezerw w górę, zł/MW/h', tooltip: tip(priceSeriesD, 'zł/MW/h') });
    run.restore();
  } catch (e) {
    if (run.stale()) return;
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
  renderKompas();
  renderLoad();
  renderBalance();
  renderUtil();
  renderPrices();
  renderCurt();
  renderFcst();
  renderUnits();
  renderPlan();
  renderLolp();
  renderReserve();
  renderPkd();
  renderLimits();
  renderBalAct();
  renderGen();
  renderRce();
}

$('#prev').addEventListener('click', () => setRange(addDays(date, -days)));
$('#next').addEventListener('click', () => setRange(addDays(date, days)));
$('#today').addEventListener('click', () => setRange(todayIso()));
$('#date').addEventListener('change', (e) => e.target.value && setRange(e.target.value));
$('#days').addEventListener('change', (e) => setRange(date, +e.target.value));
$('#one-day').addEventListener('click', () => setRange(date, 1));


initTheme();
initInstall();
initCountry();
renderAlert();
// Zakładki: dane dzienne ładujemy od razu (domyślny widok i odświeżanie), miesięczne i roczne — przy pierwszym otwarciu.
initTabs({
  d: () => { setRange(date, days); renderNow(); renderCo2(); },
  m: () => { renderRcem(); renderMix(); },
  r: () => { renderElecYear(); renderRenYear(); renderBills(); },
});

// Odświeżanie: bilans co minutę, dane doby co 5 minut (gdy oglądamy dziś).
setInterval(renderNow, 60e3);
setInterval(() => {
  if (from <= todayIso() && todayIso() <= date) {
    const silent = { silent: true };
    forgetToday();
    renderLoad(silent);
    renderBalance(silent);
    renderUtil(silent);
    renderPrices(silent);
    renderCurt(silent);
    renderFcst(silent);
    renderUnits(silent);
    renderGen(silent);
    renderKompas(silent);
    renderRce(silent);
    renderPkd(silent);
    renderLimits(silent);
    renderBalAct(silent);
  }
}, 5 * 60e3);
