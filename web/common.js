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
