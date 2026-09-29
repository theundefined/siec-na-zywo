// Sekcje strony „Prąd” oparte na statystyce Eurostatu (miesięcznej, półrocznej i rocznej) — niezależne od wybranego dnia.
// Kraj wybiera się w zakładkach „Miesięczne” i „Roczne” (GEO z common.js; domyślnie Polska).
import { tipRows, fmt0, fmt2 } from './charts.js';
import { $, eurostat, EU_NAMES, MONTHS, esc, errorBox, empty, table, tilesHtml, drawChart, rangeSeg, yearSelect, staleNote, GEO, GEO_NAME, CUR, CUR_SYM } from './common.js';

const twh = (v) => (v == null ? '—' : `${fmt2.format(v)} TWh`);
const pc = (v) => (v == null ? '—' : `${fmt0.format(v)}%`);
const mLabel = (t) => `${MONTHS[+t.slice(5, 7) - 1]} ${t.slice(0, 4)}`;
const yearTicks = (times) => times.map((t, i) => ({ i, label: t.slice(0, 4), at: 'center' })).filter((x, k) => k === 0 || times[k].slice(0, 4) !== times[k - 1].slice(0, 4));
const sinceYears = (n) => String(new Date().getUTCFullYear() - n);
const noData = (what) => empty(`Eurostat nie publikuje danych ${what} dla kraju: ${esc(GEO_NAME)}.`);
// Serie z samymi zerami (np. atom w Polsce) nie trafiają na wykres ani do legendy.
const nonEmpty = (series) => series.filter((s) => s.values.some((v) => Math.abs(v ?? 0) > 0.0005));

// ---------- Miks energetyczny miesięcznie (nrg_cb_pem, nrg_cb_em) ----------
// Grupy sumują się do produkcji netto ogółem (TOTAL). Kolory jak w „Dobowej strukturze generacji”; atom — róż (--s5).
const MIX = [
  { id: 'coal', name: 'Węgiel (kamienny i brunatny)', color: 'var(--g-wk)', codes: ['C0000'] },
  { id: 'gas', name: 'Gaz ziemny', color: 'var(--g-gaz)', codes: ['G3000'] },
  { id: 'oth', name: 'Inne paliwa (olej, odpady)', color: 'var(--ink-2)', codes: ['CF_NR_OTH', 'X9900'] },
  { id: 'nuc', name: 'Energia jądrowa', color: 'var(--s5)', codes: ['N9000'] },
  { id: 'hyd', name: 'Woda (z elektrowniami szczytowo-pompowymi)', color: 'var(--g-woda)', codes: ['RA100'] },
  { id: 'won', name: 'Wiatr lądowy', color: 'var(--g-wl)', codes: ['RA310'] },
  { id: 'wof', name: 'Wiatr morski', color: 'var(--g-wm)', codes: ['RA320'] },
  { id: 'pv', name: 'Fotowoltaika', color: 'var(--g-pv)', codes: ['RA420', 'RA410'] },
  { id: 'bio', name: 'Biomasa, biogaz i inne OZE', color: 'var(--g-bio)', codes: ['CF_R', 'RA200', 'RA500_5160'] },
];
const REN = [['REN_ELC', 'Prąd', 'var(--s1)'], ['REN', 'Cała energia (cel UE)', 'var(--s2)'], ['REN_HEAT_CL', 'Ciepło i chłód', 'var(--s3)'], ['REN_TRA', 'Transport', 'var(--s4)']];

export async function renderMix() {
  const box = $('#mix-body');
  try {
    const [pem, em] = await Promise.all([
      eurostat('nrg_cb_pem', { geo: GEO, unit: 'GWH', sinceTimePeriod: '2016-01' }),
      eurostat('nrg_cb_em', { geo: GEO, siec: 'E7000', unit: 'GWH', sinceTimePeriod: '2016-01' }),
    ]);
    // Pomijamy miesiące bez pełnego zestawu paliw (np. w 2016 r. Eurostat ma dla Polski tylko energię wodną).
    const months = pem.times.filter((t) => pem.get({ siec: 'TOTAL', time: t }) != null && pem.get({ siec: 'CF', time: t }) != null && pem.get({ siec: 'RA000', time: t }) != null);
    if (!months.length) return void (box.innerHTML = noData('miesięcznych o produkcji prądu'));
    const n = months.length;
    const g = (code, t) => pem.get({ siec: code, time: t }) ?? 0;
    const total = months.map((t) => g('TOTAL', t) / 1000);
    let series = nonEmpty(MIX.map((x) => ({ ...x, values: months.map((t) => x.codes.reduce((a, c) => a + g(c, t), 0) / 1000) })));
    if (series.length > 8) {
      // Paleta ma 8 sprawdzonych barw — przy 9 seriach łączymy wiatr lądowy i morski.
      const on = series.find((s) => s.id === 'won');
      const off = series.find((s) => s.id === 'wof');
      if (on && off) series = series.filter((s) => s !== off).map((s) => (s === on ? { ...s, name: 'Wiatr (lądowy i morski)', values: s.values.map((v, i) => v + off.values[i]) } : s));
    }
    const renShare = months.map((t) => (g('RA000', t) / g('TOTAL', t)) * 100); // RA000 nie obejmuje elektrowni szczytowo-pompowych
    const imp = months.map((t) => em.get({ nrg_bal: 'IMP', time: t }));
    const exp = months.map((t) => em.get({ nrg_bal: 'EXP', time: t }));
    const net = imp.map((v, i) => (v == null || exp[i] == null ? null : (v - exp[i]) / 1000));
    const aim = months.map((t) => em.get({ nrg_bal: 'AIM', time: t }));
    const last = n - 1;
    const lastYear = months[last].slice(0, 4);
    const prevFull = String(+lastYear - 1);
    const yShare = (y) => { const ms = months.filter((t) => t.startsWith(y)); return ms.length === 12 ? (ms.reduce((a, t) => a + g('RA000', t), 0) / ms.reduce((a, t) => a + g('TOTAL', t), 0)) * 100 : null; };
    const k12 = Math.min(12, n);
    const max12 = renShare.slice(-k12).reduce((a, v, i, arr) => (v > arr[a] ? i : a), 0) + n - k12;
    const fossil = (i) => ['coal', 'gas', 'oth'].reduce((a, id) => a + (series.find((s) => s.id === id)?.values[i] ?? 0), 0);
    const seg = rangeSeg('mix', n, 'mix');
    box.innerHTML = staleNote({ what: 'miesięczne Eurostatu o prądzie', asOf: months[last], maxDays: 150 }) + tilesHtml([
      { l: `Produkcja prądu — ${mLabel(months[last])}`, v: twh(total[last]), d: `OZE: ${pc(renShare[last])}, paliwa kopalne: ${pc((fossil(last) / total[last]) * 100)}` },
      { l: 'Udział OZE w produkcji prądu', v: `${pc(yShare(prevFull))} w ${prevFull}`, d: `${pc(yShare(String(+prevFull - 1)))} w ${+prevFull - 1}; rekordowy miesiąc w ostatnim roku: ${mLabel(months[max12])} (${pc(renShare[max12])})` },
      { l: `Import netto prądu — ${mLabel(months[last])}`, v: net[last] == null ? '—' : `${net[last] >= 0 ? '' : '−'}${twh(Math.abs(net[last]))}`, d: net[last] == null ? '' : net[last] >= 0 ? `import ${pc((net[last] / (aim[last] / 1000)) * 100)} zużycia` : 'eksport netto (więcej wysłano za granicę, niż sprowadzono)' },
    ]) + seg.html +
      `<h3 class="sub-h">Produkcja prądu według paliw — ${esc(GEO_NAME)}, ${mLabel(months[0])} – ${mLabel(months[last])}</h3><div class="chart" id="mix-chart"></div>` +
      '<h3 class="sub-h">Udział OZE w produkcji prądu</h3><div class="chart" id="mix-ren"></div>' +
      '<h3 class="sub-h">Import netto prądu</h3><div class="chart" id="mix-net"></div>' +
      table(['Miesiąc', ...series.map((x) => `${x.name} [TWh]`), 'Razem [TWh]', 'Udział OZE', 'Import netto [TWh]'], months.map((t, i) => [mLabel(t), ...series.map((s) => fmt2.format(s.values[i])), fmt2.format(total[i]), pc(renShare[i]), net[i] == null ? '—' : fmt2.format(net[i])]).reverse()) +
      `<p class="note">Produkcja netto energii elektrycznej według paliw (Eurostat <a href="https://ec.europa.eu/eurostat/databrowser/view/nrg_cb_pem/default/table" rel="noopener">nrg_cb_pem</a>), import i eksport (<a href="https://ec.europa.eu/eurostat/databrowser/view/nrg_cb_em/default/table" rel="noopener">nrg_cb_em</a>) — dane miesięczne z ok. 3-miesięcznym opóźnieniem. Udział OZE = produkcja z OZE ÷ produkcja ogółem (elektrownie szczytowo-pompowe nie są OZE); oficjalne wskaźniki roczne są w zakładce „Roczne”. W danych miesięcznych węgiel kamienny i brunatny są łącznie.</p>`;
    seg.bind(box);
    const ticks = yearTicks(months);
    const tipMonth = (i, on) => tipRows(mLabel(months[i]), [...series.slice().reverse().filter((s) => on(s.name) && s.values[i] > 0.0005).map((s) => ({ name: s.name, color: s.color, value: `${twh(s.values[i])} · ${pc((s.values[i] / total[i]) * 100)}` })), { name: 'Razem', value: twh(total[i]) }]);
    drawChart('mix', $('#mix-chart'), { n, stacked: true, series, xTicks: ticks, height: 300, minSpan: 6, yFmt: (v) => `${fmt0.format(v)} TWh`, label: `Miesięczna produkcja prądu według paliw — ${GEO_NAME}, TWh`, tooltip: tipMonth }, 'mix');
    drawChart('mix-ren', $('#mix-ren'), {
      n, series: [{ name: 'Udział OZE', color: 'var(--g-wl)', values: renShare }], area: true, xTicks: ticks, height: 200, minSpan: 6, yFmt: (v) => `${fmt0.format(v)}%`,
      label: 'Udział OZE w produkcji prądu, miesięcznie',
      tooltip: (i) => tipRows(mLabel(months[i]), [{ name: 'Udział OZE', color: 'var(--g-wl)', value: pc(renShare[i]) }, { name: 'Produkcja z OZE', value: twh(g('RA000', months[i]) / 1000) }]),
    }, 'mix');
    drawChart('mix-net', $('#mix-net'), {
      n, bars: true, barColor: (v) => (v >= 0 ? 'var(--imp)' : 'var(--exp)'), series: [{ name: 'Import netto', color: 'var(--imp)', values: net }], legend: false,
      legendExtra: '<span class="key"><i class="sw" style="background:var(--imp)"></i>import netto (+)</span><span class="key"><i class="sw" style="background:var(--exp)"></i>eksport netto (−)</span>',
      xTicks: ticks, height: 180, minSpan: 6, yFmt: (v) => fmt2.format(v), label: 'Saldo wymiany prądu z zagranicą, TWh miesięcznie',
      tooltip: (i) => tipRows(mLabel(months[i]), [{ name: 'Import', color: 'var(--imp)', value: twh(imp[i] / 1000) }, { name: 'Eksport', color: 'var(--exp)', value: twh(exp[i] / 1000) }, { name: 'Saldo', value: net[i] == null ? '—' : `${net[i] >= 0 ? '+' : '−'}${twh(Math.abs(net[i]))}` }]),
    }, 'mix');
  } catch (e) {
    box.innerHTML = errorBox(e);
  }
}

// ---------- Oficjalny udział OZE (nrg_ind_ren), rocznie ----------
export async function renderRenYear() {
  const box = $('#ren-y-body');
  try {
    const ren = await eurostat('nrg_ind_ren', { geo: [GEO, 'EU27_2020'], sinceTimePeriod: '2004' });
    const renYears = ren.times.filter((t) => ren.get({ geo: GEO, nrg_bal: 'REN', time: t }) != null);
    if (!renYears.length) return void (box.innerHTML = noData('o udziale OZE'));
    const rv = (geo, c, t) => ren.get({ geo, nrg_bal: c, time: t });
    // Wskaźniki bywają publikowane w różnym tempie — każdy kafelek pokazuje swój ostatni dostępny rok.
    const lastOf = (c) => renYears.filter((t) => rv(GEO, c, t) != null).pop();
    box.innerHTML = tilesHtml(REN.map(([c, name]) => { const t = lastOf(c); return t ? { l: `${name} — ${t}`, v: pc(rv(GEO, c, t)), d: `UE-27: ${pc(rv('EU27_2020', c, t))}; ${renYears[0]}: ${pc(rv(GEO, c, renYears[0]))}` } : null; })) +
      '<div class="chart" id="ren-y-chart"></div>' +
      table(['Rok', ...REN.flatMap(([, name]) => [`${name} — ${GEO_NAME}`, 'UE-27'])], renYears.map((t) => [t, ...REN.flatMap(([c]) => [pc(rv(GEO, c, t)), pc(rv('EU27_2020', c, t))])]).reverse()) +
      '<p class="note">Oficjalne wskaźniki (Eurostat <a href="https://ec.europa.eu/eurostat/databrowser/view/nrg_ind_ren/default/table" rel="noopener">nrg_ind_ren</a>) liczone są od zużycia końcowego brutto, z normalizacją produkcji wiatrowej i wodnej — dlatego udział OZE w prądzie różni się od prostego udziału w produkcji z zakładki „Miesięczne”. „Cała energia” to wskaźnik, z którego rozliczany jest cel UE.</p>';
    drawChart('ren-y', $('#ren-y-chart'), {
      n: renYears.length, markers: true, series: REN.map(([c, name, col]) => ({ name, color: col, values: renYears.map((t) => rv(GEO, c, t)) })),
      xTicks: renYears.map((t, i) => ({ i, label: t, at: 'center' })).filter((x) => +x.label % 4 === 0 || x.i === renYears.length - 1), height: 260, minSpan: 4, yFmt: (v) => `${fmt0.format(v)}%`,
      label: `Oficjalny udział OZE według obszaru — ${GEO_NAME}, rocznie`,
      tooltip: (i, on) => tipRows(renYears[i], REN.filter(([, name]) => on(name)).map(([c, name, col]) => ({ name, color: col, value: `${pc(rv(GEO, c, renYears[i]))} (UE-27: ${pc(rv('EU27_2020', c, renYears[i]))})` }))),
    }, 'ren-y');
  } catch (e) {
    box.innerHTML = errorBox(e);
  }
}

// ---------- Roczny bilans energii elektrycznej (nrg_bal_peh — produkcja wg paliw, nrg_bal_c — zużycie) ----------
// Produkcja brutto; grupa „Inne” to reszta do sumy (gazy przemysłowe, olej, odpady nieodnawialne, magazyny energii…).
const EL_PROD = [
  { id: 'wk', name: 'Węgiel kamienny', color: 'var(--g-wk)', f: (v) => v('C0000X0350-0370') - v('C0220') },
  { id: 'wb', name: 'Węgiel brunatny', color: 'var(--g-wb)', f: (v) => v('C0220') },
  { id: 'gas', name: 'Gaz ziemny', color: 'var(--g-gaz)', f: (v) => v('G3000') },
  { id: 'oth', name: 'Inne (olej, gazy przemysłowe, odpady)', color: 'var(--ink-2)', f: null },
  { id: 'nuc', name: 'Energia jądrowa', color: 'var(--s5)', f: (v) => v('N9000') },
  { id: 'hyd', name: 'Woda (z elektrowniami szczytowo-pompowymi)', color: 'var(--g-woda)', f: (v) => v('RA100') + v('RA130') },
  { id: 'wind', name: 'Wiatr', color: 'var(--g-wl)', f: (v) => v('RA300') },
  { id: 'pv', name: 'Fotowoltaika', color: 'var(--g-pv)', f: (v) => v('RA420') + v('RA410') },
  { id: 'bio', name: 'Biomasa i biogaz', color: 'var(--g-bio)', f: (v) => v('BIOE') },
];
// Zużycie: sumuje się do produkcji + import − eksport. Kolory: paleta sprawdzona walidatorem (kolejność warstw).
const EL_USE = [
  { name: 'Gospodarstwa domowe', color: 'var(--s6)', codes: ['FC_OTH_HH_E'] },
  { name: 'Handel, usługi i budynki publiczne', color: 'var(--s1)', codes: ['FC_OTH_CP_E'] },
  { name: 'Przemysł', color: 'var(--s4)', codes: ['FC_IND_E'] },
  { name: 'Transport, rolnictwo i inne', color: 'var(--s5)', codes: ['FC_TRA_E', 'FC_OTH_AF_E', 'FC_OTH_FISH_E', 'FC_OTH_NSP_E'] },
  { name: 'Sektor energii (elektrownie, kopalnie, rafinerie)', color: 'var(--s7)', codes: ['NRG_E'] },
  { name: 'Straty w sieciach i magazynowanie', color: 'var(--s2)', codes: ['DL', 'TI_E'] },
];

let elSel = null;
export async function renderElecYear() {
  const box = $('#elec-y-body');
  try {
    const [peh, bal] = await Promise.all([
      eurostat('nrg_bal_peh', { geo: GEO, unit: 'GWH', nrg_bal: 'GEP', sinceTimePeriod: '1990' }),
      eurostat('nrg_bal_c', { geo: GEO, siec: 'E7000', unit: 'GWH', sinceTimePeriod: '1990' }),
    ]);
    const years = peh.times.filter((t) => peh.get({ siec: 'TOTAL', time: t }) != null && bal.get({ nrg_bal: 'FC_E', time: t }) != null);
    if (!years.length) return void (box.innerHTML = noData('rocznych o prądzie'));
    const pv = (t) => (c) => (peh.get({ siec: c, time: t }) ?? 0) / 1000;
    const bv = (c, t) => (bal.get({ nrg_bal: c, time: t }) ?? 0) / 1000;
    const iOth = EL_PROD.findIndex((x) => x.id === 'oth');
    const prod = (t) => {
      const v = pv(t);
      const tot = v('TOTAL');
      const vals = EL_PROD.map((x) => (x.f ? x.f(v) : 0));
      vals[iOth] = tot - vals.reduce((a, x) => a + x, 0);
      return { tot, vals };
    };
    const use = (t) => EL_USE.map((x) => x.codes.reduce((a, c) => a + bv(c, t), 0));
    const n = years.length;
    const P = years.map(prod);
    const U = years.map(use);
    // Pomijamy paliwa, których w danym kraju nigdy nie było (np. atom w Polsce).
    const shown = EL_PROD.map((x, k) => [x, k]).filter(([, k]) => P.some((p) => Math.abs(p.vals[k]) > 0.005));
    const at = (id, vals) => vals[EL_PROD.findIndex((x) => x.id === id)];
    const draw = () => {
      const Y = elSel && years.includes(elSel) ? elSel : years[n - 1];
      const i = years.indexOf(Y);
      const { tot, vals } = P[i];
      const u = U[i];
      const uTot = u.reduce((a, x) => a + x, 0);
      const imp = bv('IMP', Y);
      const exp = bv('EXP', Y);
      const ren = at('hyd', vals) - pv(Y)('RA130') + at('wind', vals) + at('pv', vals) + at('bio', vals);
      const bars = (list, values, total) => {
        const mx = Math.max(...values);
        return `<div class="util">${list.map((x, k) => ({ x, v: values[k] })).sort((a, b) => b.v - a.v).map(({ x, v }) => `<div class="urow"><div class="uname"><i class="sw" style="background:${x.color}"></i>${x.name}</div>
          <div class="utrack"><span class="ubar" style="width:${mx > 0 ? (Math.max(0, v) / mx) * 100 : 0}%;background:${x.color}"></span></div>
          <div class="uval"><b>${twh(v)}</b> <span class="muted">${pc((v / total) * 100)}</span></div></div>`).join('')}</div>`;
      };
      box.innerHTML = staleNote({ what: 'roczne Eurostatu o prądzie', asOf: years[n - 1], maxDays: 820 }) + yearSelect('elec-y-year', years, Y) +
        tilesHtml([
          { l: `Produkcja brutto ${Y}`, v: twh(tot), d: `OZE: ${pc((ren / tot) * 100)}, węgiel: ${pc(((at('wk', vals) + at('wb', vals)) / tot) * 100)}${at('nuc', vals) > 0.005 ? `, atom: ${pc((at('nuc', vals) / tot) * 100)}` : ''}` },
          { l: 'Import − eksport', v: `${imp - exp >= 0 ? '+' : '−'}${twh(Math.abs(imp - exp))}`, d: `import ${twh(imp)}, eksport ${twh(exp)}` },
          { l: 'Zużycie końcowe', v: twh(bv('FC_E', Y)), d: `gospodarstwa domowe ${twh(u[0])}` },
        ]) +
        `<h3 class="sub-h">Produkcja według paliw — ${Y}</h3>${bars(shown.map(([x]) => x), shown.map(([, k]) => vals[k]), tot)}` +
        `<h3 class="sub-h">Na co zużyto prąd — ${Y}</h3>${bars(EL_USE, u, uTot)}` +
        `<h3 class="sub-h">Produkcja według paliw — ${esc(GEO_NAME)}, ${years[0]}–${years[n - 1]}</h3><div class="chart" id="elec-y-prod"></div>` +
        `<h3 class="sub-h">Zużycie według odbiorców, ${years[0]}–${years[n - 1]}</h3><div class="chart" id="elec-y-use"></div>` +
        table(['Rok', ...shown.map(([x]) => `${x.name} [TWh]`), 'Produkcja [TWh]', ...EL_USE.map((x) => `${x.name} [TWh]`), 'Import [TWh]', 'Eksport [TWh]'], years.map((t, k) => [t, ...shown.map(([, j]) => fmt2.format(P[k].vals[j])), fmt2.format(P[k].tot), ...U[k].map((v) => fmt2.format(v)), fmt2.format(bv('IMP', t)), fmt2.format(bv('EXP', t))]).reverse()) +
        '<p class="note">Roczne bilanse Eurostatu: produkcja brutto według paliw (<a href="https://ec.europa.eu/eurostat/databrowser/view/nrg_bal_peh/default/table" rel="noopener">nrg_bal_peh</a>) i zużycie (<a href="https://ec.europa.eu/eurostat/databrowser/view/nrg_bal_c/default/table" rel="noopener">nrg_bal_c</a>), publikowane z opóźnieniem ponad roku. Produkcja brutto obejmuje zużycie własne elektrowni (w zużyciu: „sektor energii”). Zużycie sumuje się do produkcji + import − eksport. „Magazynowanie” to pompowanie w elektrowniach szczytowo-pompowych i ładowanie magazynów bateryjnych.</p>';
      $('#elec-y-year').addEventListener('change', (e) => { elSel = e.target.value; draw(); });
      const ticks = years.map((t, k) => ({ i: k, label: t, at: 'center' })).filter((x) => +x.label % 5 === 0);
      const hi = (k) => (years[k] === Y ? ' (wybrany rok)' : '');
      drawChart('elec-y-prod', $('#elec-y-prod'), {
        n, stacked: true, series: shown.map(([x, j]) => ({ name: x.name, color: x.color, values: P.map((p) => p.vals[j]) })), xTicks: ticks, height: 280, minSpan: 5,
        yFmt: (v) => `${fmt0.format(v)} TWh`, label: `Roczna produkcja prądu według paliw — ${GEO_NAME}, TWh`,
        tooltip: (k, on) => tipRows(years[k] + hi(k), [...shown.slice().reverse().filter(([x, j]) => on(x.name) && P[k].vals[j] > 0.005).map(([x, j]) => ({ name: x.name, color: x.color, value: `${twh(P[k].vals[j])} · ${pc((P[k].vals[j] / P[k].tot) * 100)}` })), { name: 'Razem', value: twh(P[k].tot) }]),
      }, 'elec-y');
      drawChart('elec-y-use', $('#elec-y-use'), {
        n, stacked: true, series: EL_USE.map((x, k) => ({ name: x.name, color: x.color, values: U.map((u2) => u2[k]) })), xTicks: ticks, height: 280, minSpan: 5,
        yFmt: (v) => `${fmt0.format(v)} TWh`, label: `Roczne zużycie prądu według odbiorców — ${GEO_NAME}, TWh`,
        tooltip: (k, on) => tipRows(years[k] + hi(k), [...EL_USE.map((x, j) => [x, j]).reverse().filter(([x]) => on(x.name)).map(([x, j]) => ({ name: x.name, color: x.color, value: twh(U[k][j]) })), { name: 'Razem', value: twh(U[k].reduce((a, x) => a + x, 0)) }]),
      }, 'elec-y');
    };
    draw();
  } catch (e) {
    box.innerHTML = errorBox(e);
  }
}

// ---------- Ile płacimy za prąd (nrg_pc_204, nrg_pc_204_c, nrg_pc_205, nrg_d_hhq) ----------
// Pasma rocznego zużycia gospodarstw domowych. Uwaga: w nrg_pc_204_c (składniki) pasmo DE ma kod KWH_LE15000.
const BANDS_HH = [['KWH_LT1000', 'poniżej 1 MWh', 'KWH_LT1000'], ['KWH1000-2499', '1–2,5 MWh', 'KWH1000-2499'], ['KWH2500-4999', '2,5–5 MWh', 'KWH2500-4999'], ['KWH5000-14999', '5–15 MWh', 'KWH5000-14999'], ['KWH_GE15000', 'od 15 MWh', 'KWH_LE15000']];
const BANDS_IND = [['MWH_LT20', '< 20 MWh'], ['MWH20-499', '20–500 MWh'], ['MWH500-1999', '0,5–2 GWh'], ['MWH2000-19999', '2–20 GWh'], ['MWH20000-69999', '20–70 GWh'], ['MWH70000-149999', '70–150 GWh'], ['MWH_GE150000', '≥ 150 GWh']];
const TAXES = [['VAT', 'VAT'], ['TAX_ENV', 'podatki i opłaty środowiskowe'], ['TAX_CAP', 'opłata mocowa'], ['TAX_RNW', 'opłata OZE'], ['TAX_NUC', 'opłaty jądrowe'], ['OTH', 'inne']];
const HH_EL = [['FC_OTH_HH_E_LE', 'Oświetlenie i urządzenia', 'var(--s1)'], ['FC_OTH_HH_E_CK', 'Gotowanie', 'var(--s3)'], ['FC_OTH_HH_E_SH', 'Ogrzewanie', 'var(--s2)'], ['FC_OTH_HH_E_WH', 'Ciepła woda', 'var(--s4)'], ['FC_OTH_HH_E_SC', 'Chłodzenie', 'var(--s7)'], ['FC_OTH_HH_E_OE', 'Inne', 'var(--ink-2)']];

const pref = (k, def) => { try { return localStorage.getItem(k) ?? def; } catch { return def; } };
const setPref = (k, v) => { try { localStorage.setItem(k, v); } catch { /* brak localStorage */ } };
let billBand = pref('billBand', 'KWH2500-4999');
let billCmp = pref('billCmp', 'PPS');
if (!BANDS_HH.some(([c]) => c === billBand)) billBand = 'KWH2500-4999';

export async function renderBills() {
  const box = $('#bills-body');
  try {
    const [hh, comp, ind, eu, use] = await Promise.all([
      eurostat('nrg_pc_204', { geo: [GEO, 'EU27_2020'], currency: [...new Set([CUR, 'EUR'])], sinceTimePeriod: '2007-S1' }),
      eurostat('nrg_pc_204_c', { geo: GEO, currency: CUR, sinceTimePeriod: sinceYears(4) }),
      eurostat('nrg_pc_205', { geo: GEO, currency: CUR, tax: 'X_VAT', sinceTimePeriod: sinceYears(2) + '-S1' }),
      eurostat('nrg_pc_204', { tax: 'I_TAX', currency: ['PPS', 'EUR'], sinceTimePeriod: sinceYears(2) + '-S1' }),
      eurostat('nrg_d_hhq', { geo: GEO, siec: 'E7000', unit: 'GWH', sinceTimePeriod: sinceYears(5) }),
    ]);
    const unit = `${CUR_SYM}/kWh`;
    const zl = (v) => (v == null ? '—' : `${fmt2.format(v)} ${unit}`);
    const sem = (t) => `${t.slice(5) === 'S1' ? 'I' : 'II'} półr. ${t.slice(0, 4)}`;
    const draw = () => {
      const [band, bandLabel, compBand] = BANDS_HH.find(([c]) => c === billBand);
      // Ceny półroczne wybranego kraju: brutto, bez VAT, bez podatków i opłat (waluta krajowa dla Polski, euro dla pozostałych).
      const sems = hh.times.filter((t) => hh.get({ geo: GEO, nrg_cons: band, tax: 'I_TAX', currency: CUR, time: t }) != null);
      if (!sems.length) return void (box.innerHTML = noData('o cenach prądu dla gospodarstw domowych'));
      const S = sems[sems.length - 1];
      // Średnią UE Eurostat podaje tylko w euro — dla złotych przeliczamy kursem z polskich cen w EUR i zł w tym samym półroczu.
      const p = (tax, t = S, geo = GEO) => {
        if (geo === GEO || CUR === 'EUR') return hh.get({ geo, nrg_cons: band, tax, currency: CUR, time: t });
        const e = hh.get({ geo, nrg_cons: band, tax, currency: 'EUR', time: t });
        const rate = hh.get({ geo: GEO, nrg_cons: band, tax, currency: CUR, time: t }) / hh.get({ geo: GEO, nrg_cons: band, tax, currency: 'EUR', time: t });
        return e == null || !isFinite(rate) ? null : e * rate;
      };
      const back = sems.length >= 3 ? sems[sems.length - 3] : null;
      const ch = back && p('I_TAX', back) ? ((p('I_TAX') - p('I_TAX', back)) / p('I_TAX', back)) * 100 : null;
      // Składniki (rocznie).
      const cy = comp.times.filter((t) => comp.get({ nrg_cons: compBand, nrg_prc: 'NRG_SUP', time: t }) != null);
      const CY = cy[cy.length - 1];
      const cv = (k) => (CY ? comp.get({ nrg_cons: compBand, nrg_prc: k, time: CY }) ?? 0 : 0);
      const parts = [['Energia i obsługa sprzedawcy', cv('NRG_SUP'), 'var(--s1)'], ['Opłaty sieciowe (dystrybucja, przesył)', cv('NETC'), 'var(--s3)'], ['Podatki i opłaty', cv('TAX_FEE_LEV_CHRG'), 'var(--s2)']];
      const cTot = parts.reduce((a, x) => a + x[1], 0);
      // Porównanie UE w wybranym paśmie: parytet siły nabywczej albo euro.
      const cmpU = billCmp === 'PPS' ? 'PPS' : '€';
      const euSems = eu.times.filter((t) => eu.get({ geo: GEO, nrg_cons: band, currency: billCmp, time: t }) != null);
      const ES = euSems[euSems.length - 1];
      const countries = ES ? Object.keys(EU_NAMES).map((c) => ({ c, v: eu.get({ geo: c, nrg_cons: band, currency: billCmp, time: ES }) })).filter((x) => x.v != null).sort((a, b) => b.v - a.v) : [];
      const onlyC = countries.filter((x) => x.c !== 'EU27_2020');
      const rank = onlyC.findIndex((x) => x.c === GEO) + 1;
      const maxP = countries[0]?.v || 1;
      // Firmy (półrocznie, bez VAT).
      const is = ind.times.filter((t) => ind.get({ nrg_cons: 'TOT_KWH', time: t }) != null);
      const IS = is[is.length - 1];
      // Gospodarstwa domowe według zastosowania.
      const uy = use.times.filter((t) => use.get({ nrg_bal: 'FC_OTH_HH_E', time: t }) != null);
      const UY = uy[uy.length - 1];
      const uv = (c) => (UY ? (use.get({ nrg_bal: c, time: UY }) ?? 0) / 1000 : 0);
      const uTot = uv('FC_OTH_HH_E');
      const uRows = HH_EL.filter(([c]) => uv(c) > 0.05);
      const colorOf = (c) => (c === GEO ? 'var(--s2)' : c === 'EU27_2020' ? 'var(--ink)' : 'var(--ink-2)');
      box.innerHTML =
        `<div class="ctl-row"><label class="year-sel">Roczne zużycie domu: <select id="bill-band">${BANDS_HH.map(([c, l]) => `<option value="${c}"${c === band ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
        <div class="seg" role="group" aria-label="Waluta porównania z UE" id="bill-cmp"><button type="button" data-c="PPS" class="${billCmp === 'PPS' ? 'on' : ''}">parytet siły nabywczej</button><button type="button" data-c="EUR" class="${billCmp === 'EUR' ? 'on' : ''}">euro</button></div></div>` +
        tilesHtml([
          { l: `Dom (${bandLabel}/rok) — ${sem(S)}`, v: zl(p('I_TAX')), d: `bez VAT ${zl(p('X_VAT'))} · bez podatków i opłat ${zl(p('X_TAX'))}` },
          ch == null ? null : { l: `Zmiana rok do roku (od ${sem(back)})`, v: `${ch >= 0 ? '+' : '−'}${fmt0.format(Math.abs(ch))}%`, d: `z ${zl(p('I_TAX', back))}` },
          rank ? { l: `Na tle UE (${billCmp === 'PPS' ? 'siła nabywcza' : 'euro'}, ${sem(ES)})`, v: `${rank}. miejsce z ${onlyC.length}`, d: 'od najdroższego' } : null,
          IS ? { l: `Firmy — średnio, ${sem(IS)}`, v: zl(ind.get({ nrg_cons: 'TOT_KWH', time: IS })), d: 'bez VAT (firmy go odliczają)' } : null,
        ]) +
        `<h3 class="sub-h">Cena dla domu zużywającego ${bandLabel} rocznie — ${esc(GEO_NAME)}, ${sem(sems[0])} – ${sem(S)}</h3><div class="chart" id="bills-chart"></div>` +
        (CY && cTot > 0 ? `<h3 class="sub-h">Z czego składa się cena — ${CY} (średnio w roku, ${fmt2.format(cTot)} ${unit})</h3>
        <div class="stackbar" role="img" aria-label="Składniki ceny prądu">${parts.map(([nm, v, col]) => `<span style="flex:${Math.max(0, v)};background:${col}" title="${nm}: ${zl(v)}"></span>`).join('')}</div>
        <div class="legend">${parts.map(([nm, v, col]) => `<span class="key"><i class="sw" style="background:${col}"></i>${nm}: <b>${zl(v)}</b> (${pc((v / cTot) * 100)})</span>`).join('')}</div>
        <p class="muted small-sum">Podatki i opłaty: ${TAXES.filter(([k]) => cv(k)).map(([k, nm]) => `${nm} ${fmt2.format(cv(k))}`).join(' · ')} ${unit}</p>` : '') +
        (countries.length ? `<h3 class="sub-h">Ceny w krajach UE — ${sem(ES)}, dom ${bandLabel}/rok, z podatkami, ${billCmp === 'PPS' ? 'w parytecie siły nabywczej' : 'w euro'}</h3><div class="util">${countries
          .map((x) => `<div class="urow${x.c === GEO ? ' hl' : ''}"><div class="uname"><i class="sw" style="background:${colorOf(x.c)}"></i>${EU_NAMES[x.c]}</div>
            <div class="utrack"><span class="ubar" style="width:${(x.v / maxP) * 100}%;background:${colorOf(x.c)}"></span></div>
            <div class="uval"><b>${fmt2.format(x.v)} ${cmpU}/kWh</b></div></div>`).join('')}</div>` : '') +
        (IS ? `<h3 class="sub-h">Firmy według rocznego zużycia — ${sem(IS)}, bez VAT</h3><div class="util">${BANDS_IND.map(([c, nm]) => ({ nm, v: ind.get({ nrg_cons: c, time: IS }) })).filter((x) => x.v != null)
          .map((x, _, arr) => `<div class="urow"><div class="uname">${esc(x.nm)}</div><div class="utrack"><span class="ubar" style="width:${(x.v / Math.max(...arr.map((y) => y.v))) * 100}%;background:var(--s1)"></span></div><div class="uval"><b>${zl(x.v)}</b></div></div>`).join('')}</div>` : '') +
        (uRows.length ? `<h3 class="sub-h">Na co gospodarstwa domowe zużywają prąd — ${UY} (${twh(uTot)})</h3>
        <div class="stackbar" role="img" aria-label="Zużycie prądu w gospodarstwach domowych według zastosowania">${uRows.map(([c, nm, col]) => `<span style="flex:${uv(c)};background:${col}" title="${nm}: ${twh(uv(c))}"></span>`).join('')}</div>
        <div class="legend">${uRows.map(([c, nm, col]) => `<span class="key"><i class="sw" style="background:${col}"></i>${nm}: <b>${twh(uv(c))}</b> (${pc((uv(c) / uTot) * 100)})</span>`).join('')}</div>` : '') +
        table(['Półrocze', `Brutto [${unit}]`, 'Bez VAT', 'Bez podatków i opłat', `UE-27 brutto [${unit}]`], sems.map((t) => [sem(t), fmt2.format(p('I_TAX', t)), fmt2.format(p('X_VAT', t)), fmt2.format(p('X_TAX', t)), p('I_TAX', t, 'EU27_2020') == null ? '—' : fmt2.format(p('I_TAX', t, 'EU27_2020'))]).reverse()) +
        `<p class="note">Średnie ceny rzeczywiście płacone przez odbiorców (energia, sieć, podatki i opłaty) — Eurostat <a href="https://ec.europa.eu/eurostat/databrowser/view/nrg_pc_204/default/table" rel="noopener">nrg_pc_204</a> (gospodarstwa domowe), <a href="https://ec.europa.eu/eurostat/databrowser/view/nrg_pc_205/default/table" rel="noopener">nrg_pc_205</a> (firmy), <a href="https://ec.europa.eu/eurostat/databrowser/view/nrg_pc_204_c/default/table" rel="noopener">nrg_pc_204_c</a> (składniki, rocznie), <a href="https://ec.europa.eu/eurostat/databrowser/view/nrg_d_hhq/default/table" rel="noopener">nrg_d_hhq</a> (zastosowania). Uwzględniają mechanizmy osłonowe (zamrożenie cen). Parytet siły nabywczej (PPS) pokazuje, jak drogi jest prąd w stosunku do poziomu cen w danym kraju; euro — cenę po kursie walut. ${GEO === 'PL' ? 'Średnią UE-27 (publikowaną w euro) przeliczamy na złote kursem wynikającym z polskich cen w euro i złotych w tym samym półroczu.' : 'Ceny krajów spoza strefy euro pokazujemy w euro.'}</p>`;
      $('#bill-band').addEventListener('change', (e) => { billBand = e.target.value; setPref('billBand', billBand); draw(); });
      $('#bill-cmp').addEventListener('click', (e) => { const b = e.target.closest('button[data-c]'); if (!b) return; billCmp = b.dataset.c; setPref('billCmp', billCmp); draw(); });
      drawChart('bills', $('#bills-chart'), {
        n: sems.length, markers: sems.length < 30,
        series: [{ name: 'Z podatkami (brutto)', color: 'var(--s2)', values: sems.map((t) => p('I_TAX', t)) }, { name: 'Bez VAT', color: 'var(--s1)', values: sems.map((t) => p('X_VAT', t)) }, { name: 'Bez podatków i opłat', color: 'var(--s3)', values: sems.map((t) => p('X_TAX', t)) }, { name: 'UE-27 brutto', color: 'var(--ink-2)', values: sems.map((t) => p('I_TAX', t, 'EU27_2020')) }],
        xTicks: sems.map((t, i) => ({ i, label: t.slice(0, 4), at: 'center' })).filter((x, k) => sems[k].endsWith('S1') && +x.label % 2 === 0), height: 260, minSpan: 4, yFmt: (v) => fmt2.format(v), zero: false,
        label: `Cena prądu dla gospodarstwa domowego — ${GEO_NAME}, ${unit}`,
        tooltip: (i, on) => tipRows(sem(sems[i]), [['I_TAX', 'Z podatkami (brutto)', 'var(--s2)'], ['X_VAT', 'Bez VAT', 'var(--s1)'], ['X_TAX', 'Bez podatków i opłat', 'var(--s3)']].filter(([, nm]) => on(nm)).map(([k, nm, col]) => ({ name: nm, color: col, value: zl(p(k, sems[i])) })).concat(on('UE-27 brutto') ? [{ name: 'UE-27 brutto', color: 'var(--ink-2)', value: zl(p('I_TAX', sems[i], 'EU27_2020')) }] : [])),
      }, 'bills');
    };
    draw();
  } catch (e) {
    box.innerHTML = errorBox(e);
  }
}
