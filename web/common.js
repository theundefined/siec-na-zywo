// Wspólne elementy stron „Prąd” i „Gaz”: pobieranie danych, czas, formatowanie, tabele, wykresy, motyw.
import { chart, fmt0 } from './charts.js';

// ---------- Źródła danych ----------
export const PSE_HOSTS = [
  'https://api.raporty.pse.pl/api',
  'https://apimpdv2-bmgdhhajexe8aade.a01.azurefd.net/api', // lustro używane przez aplikację
];
export const FILES = 'https://files.energetycznykompas.pl/datafile';

export async function pse(endpoint, filter, first = 5000, select = '') {
  const q = `${endpoint}?$filter=${encodeURIComponent(filter)}&$first=${first}${select ? `&$select=${select}` : ''}`;
  let err;
  for (const host of PSE_HOSTS) {
    try {
      const r = await fetch(`${host}/${q}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      return j.value || [];
    } catch (e) {
      err = e;
    }
  }
  throw err;
}

// ---------- Czas (Europe/Warsaw) ----------
export const TZ = 'Europe/Warsaw';
export const HOUR = 60 * 60e3;
export const fKey = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export const warsaw = (t) => fKey.format(t); // "YYYY-MM-DD HH:MM"
export const todayIso = () => warsaw(Date.now()).slice(0, 10);
export function addDays(iso, n) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export const MONTHS = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];

// ---------- Pomocnicze ----------
export const $ = (s) => document.querySelector(s);
// Odmiana liczebników: plural(5, ['blok', 'bloki', 'bloków']).
export const plural = (n, [one, few, many]) => (n === 1 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? few : many);
export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
export const mw = (v) => (v == null ? '—' : `${fmt0.format(v)} MW`);
export const errorBox = (e) => `<p class="state error">Nie udało się pobrać danych (${esc(e.message || e)}). Spróbuj odświeżyć.</p>`;
export const empty = (msg) => `<p class="state">${msg}</p>`;

export function table(head, rows) {
  return `<details class="table-view"><summary>Tabela danych</summary><div class="table-scroll"><table><thead><tr>${head
    .map((h) => `<th>${h}</th>`)
    .join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details>`;
}

export function tilesHtml(tiles) {
  return `<div class="tiles">${tiles.filter(Boolean).map((t) => `<div class="tile"><div class="tl">${t.l}</div><div class="tv">${t.v}</div>${t.d ? `<div class="td">${t.d}</div>` : ''}</div>`).join('')}</div>`;
}

// ---------- Wykresy ----------
// Wykresy są przerysowywane przy zmianie szerokości okna.
// Stan wykresów: ukryte serie pamiętane per wykres, zakres powiększenia wspólny dla wykresów danej grupy
// (wykresy o tej samej osi czasu powiększają się razem).
export const redraws = new Map();
export const chartStates = new Map();
export const views = new Map();
export function drawChart(key, container, opts, group = 'day') {
  if (!chartStates.has(key)) chartStates.set(key, { hidden: new Set() });
  const o = {
    ...opts,
    state: chartStates.get(key),
    view: () => views.get(group) || null,
    setView: (v) => {
      views.set(group, v);
      redraws.forEach((d) => d.group === group && d());
    },
  };
  const draw = () => chart(container, o);
  draw.group = group;
  redraws.set(key, draw);
  draw();
}
let rt;
let lastW = window.innerWidth;
window.addEventListener('resize', () => {
  if (window.innerWidth === lastW) return;
  lastW = window.innerWidth;
  clearTimeout(rt);
  rt = setTimeout(() => redraws.forEach((d) => d()), 150);
});

// ---------- Przełącznik motywu (auto → jasny → ciemny) ----------
const themes = ['auto', 'light', 'dark'];
const themeNames = { auto: 'Motyw: auto', light: 'Motyw: jasny', dark: 'Motyw: ciemny' };
let theme = 'auto';
function applyTheme(t) {
  if (t === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  $('#theme').textContent = themeNames[t];
  try { localStorage.setItem('theme', t); } catch { /* brak dostępu do localStorage */ }
}
export function initTheme() {
  try { theme = localStorage.getItem('theme') || 'auto'; } catch { /* j.w. */ }
  applyTheme(theme);
  $('#theme').addEventListener('click', () => applyTheme((theme = themes[(themes.indexOf(theme) + 1) % 3])));
}

// ---------- Instalacja jako aplikacja (PWA) ----------
// Chrome/Edge/Samsung Internet: systemowe okno instalacji (beforeinstallprompt).
// iOS/iPadOS i przeglądarki bez tego zdarzenia: przycisk pokazuje instrukcję (tylko na urządzeniach dotykowych).
export function initInstall() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { /* bez SW strona działa normalnie */ });
  const btn = $('#install');
  const help = $('#install-help');
  if (!btn || !help) return;
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  if (standalone) return;
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const touch = matchMedia('(pointer: coarse)').matches;
  let deferred = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    btn.hidden = false;
  });
  window.addEventListener('appinstalled', () => { deferred = null; btn.hidden = true; help.hidden = true; });
  if (ios || touch) btn.hidden = false;
  const steps = ios
    ? ['Stuknij przycisk <b>Udostępnij</b> <span aria-hidden="true">(kwadrat ze strzałką)</span> na pasku Safari.', 'Wybierz <b>Do ekranu początkowego</b>.', 'Potwierdź przyciskiem <b>Dodaj</b>.']
    : /Firefox/.test(ua)
      ? ['Otwórz menu przeglądarki <b>⋮</b>.', 'Wybierz <b>Zainstaluj</b> albo <b>Dodaj do ekranu głównego</b>.']
      : ['Otwórz menu przeglądarki <b>⋮</b>.', 'Wybierz <b>Zainstaluj aplikację</b> albo <b>Dodaj do ekranu głównego</b>.'];
  btn.addEventListener('click', async () => {
    if (deferred) {
      deferred.prompt();
      const { outcome } = await deferred.userChoice;
      if (outcome === 'accepted') btn.hidden = true;
      deferred = null;
      return;
    }
    $('#install-help-body').innerHTML = `<ol>${steps.map((s) => `<li>${s}</li>`).join('')}</ol>${ios ? '<p class="muted">Na iPhonie i iPadzie działa to tylko w Safari.</p>' : ''}`;
    help.hidden = false;
    $('#install-help-close').focus();
  });
  $('#install-help-close').addEventListener('click', () => { help.hidden = true; btn.focus(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !help.hidden) { help.hidden = true; btn.focus(); } });
}

// ---------- Eurostat (oficjalna statystyka UE, CORS *, licencja CC BY 4.0) ----------
export const EUROSTAT = 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data';
// Eurostat odrzuca zbyt wiele równoczesnych zapytań (odpowiedź bez nagłówka CORS → „Failed to fetch”),
// więc wysyłamy najwyżej dwa naraz i ponawiamy nieudane.
let esActive = 0;
const esWaiting = [];
async function esQueue(url) {
  if (esActive >= 2) await new Promise((res) => esWaiting.push(res));
  esActive++;
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await fetch(url);
        if (!r.ok) throw new Error(`Eurostat: HTTP ${r.status}`);
        return await r.json();
      } catch (e) {
        if (attempt >= 2) throw e;
        await new Promise((res) => setTimeout(res, 1500 * (attempt + 1)));
      }
    }
  } finally {
    esActive--;
    esWaiting.shift()?.();
  }
}

// Zwraca {get(sel), times, codes(dim), updated}; sel = {wymiar: kod}, pominięte wymiary = pierwszy kod.
export async function eurostat(dataset, params) {
  const q = new URLSearchParams({ lang: 'en' });
  for (const [k, v] of Object.entries(params)) for (const x of [].concat(v)) q.append(k, x);
  const d = await esQueue(`${EUROSTAT}/${dataset}?${q}`);
  // JSON-stat: wartości w płaskiej tablicy indeksowanej iloczynem wymiarów.
  const stride = d.size.map((_, i) => d.size.slice(i + 1).reduce((a, b) => a * b, 1));
  const pos = (dim, code) => d.dimension[dim].category.index[code];
  const get = (sel) => {
    let k = 0;
    for (const [i, dim] of d.id.entries()) {
      const p = sel[dim] != null ? pos(dim, sel[dim]) : 0;
      if (p == null) return null;
      k += p * stride[i];
    }
    return d.value[k] ?? null;
  };
  const codes = (dim) => Object.keys(d.dimension[dim].category.index);
  const times = codes('time').sort();
  return { get, times, codes, updated: d.updated };
}

// Kraje UE po polsku (kody Eurostatu).
export const EU_NAMES = { EU27_2020: 'UE-27', BE: 'Belgia', BG: 'Bułgaria', CZ: 'Czechy', DK: 'Dania', DE: 'Niemcy', EE: 'Estonia', IE: 'Irlandia', EL: 'Grecja', ES: 'Hiszpania', FR: 'Francja', HR: 'Chorwacja', IT: 'Włochy', CY: 'Cypr', LV: 'Łotwa', LT: 'Litwa', LU: 'Luksemburg', HU: 'Węgry', MT: 'Malta', NL: 'Holandia', AT: 'Austria', PL: 'Polska', PT: 'Portugalia', RO: 'Rumunia', SI: 'Słowenia', SK: 'Słowacja', FI: 'Finlandia', SE: 'Szwecja' };

// ---------- Podzakładki: dane dzienne / miesięczne / roczne ----------
// Sekcje i linki spisu treści mają data-view="d|m|r"; zakładka w parametrze ?v= (hash zajmują kotwice sekcji).
// onShow[v] wywoływane przy pierwszym otwarciu zakładki (dane ładowane dopiero wtedy).
export const VIEWS = { d: 'Dzienne', m: 'Miesięczne', r: 'Roczne' };
export function initTabs(onShow) {
  const nav = $('#views');
  let v = new URLSearchParams(location.search).get('v');
  if (!VIEWS[v]) v = 'd';
  const shown = new Set();
  nav.innerHTML = Object.entries(VIEWS).map(([k, l]) => `<button type="button" role="tab" data-v="${k}">${l}</button>`).join('');
  const show = (nv) => {
    v = nv;
    nav.querySelectorAll('button').forEach((b) => { const on = b.dataset.v === v; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
    document.querySelectorAll('[data-view]').forEach((el) => { el.hidden = !el.dataset.view.split(' ').includes(v); });
    const url = new URL(location.href);
    if (v === 'd') url.searchParams.delete('v');
    else url.searchParams.set('v', v);
    history.replaceState(null, '', url);
    if (!shown.has(v)) { shown.add(v); onShow[v]?.(); }
    // Wykresy narysowane w ukrytej zakładce mają złą szerokość — przerysowujemy po pokazaniu.
    requestAnimationFrame(() => redraws.forEach((d) => d()));
  };
  nav.addEventListener('click', (e) => { const b = e.target.closest('button[data-v]'); if (b && b.dataset.v !== v) show(b.dataset.v); });
  show(v);
  return () => v;
}

// Usuwa przerysowania wykresów z podanych grup (np. przy zmianie dnia), zostawiając pozostałe zakładki.
export function clearGroups(...groups) {
  for (const [k, d] of redraws) if (groups.includes(d.group)) redraws.delete(k);
  groups.forEach((g) => views.delete(g));
}

// Przełącznik zakresu dla wykresów miesięcznych: ostatnie N miesięcy albo całość (ustawia wspólny widok grupy).
export function rangeSeg(group, n, key) {
  const opts = [[24, '2 lata'], [60, '5 lat'], [0, 'całość']];
  let sel = 24;
  try { sel = +(localStorage.getItem(`range-${key}`) ?? 24); } catch { /* brak localStorage */ }
  const apply = (m) => {
    sel = m;
    views.set(group, m && m < n ? [n - m, n] : null);
    try { localStorage.setItem(`range-${key}`, m); } catch { /* j.w. */ }
  };
  apply(sel);
  const html = `<div class="seg" role="group" aria-label="Zakres" data-range="${key}">${opts.map(([m, l]) => `<button type="button" data-m="${m}" class="${m === sel ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  const bind = (box) => box.querySelector(`[data-range="${key}"]`)?.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-m]');
    if (!b) return;
    apply(+b.dataset.m);
    b.parentElement.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    redraws.forEach((d) => d.group === group && d());
  });
  return { html, bind };
}

// Wybór roku (select); zwraca HTML i funkcję podpinającą zdarzenie.
export function yearSelect(id, years, sel) {
  return `<label class="year-sel">Rok: <select id="${id}">${years.slice().reverse().map((y) => `<option value="${y}"${y === sel ? ' selected' : ''}>${y}</option>`).join('')}</select></label>`;
}

// ---------- Świeżość danych ----------
// Ostrzeżenie, gdy dane są starsze niż zwykle dla danego źródła (np. padł workflow albo źródło przestało publikować).
// asOf: 'RRRR-MM-DD', 'RRRR-MM' (koniec miesiąca) albo 'RRRR' (koniec roku); maxDays — normalne opóźnienie źródła.
export function asOfDate(asOf) {
  const [y, m, d] = String(asOf).split('-').map(Number);
  if (d) return Date.UTC(y, m - 1, d);
  if (m) return Date.UTC(y, m, 0);
  return Date.UTC(y, 11, 31);
}
export function staleNote({ what, asOf, maxDays, fetched, fetchedMaxHours = 30, stale, at, maxMinutes }) {
  const msgs = [];
  if (at != null && maxMinutes != null) {
    const min = Math.floor((Date.now() - at) / 6e4);
    if (min > maxMinutes) msgs.push(`dane ${what} są sprzed ${min >= 120 ? `${Math.floor(min / 60)} godz.` : `${min} min`} — zwykle odświeżają się częściej; źródło mogło przestać publikować`);
  }
  if (asOf != null) {
    const age = Math.floor((Date.now() - asOfDate(asOf)) / 864e5);
    if (age > maxDays) msgs.push(`najnowsze dane ${what} są z ${asOf} (${age} dni temu) — zwykle nie starsze niż ${maxDays} dni; źródło mogło przestać publikować`);
  }
  if (fetched) {
    const h = (Date.now() - Date.parse(fetched)) / 36e5;
    if (h > fetchedMaxHours) msgs.push(`plik z danymi ${what} nie był odświeżany od ${Math.floor(h / 24)} dni (automatyczne pobieranie mogło przestać działać)`);
  }
  if (stale) msgs.push(`ostatnia próba odświeżenia danych ${what} nie powiodła się — pokazujemy poprzednią kopię`);
  return msgs.length ? `<p class="warn-box">⚠ ${esc(msgs.join('; '))}.</p>` : '';
}
