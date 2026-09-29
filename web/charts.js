// Minimalny renderer wykresów SVG (bez zależności).
// Oś X to n przedziałów (np. 96 kwadransów doby); punkt przedziału i leży w jego środku.

const NS = 'http://www.w3.org/2000/svg';

function el(tag, attrs = {}, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}

export const fmt0 = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 0 });
export const fmt2 = new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function niceTicks(min, max, count = 5) {
  if (min === max) max = min + 1;
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const r = raw / mag;
  const step = (r >= 7.5 ? 10 : r >= 3.5 ? 5 : r >= 1.5 ? 2 : 1) * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(+v.toFixed(10));
  return { lo, hi, ticks };
}

let tipEl;
function tip() {
  if (!tipEl) {
    tipEl = document.createElement('div');
    tipEl.className = 'tooltip';
    tipEl.hidden = true;
    document.body.appendChild(tipEl);
  }
  return tipEl;
}

export function placeTip(html, clientX, clientY) {
  const t = tip();
  t.innerHTML = html;
  t.hidden = false;
  const r = t.getBoundingClientRect();
  let x = clientX + 14;
  let y = clientY + 14;
  if (x + r.width > window.innerWidth - 8) x = clientX - r.width - 14;
  if (y + r.height > window.innerHeight - 8) y = clientY - r.height - 14;
  t.style.left = Math.max(8, x) + 'px';
  t.style.top = Math.max(8, y) + 'px';
}

export function hideTip() {
  if (tipEl) tipEl.hidden = true;
}

/**
 * Interaktywny wykres czasowy / kategorii.
 * o.n          – liczba przedziałów
 * o.series     – [{name, color (CSS, np. 'var(--s1)'), values: (number|null)[]}]
 * o.stacked    – warstwowy wykres powierzchniowy
 * o.step       – linia schodkowa (wartość stała w przedziale)
 * o.area       – delikatne wypełnienie pod pojedynczą linią
 * o.markers    – kropki w punktach (dla krótkich serii)
 * o.bars       – kolumny od zera; kolor słupka wg o.barColor(v)
 * o.band       – {a, b, pos, neg}: pasmo między seriami a i b, kolorowane znakiem różnicy
 * o.xTicks     – [{i, label, at}] albo funkcja (od, do) => [{i, label, at}] (gęstość wg powiększenia)
 * o.nowIndex   – indeks przedziału „teraz”
 * o.tooltip(i, on) – HTML dymka; on(name) mówi, czy seria jest widoczna
 * o.yFmt       – formatowanie etykiet osi Y
 * o.legend     – czy rysować legendę z przełącznikami (domyślnie gdy serii > 1); o.legendExtra – dodatkowy HTML
 * o.state      – {hidden: Set} trwały między przerysowaniami
 * o.view / o.setView – wspólny zakres widoku [od, do] (synchronizacja powiększenia między wykresami)
 */
export function chart(container, o) {
  const n = o.n;
  const st = o.state || (o.state = {});
  st.hidden ??= new Set();
  let localView = null;
  const getView = () => {
    const v = o.view ? o.view() : localView;
    return v && v[1] - v[0] >= 2 && v[0] >= 0 && v[1] <= n ? v : [0, n];
  };
  const setView = (v) => {
    let [a, b] = v;
    const minSpan = Math.min(n, o.minSpan || 4);
    if (b - a < minSpan) { const c = (a + b) / 2; a = c - minSpan / 2; b = c + minSpan / 2; }
    if (a < 0) { b -= a; a = 0; }
    if (b > n) { a -= b - n; b = n; }
    a = Math.max(0, Math.round(a));
    b = Math.min(n, Math.round(b));
    const full = a <= 0 && b >= n;
    if (o.setView) o.setView(full ? null : [a, b]);
    else { localView = full ? null : [a, b]; render(); }
  };
  const on = (name) => !st.hidden.has(name);
  const toggle = (name, solo) => {
    if (solo) {
      const others = o.series.filter((s) => s.name !== name);
      const isSolo = on(name) && others.every((s) => !on(s.name));
      st.hidden = new Set(isSolo ? [] : others.map((s) => s.name));
    } else if (st.hidden.has(name)) st.hidden.delete(name);
    else st.hidden.add(name);
    render();
  };
  const showLegend = o.legend ?? o.series.length > 1;

  function render() {
    hideTip();
    container.innerHTML = '';
    container.classList.add('ichart');
    const [v0, v1] = getView();
    const zoomed = v0 > 0 || v1 < n;

    // Pasek: legenda (przełączniki) + sterowanie zakresem.
    const bar = document.createElement('div');
    bar.className = 'chart-bar';
    const lg = document.createElement('div');
    lg.className = 'legend';
    if (showLegend)
      o.series.forEach((s) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'key toggle' + (on(s.name) ? '' : ' off');
        b.setAttribute('aria-pressed', on(s.name));
        b.title = 'Kliknij: pokaż/ukryj · dwuklik: tylko ta seria';
        b.innerHTML = `<i class="sw" style="background:${s.color}"></i>${s.name}`;
        let clickT;
        b.addEventListener('click', () => { clearTimeout(clickT); clickT = setTimeout(() => toggle(s.name, false), 220); });
        b.addEventListener('dblclick', (e) => { e.preventDefault(); clearTimeout(clickT); toggle(s.name, true); });
        lg.appendChild(b);
      });
    if (o.legendExtra) lg.insertAdjacentHTML('beforeend', o.legendExtra);
    bar.appendChild(lg);
    const ctl = document.createElement('div');
    ctl.className = 'zoom-ctl';
    const span = v1 - v0;
    const btn = (label, title, fn, disabled = false) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.title = title;
      b.setAttribute('aria-label', title);
      b.disabled = disabled;
      b.addEventListener('click', fn);
      ctl.appendChild(b);
    };
    btn('‹', 'Przesuń w lewo', () => setView([v0 - span / 3, v1 - span / 3]), !zoomed || v0 <= 0);
    btn('−', 'Pomniejsz (większy zakres)', () => setView([v0 - span / 2, v1 + span / 2]), !zoomed);
    btn('+', 'Powiększ (mniejszy zakres)', () => setView([v0 + span / 4, v1 - span / 4]), span <= Math.min(n, o.minSpan || 4));
    btn('›', 'Przesuń w prawo', () => setView([v0 + span / 3, v1 + span / 3]), !zoomed || v1 >= n);
    btn('⟲', 'Pełny zakres', () => setView([0, n]), !zoomed);
    bar.appendChild(ctl);
    container.appendChild(bar);

    const W = Math.max(container.clientWidth, 280);
    const H = o.height || 260;
    const m = { l: 56, r: 16, t: 14, b: 30 };
    const pw = W - m.l - m.r;
    const ph = H - m.t - m.b;
    const X = (i) => m.l + ((i - v0) * pw) / span;
    const XC = (i) => X(i + 0.5);
    const series = o.series.filter((s) => on(s.name));
    const i0 = Math.max(0, Math.floor(v0) - 1);
    const i1 = Math.min(n, Math.ceil(v1) + 1);

    // Skumulowane wartości dla wykresu warstwowego (tylko widoczne serie).
    let cum = null;
    if (o.stacked) {
      cum = series.map(() => new Array(n).fill(null));
      for (let i = 0; i < n; i++) {
        if (o.series.every((s) => s.values[i] == null)) continue;
        let acc = 0;
        series.forEach((s, k) => {
          acc += Math.max(0, s.values[i] || 0);
          cum[k][i] = acc;
        });
      }
    }

    // Oś Y dopasowana do widocznego zakresu i widocznych serii.
    let lo = Infinity;
    let hi = -Infinity;
    const scan = cum || series.map((s) => s.values);
    for (const vals of scan)
      for (let i = Math.max(0, Math.floor(v0)); i < Math.min(n, Math.ceil(v1)); i++) {
        const v = vals[i];
        if (v != null && isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
      }
    if (!isFinite(lo)) { lo = 0; hi = 1; }
    if (o.zero !== false) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
    else { const pad = (hi - lo) * 0.08 || 1; lo -= pad; hi += pad; }
    const { lo: y0, hi: y1, ticks } = niceTicks(lo, hi, o.yTicks || 5);
    const Y = (v) => m.t + ph - ((v - y0) / (y1 - y0)) * ph;

    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': o.label || '', tabindex: 0 }, container);
    const clipId = 'c' + Math.random().toString(36).slice(2);
    el('rect', { x: m.l, y: 0, width: pw, height: H - m.b }, el('clipPath', { id: clipId }, el('defs', {}, svg)));
    const yFmt = o.yFmt || ((v) => fmt0.format(v));

    const grid = el('g', {}, svg);
    for (const t of ticks) {
      el('line', { x1: m.l, x2: W - m.r, y1: Y(t), y2: Y(t), class: t === 0 ? 'axis' : 'gridline' }, grid);
      const tx = el('text', { x: m.l - 8, y: Y(t), class: 'tick', 'text-anchor': 'end', 'dominant-baseline': 'middle' }, grid);
      tx.textContent = yFmt(t);
    }
    const xt = typeof o.xTicks === 'function' ? o.xTicks(v0, v1) : o.xTicks || [];
    let lastX = -Infinity;
    for (const t of xt) {
      const x = t.at === 'center' ? XC(t.i) : X(t.i);
      if (x < m.l - 1 || x > W - m.r + 1 || x - lastX < 34) continue;
      lastX = x;
      const anchor = x - m.l < 14 ? 'start' : W - m.r - x < 14 ? 'end' : 'middle';
      const tx = el('text', { x, y: H - 9, class: 'tick', 'text-anchor': anchor }, grid);
      tx.textContent = t.label;
    }

    const plot = el('g', { 'clip-path': `url(#${clipId})` }, svg);
    if (o.nowIndex != null && o.nowIndex >= v0 && o.nowIndex < v1) {
      const x = XC(o.nowIndex);
      el('line', { x1: x, x2: x, y1: m.t, y2: m.t + ph, class: 'now-line' }, plot);
      el('text', { x: x + 4, y: m.t + 10, class: 'now-label' }, plot).textContent = 'teraz';
    }

    if (o.stacked) {
      series.forEach((s, k) => {
        let d = '';
        let seg = [];
        const flush = () => {
          if (!seg.length) return;
          const top = seg.map((i) => [XC(i), Y(cum[k][i])]);
          const bot = seg.map((i) => [XC(i), Y(k ? cum[k - 1][i] : 0)]).reverse();
          d += 'M' + top.map((p) => p.join(',')).join('L') + 'L' + bot.map((p) => p.join(',')).join('L') + 'Z';
          seg = [];
        };
        for (let i = i0; i < i1; i++) (cum[k][i] == null ? flush() : seg.push(i));
        flush();
        el('path', { d, class: 'stack-area', style: `fill:${s.color}` }, plot);
      });
    } else {
      if (o.band && on(o.series[o.band.a].name) && on(o.series[o.band.b].name)) {
        const A = o.series[o.band.a].values;
        const B = o.series[o.band.b].values;
        for (let i = i0; i + 1 < i1; i++) {
          if ([A[i], A[i + 1], B[i], B[i + 1]].some((v) => v == null)) continue;
          const sign = A[i] + A[i + 1] - B[i] - B[i + 1];
          const d = `M${XC(i)},${Y(A[i])}L${XC(i + 1)},${Y(A[i + 1])}L${XC(i + 1)},${Y(B[i + 1])}L${XC(i)},${Y(B[i])}Z`;
          el('path', { d, class: 'band-wash', style: `fill:${sign >= 0 ? o.band.pos : o.band.neg}` }, plot);
        }
      }
      if (o.bars) {
        const bw = Math.max(1, pw / span - 1);
        const yb = Y(Math.max(y0, Math.min(0, y1)));
        series.forEach((s) => {
          for (let i = i0; i < i1; i++) {
            const v = s.values[i];
            if (v == null) continue;
            const y = Y(v);
            el('rect', { x: X(i) + 0.5, y: Math.min(y, yb), width: bw, height: Math.max(0.5, Math.abs(y - yb)), style: `fill:${o.barColor ? o.barColor(v) : s.color}` }, plot);
          }
        });
      } else
        series.forEach((s) => {
          const pts = [];
          let d = '';
          let pen = false;
          for (let i = i0; i < i1; i++) {
            const v = s.values[i];
            if (v == null) { pen = false; continue; }
            if (o.step) { d += `${pen ? 'L' : 'M'}${X(i)},${Y(v)}L${X(i + 1)},${Y(v)}`; pts.push([X(i), X(i + 1), Y(v)]); }
            else { d += `${pen ? 'L' : 'M'}${XC(i)},${Y(v)}`; pts.push([XC(i), XC(i), Y(v)]); }
            pen = true;
          }
          if (o.area && pts.length) {
            const base = Y(Math.max(y0, Math.min(0, y1)));
            const a = `M${pts[0][0]},${base}` + pts.map((p) => `L${p[0]},${p[2]}L${p[1]},${p[2]}`).join('') + `L${pts[pts.length - 1][1]},${base}Z`;
            el('path', { d: a, class: 'area-wash', style: `fill:${s.color}` }, plot);
          }
          el('path', { d, class: 'line', style: `stroke:${s.color}` }, plot);
          if (o.markers) for (let i = i0; i < i1; i++) if (s.values[i] != null) el('circle', { cx: XC(i), cy: Y(s.values[i]), r: 4, class: 'marker', style: `fill:${s.color}` }, plot);
        });
    }
    if (!series.length) el('text', { x: m.l + pw / 2, y: m.t + ph / 2, class: 'tick', 'text-anchor': 'middle' }, svg).textContent = 'Wszystkie serie ukryte — kliknij w legendzie, by je pokazać';

    // Warstwa interakcji: celownik, dymek, zaznaczanie zakresu.
    const hover = el('g', { class: 'hover', visibility: 'hidden' }, svg);
    const cross = el('line', { y1: m.t, y2: m.t + ph, class: 'crosshair' }, hover);
    const dots = o.bars ? [] : series.map((s) => el('circle', { r: 4.5, class: 'marker', style: `fill:${s.color}` }, hover));
    const sel = el('rect', { y: m.t, height: ph, class: 'zoom-sel', visibility: 'hidden' }, svg);
    const hit = el('rect', { x: m.l, y: m.t, width: pw, height: ph, fill: 'transparent', class: 'hit' }, svg);

    const toIdx = (clientX) => {
      const r = svg.getBoundingClientRect();
      const px = ((clientX - r.left) / r.width) * W;
      return v0 + ((px - m.l) / pw) * span;
    };
    const show = (i, cx, cy) => {
      const x = XC(i);
      cross.setAttribute('x1', x);
      cross.setAttribute('x2', x);
      series.forEach((s, k) => {
        if (!dots[k]) return;
        const v = o.stacked ? cum[k][i] : s.values[i];
        if (v == null) dots[k].setAttribute('visibility', 'hidden');
        else { dots[k].setAttribute('visibility', 'visible'); dots[k].setAttribute('cx', x); dots[k].setAttribute('cy', Y(v)); }
      });
      hover.setAttribute('visibility', 'visible');
      if (o.tooltip) placeTip(o.tooltip(i, on), cx, cy);
    };
    const hide = () => { hover.setAttribute('visibility', 'hidden'); hideTip(); };

    let drag = null;
    hit.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.pointerType === 'touch') return;
      drag = { a: toIdx(e.clientX) };
      hit.setPointerCapture(e.pointerId);
    });
    hit.addEventListener('pointermove', (e) => {
      const f = toIdx(e.clientX);
      if (drag) {
        drag.b = f;
        const a = Math.max(v0, Math.min(drag.a, f));
        const b = Math.min(v1, Math.max(drag.a, f));
        sel.setAttribute('x', X(a));
        sel.setAttribute('width', Math.max(0, X(b) - X(a)));
        sel.setAttribute('visibility', 'visible');
        hideTip();
        return;
      }
      const i = Math.max(Math.floor(v0), Math.min(Math.ceil(v1) - 1, Math.floor(f)));
      show(i, e.clientX, e.clientY);
    });
    hit.addEventListener('pointerup', (e) => {
      if (!drag) return;
      const d = drag;
      drag = null;
      sel.setAttribute('visibility', 'hidden');
      if (d.b != null && Math.abs(X(d.b) - X(d.a)) > 8) setView([Math.floor(Math.min(d.a, d.b)), Math.ceil(Math.max(d.a, d.b))]);
      else show(Math.max(0, Math.min(n - 1, Math.floor(d.a))), e.clientX, e.clientY);
    });
    hit.addEventListener('pointerleave', () => { if (!drag) hide(); });
    hit.addEventListener('dblclick', () => setView([0, n]));
    // Ctrl/⌘ + kółko: powiększanie wokół kursora (samo kółko przewija stronę).
    svg.addEventListener('wheel', (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const f = toIdx(e.clientX);
      const k = e.deltaY < 0 ? 0.7 : 1 / 0.7;
      setView([f - (f - v0) * k, f + (v1 - f) * k]);
    }, { passive: false });

    // Klawiatura: strzałki przesuwają celownik, +/− powiększają, 0 resetuje.
    let ki = o.nowIndex != null && o.nowIndex >= v0 && o.nowIndex < v1 ? o.nowIndex : Math.floor(v0);
    svg.addEventListener('keydown', (e) => {
      if (e.key === '+' || e.key === '=') return void setView([v0 + span / 4, v1 - span / 4]);
      if (e.key === '-') return void setView([v0 - span / 2, v1 + span / 2]);
      if (e.key === '0') return void setView([0, n]);
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      ki = Math.max(Math.floor(v0), Math.min(Math.ceil(v1) - 1, ki + (e.key === 'ArrowRight' ? 1 : -1)));
      const r = svg.getBoundingClientRect();
      show(ki, r.left + (XC(ki) / W) * r.width, r.top + m.t + 20);
    });
    svg.addEventListener('blur', hide);
  }

  render();
  return render;
}

export function legend(series, extra = '') {
  return (
    '<div class="legend">' +
    series.map((s) => `<span class="key"><i class="sw" style="background:${s.color}"></i>${s.name}</span>`).join('') +
    extra +
    '</div>'
  );
}

export function tipRows(header, rows) {
  return (
    `<div class="tt-h">${header}</div>` +
    rows
      .map((r) => `<div class="tt-r">${r.color ? `<i class="sw" style="background:${r.color}"></i>` : '<i class="sw none"></i>'}<span>${r.name}</span><b>${r.value}</b></div>`)
      .join('')
  );
}
