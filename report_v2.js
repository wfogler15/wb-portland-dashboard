/* =================================================================
   MARKET REPORT v2 — client-grade PDF export (Portland build)
   -----------------------------------------------------------------
   Replaces the legacy exportMarketReportPdf output, which snapshotted
   live Chart.js canvases and inherited every dashboard stylesheet. v2
   builds a standalone print document instead:

     • every chart is inline SVG drawn from the data (crisp at any zoom,
       no canvas-resize artifacts, consistent brand styling)
     • one print stylesheet, nothing inherited from the dashboard
     • running header / footer + page numbers via @page margin boxes
     • numbered sections and figures, source line under every exhibit
     • RealPage and CoStar figures labeled by source throughout

   Same sections, same order, same content as the original Market Report:
   cover, market overview, lease-up, pipeline, RealPage forecast,
   yield-on-cost matrix, unit size analysis, sale comps, appendix. Only the
   presentation and the data errors changed (cross-market data leak,
   CoStar/RealPage label, broken chart baselines, truncated columns).

   Honors the report modal's filter overrides exactly like the legacy
   exporter and restores dashboard state afterwards.
   ================================================================= */

const REPORT_V2 = {
  marketName: 'Portland MSA',
  marketLong: 'Portland-Vancouver-Hillsboro, OR-WA',
  rpAsOf: 'Q2 2026',          // RealPage Annual Performance vintage
  rpForecastFrom: 2026,       // first RealPage year that is estimate/forecast
  forecastEnd: 2030,
  logoWhite: '__WB_LOGO_WHITE__',
  mark: '__WB_MARK__',
  colors: {
    midnight: '#1D1247', purple: '#432890', lilac: '#C7C9FE', lilac50: '#E3E4FE',
    sand: '#C2B8AF', sandLight: '#EEEBE7', forest: '#102930', brick: '#722525',
    ink: '#1F1D2B', muted: '#6B6878', rule: '#DEDAE6', grid: '#ECE9F1', zebra: '#F7F6FA',
  },
};

async function exportMarketReportV2(reportOptions) {
  reportOptions = reportOptions || {};
  // Same sections, same order as the original Market Report.
  const sections = Object.assign(
    { cover: true, overview: true, leaseUp: true, pipeline: true, rpForecast: true,
      yoc: true, unitMix: true, saleComps: true, appendix: true },
    reportOptions.sections || {}
  );

  // Temporarily apply the modal's filter + YOC overrides (same contract as the
  // original exporter) and restore dashboard state afterwards.
  const overrides = reportOptions.filterOverrides;
  const yocOverrides = reportOptions.yocOverrides;
  const snap = overrides ? {
    status: state.status, classes: new Set(state.classes),
    productTypes: new Set(state.productTypes), cities: new Set(state.cities),
    submarkets: new Set(state.submarkets), scYear: state.scYear,
  } : null;
  const yocSnap = yocOverrides ? {
    targetYoc: yocState.targetYoc, opex: yocState.opex, unitSize: yocState.unitSize,
    costs: JSON.parse(JSON.stringify(yocState.costs)),
  } : null;
  if (overrides) {
    if (overrides.status !== undefined) state.status = overrides.status;
    if (overrides.class !== undefined) {
      if (overrides.class === 'all' || overrides.class == null) state.classes = new Set();
      else if (Array.isArray(overrides.class)) state.classes = new Set(overrides.class);
      else state.classes = new Set([overrides.class]);
    }
    if (overrides.productTypes !== undefined) state.productTypes = new Set(overrides.productTypes);
    if (overrides.cities !== undefined) state.cities = new Set(overrides.cities);
    if (overrides.submarkets !== undefined) state.submarkets = new Set(overrides.submarkets);
    if (overrides.scYear !== undefined) state.scYear = overrides.scYear;
  }
  if (yocOverrides) {
    if (yocOverrides.targetYoc != null) yocState.targetYoc = yocOverrides.targetYoc;
    if (yocOverrides.opex != null) yocState.opex = yocOverrides.opex;
    if (yocOverrides.unitSize != null) yocState.unitSize = yocOverrides.unitSize;
    if (yocOverrides.costs) {
      for (const prod of Object.keys(yocOverrides.costs)) {
        if (yocState.costs[prod]) Object.assign(yocState.costs[prod], yocOverrides.costs[prod]);
      }
    }
  }

  let html;
  try {
    const data = collectMarketReportV2Data();
    html = buildMarketReportV2Html(data, sections, reportOptions);
  } finally {
    if (snap) {
      state.status = snap.status; state.classes = snap.classes;
      state.productTypes = snap.productTypes; state.cities = snap.cities;
      state.submarkets = snap.submarkets; state.scYear = snap.scYear;
    }
    if (yocSnap) {
      yocState.targetYoc = yocSnap.targetYoc; yocState.opex = yocSnap.opex;
      yocState.unitSize = yocSnap.unitSize; yocState.costs = yocSnap.costs;
    }
  }

  if (reportOptions.returnHtml) return html;

  const w = window.open('', '_blank', 'width=1100,height=900');
  if (!w) {
    alert('Pop-up blocked. Please allow pop-ups for this site to export PDFs.');
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
}

/* ------------------------------------------------------------------
   DATA — mirrors the original report's calculations
   ------------------------------------------------------------------ */
function collectMarketReportV2Data() {
  const inScope = p => {
    if (state.productTypes.size > 0 && !state.productTypes.has(p.style)) return false;
    if (state.cities.size > 0 && !state.cities.has(p.city)) return false;
    if (state.submarkets.size > 0 && !state.submarkets.has(p.submarket)) return false;
    return true;
  };
  const all = RAW_DATA.map(applyUserEdits);
  const existing = all.filter(p => p.status === 'Existing' && matchesClass(p) && inScope(p));
  const uc = all.filter(p => p.status === 'Under Construction' && !isPlannedProposed(p) && inScope(p));
  const sum = (arr, k) => arr.reduce((s, p) => s + (p[k] || 0), 0);
  const wavg = (arr, k) => weightedAvg(arr, k, 'units');

  // --- Overview KPIs
  const kpi = {
    props: existing.length, units: sum(existing, 'units'),
    rent: wavg(existing, 'avgAskingUnit'), psf: wavg(existing, 'avgAskingSF'),
    vac: wavg(existing, 'vacancy'), conc: wavg(existing, 'concessions'),
    ucProjects: uc.length, ucUnits: sum(uc, 'units'),
  };
  kpi.occ = kpi.vac == null ? null : 100 - kpi.vac;

  // --- Rent by submarket (top 10 by asking $/SF, as in the dashboard chart)
  const bySm = {};
  for (const p of existing) {
    const k = p.submarket || 'Unassigned';
    (bySm[k] = bySm[k] || []).push(p);
  }
  const smRent = Object.entries(bySm).map(([name, ps]) => ({ name, props: ps.length, psf: wavg(ps, 'avgAskingSF') }))
    .filter(r => r.psf != null).sort((a, b) => b.psf - a.psf);

  // --- Unit mix (share of units by bedroom type)
  const mixKeys = [['Studio', 'unitsStudio'], ['1BR', 'units1Bed'], ['2BR', 'units2Bed'], ['3BR', 'units3Bed'], ['4BR', 'units4Bed']];
  const unitMix = mixKeys.map(([label, key]) => ({ label, units: sum(existing, key) }));

  // --- Delivery vintage: units by year built, existing vs under construction
  const vintageYears = []; for (let y = CURRENT_YEAR - 10; y <= CURRENT_YEAR + 2; y++) vintageYears.push(y);
  const pipeDate = p => monthYearToDate(p.monthBuilt, p.yearBuilt);
  const vintage = vintageYears.map(y => ({
    year: y,
    existing: existing.filter(p => p.yearBuilt === y).reduce((s, p) => s + (p.units || 0), 0),
    uc: uc.filter(p => { const d = pipeDate(p); return (d ? d.getFullYear() : p.yearBuilt) === y; }).reduce((s, p) => s + (p.units || 0), 0),
  }));

  // --- Lease-up (same helper as the Absorption view; honors leaseVelocity)
  const leaseUp = getAbsorptionData().slice().sort((a, b) => b.absorption - a.absorption);
  const velocity = state.leaseVelocity || 25;
  const stabOutlook = (() => {
    const g = {};
    for (const p of leaseUp) {
      const sm = p.submarket || 'Unknown';
      if (!g[sm]) g[sm] = { submarket: sm, properties: [], totalUnits: 0, totalLeased: 0 };
      g[sm].properties.push(p); g[sm].totalUnits += p.units || 0; g[sm].totalLeased += p.leasedUnits || 0;
    }
    return Object.values(g).map(x => {
      const unstab = x.properties.filter(p => !p.stabilized);
      let outside = null, months = 0;
      for (const p of unstab) if (p.stabilizationDate && (!outside || p.stabilizationDate > outside)) { outside = p.stabilizationDate; months = p.stabilizationMonths || 0; }
      const isStabilized = unstab.length === 0;
      return { ...x, isStabilized, monthsToStab: isStabilized ? 0 : months, stabDate: isStabilized ? null : outside,
               leasedPct: x.totalUnits > 0 ? x.totalLeased / x.totalUnits * 100 : 0 };
    }).sort((a, b) => (a.isStabilized === b.isStabilized ? a.monthsToStab - b.monthsToStab : a.isStabilized ? -1 : 1));
  })();

  // --- Pipeline
  const pipeline = uc.map(p => ({ ...p, delivery: pipeDate(p) }))
    .sort((a, b) => (a.delivery ? a.delivery.getTime() : Infinity) - (b.delivery ? b.delivery.getTime() : Infinity));

  // --- Unit size analysis (shared helper)
  const unitTypes = UNIT_MIX_TYPES.map(type => {
    const a = computeUnitMixAnalysis(type, existing);
    return { label: type.label, rows: a.rows, bestIdx: a.bestIdx, units: a.typeTotalUnits };
  });

  // --- Yield-on-cost matrix (same math as the YOC view: asking $/SF by
  //     submarket x product, unit-weighted average and best comp)
  const yoc = (() => {
    const grouped = {};
    for (const p of existing) {
      if (!p.submarket || !p.avgAskingSF) continue;
      const col = yocColumnFor(p.style); if (!col) continue;
      if (!grouped[p.submarket]) grouped[p.submarket] = { 'Garden': [], 'Mid-Rise': [], 'High-Rise': [] };
      grouped[p.submarket][col].push(p);
    }
    const rows = Object.keys(grouped).map(sm => {
      const ids = new Set(); let units = 0;
      const cells = YOC_PRODUCT_COLUMNS.map(prod => {
        const ps = grouped[sm][prod];
        ps.forEach(p => { if (!ids.has(p.id)) { ids.add(p.id); units += p.units || 0; } });
        const w = ps.filter(p => p.units);
        const avg = w.length ? w.reduce((s, p) => s + p.avgAskingSF * p.units, 0) / w.reduce((s, p) => s + p.units, 0)
          : (ps.length ? ps.reduce((s, p) => s + p.avgAskingSF, 0) / ps.length : null);
        const bestP = ps.length ? ps.reduce((a, b) => a.avgAskingSF > b.avgAskingSF ? a : b) : null;
        const best = bestP ? bestP.avgAskingSF : null;
        return { prod, avg, best, rocAvg: rocFromPsf(avg, prod, yocState.unitSize, sm), rocBest: rocFromPsf(best, prod, yocState.unitSize, sm) };
      });
      const maxAvg = Math.max(...cells.map(c => c.avg == null ? -Infinity : c.avg));
      return { sm, props: ids.size, units, cells, maxAvg };
    }).sort((a, b) => b.maxAvg - a.maxAvg);
    const required = YOC_PRODUCT_COLUMNS.map(prod => ({ prod, psf: requiredPsfRent(prod, yocState.unitSize) }));
    const floor = yocState.targetYoc - 0.0015;
    const clears = [];
    rows.forEach(r => r.cells.forEach(c => { if (c.rocAvg != null && c.rocAvg >= floor) clears.push({ sm: r.sm, prod: c.prod, psf: c.avg, roc: c.rocAvg }); }));
    clears.sort((a, b) => b.roc - a.roc);
    return { rows, required, clears, floor };
  })();

  // --- Sale comps (same year + location matching as the original report)
  const filterComps = arr => {
    let out = arr;
    if (state.scYear !== 'all') out = out.filter(r => { const m = /^(\d{4})/.exec(String(r.saleDate || '')); return m && m[1] === state.scYear; });
    const loc = new Set([...state.cities, ...state.submarkets]);
    if (loc.size) out = out.filter(r => {
      const c = r.city || '', s = r.submarket || '';
      if (loc.has(c) || loc.has(s)) return true;
      for (const l of loc) if ((c && (c.includes(l) || l.includes(c))) || (s && (s.includes(l) || l.includes(s)))) return true;
      return false;
    });
    return out;
  };
  const invComps = filterComps(getAllComps('investment'));
  const landComps = filterComps(getAllComps('land'));

  const rp = (typeof RP_FORECAST !== 'undefined' && RP_FORECAST['Market']) ? RP_FORECAST['Market'] : null;

  const scope = {
    status: state.status === 'all' ? 'All Statuses · Existing + Pipeline' : state.status,
    classes: classLabel(),
    products: state.productTypes.size === 0 ? 'All Product Types' : [...state.productTypes].sort().join(', '),
    cities: state.cities.size === 0 ? 'All Portland MSA' : [...state.cities].sort().join(', '),
    submarkets: state.submarkets.size === 0 ? 'All Submarkets' : [...state.submarkets].sort().join(', '),
    scYear: state.scYear === 'all' ? 'All Years' : state.scYear,
    label: state.submarkets.size === 1 ? [...state.submarkets][0]
         : state.submarkets.size > 1 ? `${state.submarkets.size} Submarkets`
         : state.cities.size === 1 ? [...state.cities][0]
         : state.cities.size > 1 ? `${state.cities.size} Cities`
         : REPORT_V2.marketName,
    selectedSubmarkets: [...state.submarkets],
  };

  return { existing, uc, kpi, smRent, unitMix, vintage, leaseUp, velocity, stabOutlook, pipeline,
           unitTypes, yoc, invComps, landComps, rp, scope };
}



/* ------------------------------------------------------------------
   FORMATTERS
   ------------------------------------------------------------------ */
const RV2F = {
  int: n => n == null || isNaN(n) ? '—' : Math.round(n).toLocaleString('en-US'),
  money: n => n == null || isNaN(n) ? '—' : '$' + Math.round(n).toLocaleString('en-US'),
  money2: n => n == null || isNaN(n) ? '—' : '$' + n.toFixed(2),
  pct1: n => n == null || isNaN(n) ? '—' : n.toFixed(1) + '%',
  pct0: n => n == null || isNaN(n) ? '—' : Math.round(n) + '%',
  // signed percent from a decimal (RealPage stores growth as 0.012)
  sPctD: n => n == null || isNaN(n) ? '—' : (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n * 100).toFixed(1) + '%',
  pctD: n => n == null || isNaN(n) ? '—' : (n * 100).toFixed(1) + '%',
  signedInt: n => n == null || isNaN(n) ? '—' : (n < 0 ? '−' : '') + Math.abs(Math.round(n)).toLocaleString('en-US'),
  mon: d => d ? d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '—',
  long: d => d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
  longUTC: d => d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }),
  monUTC: d => d.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }),
  monthYearLong: d => d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
};
const rv2esc = s => (typeof escapeHTML === 'function') ? escapeHTML(s == null ? '' : String(s)) : String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ------------------------------------------------------------------
   SVG CHARTS — small, dependency-free, print-first
   ------------------------------------------------------------------ */
const RV2_FONT = "'Inter Tight', Inter, Arial, sans-serif";

function rv2NiceMax(v) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const m = v / p;
  const step = m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10;
  return step * p;
}
function rv2Ticks(min, max, n) {
  const span = max - min;
  const raw = span / n;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  const step = (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const t = [];
  for (let v = lo; v <= hi + step / 1e6; v += step) t.push(+v.toFixed(10));
  return t;
}

// Vertical bars over categorical years. series: [{name, color, values[]}], grouped.
// opts: { width, height, yFmt, shadeFrom (fractional category index), shadeLabel, todayLabel, stacked }
function rv2Columns(cats, series, opts) {
  const C = REPORT_V2.colors;
  const W = opts.width || 680, H = opts.height || 230;
  const pl = 46, pr = 10, pt = 26, pb = 24;
  const iw = W - pl - pr, ih = H - pt - pb;
  let lo = 0, hi = 0;
  if (opts.stacked) {
    cats.forEach((_, i) => {
      let pos = 0, neg = 0;
      series.forEach(s => { const v = s.values[i] || 0; if (v >= 0) pos += v; else neg += v; });
      hi = Math.max(hi, pos); lo = Math.min(lo, neg);
    });
  } else {
    series.forEach(s => s.values.forEach(v => { if (v != null) { hi = Math.max(hi, v); lo = Math.min(lo, v); } }));
  }
  const ticks = rv2Ticks(lo, hi * 1.05, 5);
  const ymin = Math.min(0, ticks[0]), ymax = ticks[ticks.length - 1];
  const y = v => pt + (1 - (v - ymin) / (ymax - ymin)) * ih;
  const band = iw / cats.length;
  const x0 = i => pl + i * band;
  const out = [];
  out.push(`<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" font-family="${RV2_FONT}" class="rv2-svg">`);
  if (opts.shadeFrom != null) {
    const sx = pl + opts.shadeFrom * band;
    out.push(`<rect x="${sx.toFixed(1)}" y="${pt}" width="${(pl + iw - sx).toFixed(1)}" height="${ih}" fill="${C.lilac50}" opacity="0.7"/>`);
    out.push(`<line x1="${sx.toFixed(1)}" x2="${sx.toFixed(1)}" y1="${pt - 4}" y2="${pt + ih}" stroke="${C.purple}" stroke-width="0.8" stroke-dasharray="3 2"/>`);
    out.push(`<text x="${(sx - 4).toFixed(1)}" y="${pt - 8}" font-size="8" fill="${C.purple}" text-anchor="end">${rv2esc(opts.todayLabel || 'Today')}</text>`);
    out.push(`<text x="${(pl + iw - 2).toFixed(1)}" y="${pt - 8}" font-size="8" fill="${C.purple}" text-anchor="end">${rv2esc(opts.shadeLabel || 'Forecast')}</text>`);
  }
  ticks.forEach(t => {
    if (t < ymin - 1e-9 || t > ymax + 1e-9) return;
    out.push(`<line x1="${pl}" x2="${pl + iw}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}" stroke="${t === 0 ? '#9A96A6' : C.grid}" stroke-width="${t === 0 ? 0.8 : 0.6}"/>`);
    out.push(`<text x="${pl - 6}" y="${(y(t) + 3).toFixed(1)}" font-size="8" fill="${C.muted}" text-anchor="end">${rv2esc(opts.yFmt ? opts.yFmt(t) : t)}</text>`);
  });
  const nS = opts.stacked ? 1 : series.length;
  const gw = band * (opts.groupPct || 0.72), bw = gw / nS;
  cats.forEach((c, i) => {
    if (opts.stacked) {
      let pos = 0;
      series.forEach(s => {
        const v = s.values[i] || 0; if (!v) return;
        const yTop = y(pos + v), yBot = y(pos);
        out.push(`<rect x="${(x0(i) + (band - gw) / 2).toFixed(1)}" y="${yTop.toFixed(1)}" width="${gw.toFixed(1)}" height="${Math.max(0, yBot - yTop).toFixed(1)}" fill="${s.color}"/>`);
        pos += v;
      });
      if (opts.totalLabels && pos > 0) out.push(`<text x="${(x0(i) + band / 2).toFixed(1)}" y="${(y(pos) - 3).toFixed(1)}" font-size="7.5" fill="${C.ink}" text-anchor="middle">${rv2esc(opts.yFmt ? opts.yFmt(pos) : pos)}</text>`);
    } else {
      series.forEach((s, j) => {
        const v = s.values[i]; if (v == null) return;
        const bx = x0(i) + (band - gw) / 2 + j * bw;
        const y1 = y(Math.max(0, v)), y2 = y(Math.min(0, v));
        out.push(`<rect x="${bx.toFixed(1)}" y="${y1.toFixed(1)}" width="${(bw - 0.8).toFixed(1)}" height="${Math.max(0.6, y2 - y1).toFixed(1)}" fill="${s.color}"/>`);
      });
    }
    const every = opts.labelEvery || 1;
    if (i % every === 0) out.push(`<text x="${(x0(i) + band / 2).toFixed(1)}" y="${H - 8}" font-size="8" fill="${C.muted}" text-anchor="middle">${rv2esc(c)}</text>`);
  });
  out.push(`</svg>`);
  return out.join('');
}

// Line chart over numeric years. series: [{name, color, values[], width, dash}]
function rv2Lines(years, series, opts) {
  const C = REPORT_V2.colors;
  const W = opts.width || 330, H = opts.height || 200;
  const pl = 40, pr = 10, pt = 26, pb = 24;
  const iw = W - pl - pr, ih = H - pt - pb;
  let lo = Infinity, hi = -Infinity;
  series.forEach(s => s.values.forEach(v => { if (v != null) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }));
  if (opts.includeZero) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
  const pad = (hi - lo) * 0.08 || 1;
  const ticks = rv2Ticks(lo - pad, hi + pad, 4);
  const ymin = ticks[0], ymax = ticks[ticks.length - 1];
  const x = i => pl + (i / (years.length - 1)) * iw;
  const y = v => pt + (1 - (v - ymin) / (ymax - ymin)) * ih;
  const out = [];
  out.push(`<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" font-family="${RV2_FONT}" class="rv2-svg">`);
  if (opts.shadeFrom != null) {
    const sx = pl + (opts.shadeFrom / (years.length - 1)) * iw;
    out.push(`<rect x="${sx.toFixed(1)}" y="${pt}" width="${(pl + iw - sx).toFixed(1)}" height="${ih}" fill="${C.lilac50}" opacity="0.7"/>`);
    out.push(`<line x1="${sx.toFixed(1)}" x2="${sx.toFixed(1)}" y1="${pt - 4}" y2="${pt + ih}" stroke="${C.purple}" stroke-width="0.8" stroke-dasharray="3 2"/>`);
    out.push(`<text x="${(sx - 4).toFixed(1)}" y="${pt - 8}" font-size="8" fill="${C.purple}" text-anchor="end">Today</text>`);
    out.push(`<text x="${(pl + iw - 2).toFixed(1)}" y="${pt - 8}" font-size="8" fill="${C.purple}" text-anchor="end">Forecast</text>`);
  }
  ticks.forEach(t => {
    out.push(`<line x1="${pl}" x2="${pl + iw}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}" stroke="${Math.abs(t) < 1e-9 ? '#9A96A6' : C.grid}" stroke-width="${Math.abs(t) < 1e-9 ? 0.8 : 0.6}"/>`);
    out.push(`<text x="${pl - 6}" y="${(y(t) + 3).toFixed(1)}" font-size="8" fill="${C.muted}" text-anchor="end">${rv2esc(opts.yFmt ? opts.yFmt(t) : t)}</text>`);
  });
  series.forEach(s => {
    const pts = s.values.map((v, i) => v == null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`).filter(Boolean);
    out.push(`<polyline points="${pts.join(' ')}" fill="none" stroke="${s.color}" stroke-width="${s.width || 1.8}" stroke-linejoin="round" ${s.dash ? `stroke-dasharray="${s.dash}"` : ''}/>`);
    if (s.endLabel) {
      const li = s.values.length - 1;
      if (s.values[li] != null) out.push(`<circle cx="${x(li).toFixed(1)}" cy="${y(s.values[li]).toFixed(1)}" r="2" fill="${s.color}"/>`);
    }
  });
  const every = opts.labelEvery || 2;
  years.forEach((yr, i) => { if (i % every === 0 || i === years.length - 1) out.push(`<text x="${x(i).toFixed(1)}" y="${H - 8}" font-size="8" fill="${C.muted}" text-anchor="middle">${yr}</text>`); });
  out.push(`</svg>`);
  return out.join('');
}

// Horizontal bars. rows: [{label, value, color?}], opts: {width, rowH, fmt, ref, refLabel, max}
function rv2HBars(rows, opts) {
  const C = REPORT_V2.colors;
  const W = opts.width || 330, rowH = opts.rowH || 13;
  const labW = opts.labelWidth || 118, valW = 44, pt = opts.ref != null ? 14 : 4, pb = 4;
  const H = pt + rows.length * rowH + pb;
  const iw = W - labW - valW - 8;
  const max = opts.max || Math.max(...rows.map(r => r.value || 0), opts.ref || 0) * 1.04;
  const min = opts.min || 0;
  const xs = v => labW + ((v - min) / (max - min)) * iw;
  const out = [];
  out.push(`<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" font-family="${RV2_FONT}" class="rv2-svg">`);
  rows.forEach((r, i) => {
    const yy = pt + i * rowH;
    if (i % 2 === 0) out.push(`<rect x="0" y="${yy}" width="${W}" height="${rowH}" fill="${C.zebra}"/>`);
    out.push(`<text x="${labW - 6}" y="${(yy + rowH / 2 + 2.8).toFixed(1)}" font-size="7.6" fill="${C.ink}" text-anchor="end">${rv2esc(r.label)}</text>`);
    if (r.value != null) {
      const bw = Math.max(0.8, xs(r.value) - labW);
      out.push(`<rect x="${labW}" y="${(yy + rowH * 0.2).toFixed(1)}" width="${bw.toFixed(1)}" height="${(rowH * 0.6).toFixed(1)}" fill="${r.color || C.purple}"/>`);
      out.push(`<text x="${W - 2}" y="${(yy + rowH / 2 + 2.8).toFixed(1)}" font-size="7.6" fill="${C.ink}" text-anchor="end">${rv2esc(opts.fmt ? opts.fmt(r.value) : r.value)}</text>`);
    }
  });
  if (opts.ref != null) {
    const rx = xs(opts.ref);
    out.push(`<line x1="${rx.toFixed(1)}" x2="${rx.toFixed(1)}" y1="${pt - 2}" y2="${H - pb}" stroke="${C.midnight}" stroke-width="0.8" stroke-dasharray="3 2"/>`);
    out.push(`<text x="${rx.toFixed(1)}" y="${pt - 5}" font-size="7.4" fill="${C.midnight}" text-anchor="middle">${rv2esc(opts.refLabel || '')}</text>`);
  }
  out.push(`</svg>`);
  return out.join('');
}

// 100% stacked single bar for unit mix
function rv2MixBar(parts, opts) {
  const W = opts.width || 680, H = 34;
  let x = 0;
  const out = [`<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" font-family="${RV2_FONT}" class="rv2-svg">`];
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  parts.forEach(p => {
    const w = p.value / total * W;
    out.push(`<rect x="${x.toFixed(1)}" y="0" width="${w.toFixed(1)}" height="20" fill="${p.color}"/>`);
    if (w > 46) out.push(`<text x="${(x + 6).toFixed(1)}" y="13.5" font-size="8" fill="${p.text || '#fff'}">${rv2esc(p.label)} ${(p.value / total * 100).toFixed(0)}%</text>`);
    x += w;
  });
  out.push(`</svg>`);
  return out.join('');
}

function rv2Legend(items) {
  return `<div class="legend">${items.map(i => `<span class="lg"><i style="background:${i.color}${i.dash ? ';height:0;border-top:2px dashed ' + i.color : ''}"></i>${rv2esc(i.label)}</span>`).join('')}</div>`;
}
// Donut chart with a right-hand legend
function rv2Donut(parts, opts) {
  const W = opts.width || 330, H = opts.height || 200;
  const cx = 95, cy = H / 2, r = Math.min(88, H / 2 - 6), ir = r * 0.58;
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  let a0 = -Math.PI / 2;
  const out = [`<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" font-family="${RV2_FONT}" class="rv2-svg">`];
  const pt = (rad, a) => `${(cx + rad * Math.cos(a)).toFixed(2)},${(cy + rad * Math.sin(a)).toFixed(2)}`;
  parts.forEach(p => {
    if (!p.value) return;
    const a1 = a0 + p.value / total * Math.PI * 2;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    out.push(`<path d="M${pt(r, a0)} A${r},${r} 0 ${large} 1 ${pt(r, a1)} L${pt(ir, a1)} A${ir},${ir} 0 ${large} 0 ${pt(ir, a0)} Z" fill="${p.color}" stroke="#fff" stroke-width="1"/>`);
    a0 = a1;
  });
  const lx = 205; let ly = cy - parts.length * 9 + 6;
  parts.forEach(p => {
    out.push(`<rect x="${lx}" y="${ly - 7}" width="8" height="8" fill="${p.color}"/>`);
    out.push(`<text x="${lx + 13}" y="${ly}" font-size="8.2" fill="${REPORT_V2.colors.ink}">${rv2esc(p.label)}</text>`);
    out.push(`<text x="${W - 4}" y="${ly}" font-size="8.2" fill="${REPORT_V2.colors.ink}" text-anchor="end">${(p.value / total * 100).toFixed(1)}%</text>`);
    ly += 18;
  });
  out.push('</svg>');
  return out.join('');
}

// Horizontal stacked bars (pipeline by submarket, split by product)
function rv2HStack(rows, series, opts) {
  const C = REPORT_V2.colors;
  const W = opts.width || 330, rowH = opts.rowH || 14, labW = opts.labelWidth || 110, valW = 38;
  const H = rows.length * rowH + 6;
  const max = Math.max(...rows.map(r => r.total)) * 1.04;
  const iw = W - labW - valW - 8;
  const out = [`<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" font-family="${RV2_FONT}" class="rv2-svg">`];
  rows.forEach((r, i) => {
    const y = i * rowH + 2;
    if (i % 2 === 0) out.push(`<rect x="0" y="${y}" width="${W}" height="${rowH}" fill="${C.zebra}"/>`);
    out.push(`<text x="${labW - 6}" y="${(y + rowH / 2 + 2.8).toFixed(1)}" font-size="7.6" fill="${C.ink}" text-anchor="end">${rv2esc(r.label)}</text>`);
    let x = labW;
    series.forEach(s => {
      const v = r.values[s.key] || 0; if (!v) return;
      const w = v / max * iw;
      out.push(`<rect x="${x.toFixed(1)}" y="${(y + rowH * 0.2).toFixed(1)}" width="${w.toFixed(1)}" height="${(rowH * 0.6).toFixed(1)}" fill="${s.color}"/>`);
      x += w;
    });
    out.push(`<text x="${W - 2}" y="${(y + rowH / 2 + 2.8).toFixed(1)}" font-size="7.6" fill="${C.ink}" text-anchor="end">${RV2F.int(r.total)}</text>`);
  });
  out.push('</svg>');
  return out.join('');
}

/* ------------------------------------------------------------------
   DOCUMENT — original report structure, new design
   ------------------------------------------------------------------ */
function buildMarketReportV2Html(D, sections, opts) {
  const C = REPORT_V2.colors;
  const now = new Date();
  const dataAsOf = RV2F.longUTC(TODAY);
  const reportDate = RV2F.long(now);
  const reportMonth = RV2F.monthYearLong(now);
  const title = opts.reportTitle && opts.reportTitle !== 'Market Report' ? opts.reportTitle : 'Market Report';
  const subtitle = opts.reportSubtitle || D.scope.label;
  const cy = CURRENT_YEAR;
  const k = D.kpi;
  const yStart = new Date(now.getFullYear(), 0, 1), yEnd = new Date(now.getFullYear() + 1, 0, 1);
  const yearFrac = (now - yStart) / (yEnd - yStart);

  let figNo = 0, tabNo = 0;
  const SRC_COSTAR = `CoStar multifamily property data (export as of ${dataAsOf})`;
  const SRC_RP = `RealPage Annual Performance, ${REPORT_V2.marketLong} (actuals through ${REPORT_V2.rpAsOf}; ${REPORT_V2.rpForecastFrom} is a full-year estimate; ${REPORT_V2.rpForecastFrom + 1}–${REPORT_V2.forecastEnd} forecast)`;

  const sectionHead = (titleHtml, sub) => `
    <header class="sec-head">
      <div class="sec-title-row"><img class="sec-mark" src="${REPORT_V2.mark}" alt=""><h1>${titleHtml}</h1></div>
      ${sub ? `<div class="sec-sub">${sub}</div>` : ''}
    </header>`;
  const exhibit = (kind, heading, sub, body, source, cls) => {
    const n = kind === 'Table' ? ++tabNo : ++figNo;
    return `
      <figure class="exhibit ${cls || ''}">
        <figcaption><span class="ex-no">${kind} ${n}</span><span class="ex-title">${heading}</span>${sub ? `<span class="ex-sub">${sub}</span>` : ''}</figcaption>
        <div class="ex-body">${body}</div>
        ${source ? `<div class="ex-source">Source: ${source}</div>` : ''}
      </figure>`;
  };
  const kpiTile = (label, value, sub) => `<div class="kpi"><div class="kpi-l">${label}</div><div class="kpi-v">${value}</div><div class="kpi-s">${sub || '&nbsp;'}</div></div>`;
  const prodColor = { 'Garden': C.sand, 'Mid-Rise': C.purple, 'High-Rise': C.midnight };
  const normProd = s => ['Garden', 'Mid-Rise', 'High-Rise'].includes(s) ? s : (/hi/i.test(s || '') ? 'High-Rise' : /mid|low/i.test(s || '') ? 'Mid-Rise' : 'Garden');

  /* ---------------- 1. Market Overview ---------------- */
  const overviewHtml = !sections.overview ? '' : (() => {
    const top = D.smRent.slice(0, 10);
    const rentBars = rv2HBars(top.map(r => ({ label: r.name, value: r.psf })),
      { width: 690, rowH: 17, fmt: v => '$' + v.toFixed(2) + ' / SF', labelWidth: 150, ref: k.psf, refLabel: `Market avg $${k.psf.toFixed(2)}` });
    const mixColors = [C.lilac, C.purple, C.midnight, C.forest, C.sand];
    const donut = rv2Donut(D.unitMix.filter(m => m.units > 0).map((m, i) => ({ label: m.label, value: m.units, color: mixColors[i] })), { width: 330, height: 190 });
    const vint = rv2Columns(D.vintage.map(v => String(v.year)), [
      { name: 'Existing', color: C.midnight, values: D.vintage.map(v => v.existing) },
      { name: 'Under construction', color: C.lilac, values: D.vintage.map(v => v.uc) },
    ], { width: 330, height: 190, yFmt: v => v >= 1000 ? (v / 1000) + 'k' : v, stacked: true, groupPct: 0.66, labelEvery: 2 });
    return `
    <section class="page">
      ${sectionHead('Market <em>Overview</em>', 'Headline supply &amp; rent metrics · Weighted by unit count')}
      <div class="kpi-row six">
        ${kpiTile('Inventory · Units', RV2F.int(k.units), `${RV2F.int(k.props)} properties`)}
        ${kpiTile('Avg Asking Rent', RV2F.money(k.rent), 'Weighted by units')}
        ${kpiTile('Avg Rent / SF', RV2F.money2(k.psf), 'Weighted by units')}
        ${kpiTile('Occupancy', RV2F.pct1(k.occ), `Vacancy ${RV2F.pct1(k.vac)}`)}
        ${kpiTile('Concessions', RV2F.pct1(k.conc), 'Weighted avg')}
        ${kpiTile('Under Construction', RV2F.int(k.ucProjects), `${RV2F.int(k.ucUnits)} units · ${rv2esc(D.scope.classes)}`)}
      </div>
      ${exhibit('Figure', 'Rent distribution by submarket', 'Average asking rent per SF, unit-weighted · Top 10 submarkets', rentBars, SRC_COSTAR)}
      <div class="two-col">
        ${exhibit('Figure', 'Unit mix', 'Share of units by bedroom type, existing properties', donut, SRC_COSTAR)}
        ${exhibit('Figure', 'Delivery vintage', 'Units by year built; under construction by scheduled delivery',
          rv2Legend([{ label: 'Existing', color: C.midnight }, { label: 'Under construction', color: C.lilac }]) + vint, SRC_COSTAR)}
      </div>
    </section>`;
  })();

  /* ---------------- 2. Lease-Up · Recent Deliveries ---------------- */
  const leaseUpHtml = (!sections.leaseUp || !D.leaseUp.length) ? '' : (() => {
    const L = D.leaseUp;
    const bars = rv2HBars(L.map(p => ({ label: p.name, value: p.absorption })),
      { width: 690, rowH: 13.5, fmt: v => v.toFixed(1), labelWidth: 170 });
    const top = L.slice(0, 12);
    const stab = p => p.stabilized ? '<span class="ok">Stabilized</span>' : (p.stabilizationDate ? RV2F.mon(p.stabilizationDate) : '—');
    const table = `
      <table class="grid dense">
        <colgroup><col style="width:25%"><col style="width:14%"><col style="width:9%"><col style="width:7%"><col style="width:10%"><col style="width:8%"><col style="width:9%"><col style="width:8%"><col style="width:10%"></colgroup>
        <thead><tr><th>Property</th><th>Submarket</th><th>Product</th><th class="num">Units</th><th class="num">Delivered</th><th class="num">Months open</th><th class="num">Leased</th><th class="num">Leases / mo</th><th class="num">Est. stabilized</th></tr></thead>
        <tbody>${top.map(p => `
          <tr>
            <td><div class="nm">${rv2esc(p.name)}</div><div class="ad">${rv2esc(p.address || '')}</div></td>
            <td>${rv2esc(p.submarket || '—')}</td><td>${rv2esc(p.style || '—')}</td>
            <td class="num">${RV2F.int(p.units)}</td><td class="num">${RV2F.mon(p.deliveryDate)}</td>
            <td class="num">${p.hasDayPrecision ? p.months.toFixed(1) : Math.round(p.months)}</td>
            <td class="num">${RV2F.pct1(p.occupancy)}</td><td class="num">${p.absorption.toFixed(1)}</td><td class="num">${stab(p)}</td>
          </tr>`).join('')}</tbody>
      </table>`;
    const S = D.stabOutlook;
    const xMax = Math.ceil(Math.max(6, ...S.filter(s => !s.isStabilized).map(s => s.monthsToStab)) / 6) * 6;
    const stabRows = S.map(s => {
      const pct = s.isStabilized ? 100 : Math.max(2, (xMax - s.monthsToStab) / xMax * 100);
      const col = s.isStabilized ? C.forest : s.monthsToStab <= 6 ? C.midnight : s.monthsToStab <= 12 ? C.purple : '#8B6B9E';
      const label = s.isStabilized ? 'Stabilized' : (s.stabDate ? RV2F.mon(s.stabDate) : '—');
      return `<tr>
        <td>${rv2esc(s.submarket)}</td><td class="num">${s.properties.length}</td><td class="num">${RV2F.int(s.totalUnits)}</td>
        <td class="num">${s.leasedPct.toFixed(1)}%</td>
        <td><div class="pbar"><i style="width:${pct.toFixed(1)}%;background:${col}"></i></div></td>
        <td class="num" style="color:${col};font-weight:600">${label}</td></tr>`;
    }).join('');
    const stabTable = `
      <table class="grid dense">
        <colgroup><col style="width:22%"><col style="width:8%"><col style="width:9%"><col style="width:9%"><col style="width:38%"><col style="width:14%"></colgroup>
        <thead><tr><th>Submarket</th><th class="num">Props</th><th class="num">Units</th><th class="num">Leased</th><th>Progress to 95% leased</th><th class="num">Est. stabilization</th></tr></thead>
        <tbody>${stabRows}</tbody>
      </table>`;
    return `
    <section class="page">
      ${sectionHead('Lease-Up · <em>Recent Deliveries</em>', `Last 12 months · ${L.length} properties · Top 12 by absorption`)}
      ${exhibit('Figure', 'Top properties by leases / month', 'Occupied units divided by months since delivery', bars, SRC_COSTAR)}
      ${exhibit('Table', 'Lease-up performance', 'Top 12 properties by leases / month', table, `${SRC_COSTAR}. Est. stabilized assumes ${D.velocity} leases / month from today.`, 'flow')}
      ${exhibit('Table', 'Stabilization outlook by submarket', `Projected stabilization assumes ${D.velocity} leases / mo per unstabilized property. Fuller bar = closer to stabilized.`, stabTable, SRC_COSTAR, 'flow')}
    </section>`;
  })();

  /* ---------------- 3. Pipeline · Supply ---------------- */
  const pipelineHtml = (!sections.pipeline || !D.pipeline.length) ? '' : (() => {
    const P = D.pipeline;
    const prods = ['Garden', 'Mid-Rise', 'High-Rise'];
    const qKey = d => `Q${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear()}`;
    const dated = P.filter(p => p.delivery).sort((a, b) => a.delivery - b.delivery);
    const quarters = [...new Set(dated.map(p => qKey(p.delivery)))];
    const series = prods.map(pr => ({ name: pr, color: prodColor[pr], values: quarters.map(q => dated.filter(p => qKey(p.delivery) === q && normProd(p.style) === pr).reduce((s, p) => s + (p.units || 0), 0)) }));
    const timeline = rv2Columns(quarters, series, { width: 335, height: 205, yFmt: v => RV2F.int(v), stacked: true, totalLabels: true, groupPct: 0.62 });
    const smMap = {};
    P.forEach(p => { const r = smMap[p.submarket] = smMap[p.submarket] || { label: p.submarket, values: {}, total: 0 }; const pr = normProd(p.style); r.values[pr] = (r.values[pr] || 0) + (p.units || 0); r.total += p.units || 0; });
    const smRows = Object.values(smMap).sort((a, b) => b.total - a.total);
    const smChart = rv2HStack(smRows, prods.map(pr => ({ key: pr, color: prodColor[pr] })), { width: 335, rowH: 14.5, labelWidth: 110 });
    const legend = rv2Legend(prods.map(p => ({ label: p, color: prodColor[p] })));
    const table = `
      <table class="grid dense">
        <colgroup><col style="width:26%"><col style="width:11%"><col style="width:15%"><col style="width:9%"><col style="width:23%"><col style="width:7%"><col style="width:9%"></colgroup>
        <thead><tr><th>Project</th><th>City</th><th>Submarket</th><th>Product</th><th>Developer</th><th class="num">Units</th><th class="num">Est. delivery</th></tr></thead>
        <tbody>${P.map(p => `
          <tr>
            <td><div class="nm">${rv2esc(p.name || p.address || '—')}</div>${p.name && p.address && p.name !== p.address ? `<div class="ad">${rv2esc(p.address)}</div>` : ''}</td>
            <td>${rv2esc(p.city || '—')}</td><td>${rv2esc(p.submarket || '—')}</td><td>${rv2esc(normProd(p.style))}</td>
            <td>${rv2esc(p.developer || '—')}</td><td class="num">${RV2F.int(p.units)}</td><td class="num">${p.delivery ? RV2F.mon(p.delivery) : '—'}</td>
          </tr>`).join('')}
          <tr class="total"><td>Total</td><td></td><td></td><td></td><td></td><td class="num">${RV2F.int(k.ucUnits)}</td><td></td></tr>
        </tbody>
      </table>`;
    return `
    <section class="page">
      ${sectionHead('Pipeline · <em>Supply</em>', `${RV2F.int(P.length)} active projects · ${RV2F.int(k.ucUnits)} units under construction`)}
      <div class="two-col">
        ${exhibit('Figure', 'Delivery timeline', 'Units by scheduled delivery quarter and product', legend + timeline, SRC_COSTAR)}
        ${exhibit('Figure', 'Pipeline by submarket', 'Units under construction by product', legend + smChart, SRC_COSTAR)}
      </div>
      ${exhibit('Table', 'Projects under construction', 'Sorted by estimated delivery', table, `${SRC_COSTAR}. Delivery dates are CoStar estimates.`, 'flow')}
    </section>`;
  })();

  /* ---------------- 4. RealPage · Forecast ---------------- */
  const forecastHtml = (!sections.rpForecast || !D.rp) ? '' : (() => {
    const block = (label, sub, fc) => {
      if (!fc) return '';
      const v = (y, key) => fc[y] && fc[y][key] != null ? fc[y][key] : null;
      const cur = v(cy, 'eR'), t0 = v(cy - 3, 'eR'), end = v(REPORT_V2.forecastEnd, 'eR');
      const tC = cur && t0 ? Math.pow(cur / t0, 1 / 3) - 1 : null;
      const hz = REPORT_V2.forecastEnd - cy;
      const fC = cur && end && hz > 0 ? Math.pow(end / cur, 1 / hz) - 1 : null;
      const yrs = []; for (let y = 2018; y <= REPORT_V2.forecastEnd; y++) yrs.push(y);
      const chart = rv2Lines(yrs, [{ name: 'Effective rent', color: C.purple, values: yrs.map(y => v(y, 'eR')), endLabel: true }],
        { width: 690, height: 170, yFmt: x => '$' + RV2F.int(x), shadeFrom: (cy - 2018) + yearFrac, labelEvery: 1 });
      const tYears = []; for (let y = cy - 3; y <= REPORT_V2.forecastEnd; y++) tYears.push(y);
      const head = tYears.map(y => `<th class="num ${y > cy ? 'fc' : y === cy ? 'cur' : ''}">${y}<span>${y === cy ? 'Est.' : y > cy ? 'Fcst.' : '&nbsp;'}</span></th>`).join('');
      const row = (lab, key, f) => `<tr><td>${lab}</td>${tYears.map(y => `<td class="num ${y > cy ? 'fc' : ''}">${f(v(y, key))}</td>`).join('')}</tr>`;
      const colorCagr = x => x == null ? '' : ` style="color:${x >= 0 ? C.forest : C.brick}"`;
      return `
        <div class="fc-block">
          <div class="fc-head"><div class="fc-title">${rv2esc(label)}</div><div class="fc-sub">${sub}</div></div>
          <div class="kpi-row four">
            <div class="kpi"><div class="kpi-l">${cy} Effective rent (est.)</div><div class="kpi-v">${RV2F.money(cur)}</div><div class="kpi-s">Per unit / month</div></div>
            <div class="kpi"><div class="kpi-l">Trailing 3-yr CAGR</div><div class="kpi-v"${colorCagr(tC)}>${RV2F.sPctD(tC)}</div><div class="kpi-s">${cy - 3}–${cy}</div></div>
            <div class="kpi"><div class="kpi-l">Forecast ${hz}-yr CAGR</div><div class="kpi-v"${colorCagr(fC)}>${RV2F.sPctD(fC)}</div><div class="kpi-s">${cy}–${REPORT_V2.forecastEnd}</div></div>
            <div class="kpi"><div class="kpi-l">${REPORT_V2.forecastEnd} Projection</div><div class="kpi-v">${RV2F.money(end)}</div><div class="kpi-s">RealPage forecast</div></div>
          </div>
          ${exhibit('Figure', `Average effective rent, ${rv2esc(label)}`, 'Per unit per month; shaded area is forecast', chart, '')}
          ${exhibit('Table', `Annual performance, ${rv2esc(label)}`, `${cy} is a full-year estimate; ${cy + 1}–${REPORT_V2.forecastEnd} are forecast`, `
            <table class="grid fcst">
              <colgroup><col style="width:20%">${tYears.map(() => '<col>').join('')}</colgroup>
              <thead><tr><th>Metric</th>${head}</tr></thead>
              <tbody>
                ${row('Effective rent', 'eR', RV2F.money)}
                ${row('YoY rent change', 'yR', RV2F.sPctD)}
                ${row('Occupancy', 'oc', RV2F.pctD)}
                ${row('Annual supply (units)', 'sp', RV2F.int)}
                ${row('Annual demand (units)', 'dm', RV2F.signedInt)}
              </tbody>
            </table>`, SRC_RP)}
        </div>`;
    };
    const blocks = [block(`${REPORT_V2.marketName} (market-wide)`, 'RealPage metro aggregate', D.rp)];
    D.scope.selectedSubmarkets.slice(0, 6).forEach(sm => {
      const fc = typeof getRpForecastForWbSubmarket === 'function' ? getRpForecastForWbSubmarket(sm) : null;
      const info = typeof getRpBlendInfo === 'function' ? getRpBlendInfo(sm) : '';
      if (fc) blocks.push(`<div class="page-break"></div>` + block(sm, `RealPage submarket: ${rv2esc(info || sm)}`, fc));
    });
    return `
    <section class="page">
      ${sectionHead('RealPage · <em>Forecast</em>', `Historical actuals through ${cy - 1} · ${cy} estimate · RealPage forecast ${cy + 1}–${REPORT_V2.forecastEnd} · Annual data`)}
      ${blocks.join('')}
    </section>`;
  })();

  /* ---------------- 5. Yield-on-Cost Matrix ---------------- */
  const yocHtml = !sections.yoc ? '' : (() => {
    const Y = D.yoc;
    const pct2 = x => (x * 100).toFixed(2) + '%';
    const opexLabel = yocState.opexMode === 'product'
      ? YOC_PRODUCT_COLUMNS.map(p => `${p} ${Math.round((yocState.opexByProduct[p] || yocState.opex) * 100)}%`).join(' / ')
      : `${Math.round(yocState.opex * 100)}%`;
    const req = Y.required.map(r => `
      <div class="kpi"><div class="kpi-l">Required rent / SF · ${r.prod}</div>
        <div class="kpi-v">${r.psf == null ? '—' : '$' + r.psf.toFixed(2)}<span class="unit"> / SF</span></div>
        <div class="kpi-s">${r.psf == null ? '' : RV2F.money(r.psf * yocState.unitSize) + ' / mo · ' + yocState.unitSize + ' SF'}</div></div>`).join('');
    const bands = yocColorBands();
    const legend = `<div class="yoc-legend">${bands.map(b => `<span style="background:${b.color};color:${textColorForRoc((b.min === -Infinity ? b.max : b.min))}">${b.label}</span>`).join('')}<em>Return on cost at the comp rent</em></div>`;
    const cell = (psf, roc) => psf == null ? `<td class="yc na">—</td>` : `<td class="yc" style="background:${colorForRoc(roc)};color:${textColorForRoc(roc)}">$${psf.toFixed(2)}</td>`;
    const matrix = `
      <table class="grid yoc">
        <colgroup><col style="width:25%">${'<col>'.repeat(6)}</colgroup>
        <thead>
          <tr><th rowspan="2">Submarket</th>${YOC_PRODUCT_COLUMNS.map(p => `<th colspan="2" class="grp">${p}</th>`).join('')}</tr>
          <tr>${YOC_PRODUCT_COLUMNS.map(() => '<th class="num">Average</th><th class="num">Best comp</th>').join('')}</tr>
        </thead>
        <tbody>${Y.rows.map(r => `
          <tr><td><div class="nm">${rv2esc(r.sm)}</div><div class="ad">${r.props} props · ${RV2F.int(r.units)} units</div></td>
          ${r.cells.map(c => cell(c.avg, c.rocAvg) + cell(c.best, c.rocBest)).join('')}</tr>`).join('')}
        </tbody>
      </table>`;
    const clears = Y.clears.length
      ? `<table class="grid dense"><thead><tr><th>Submarket</th><th>Product</th><th class="num">Avg rent / SF</th><th class="num">Return on cost</th></tr></thead><tbody>${Y.clears.map(c => `<tr><td>${rv2esc(c.sm)}</td><td>${c.prod}</td><td class="num">$${c.psf.toFixed(2)}</td><td class="num">${pct2(c.roc)}</td></tr>`).join('')}</tbody></table>`
      : `<p class="note">No submarket's average comp rent reaches ${pct2(Y.floor)} return on cost.</p>`;
    return `
    <section class="page">
      ${sectionHead('Yield-on-Cost <em>Matrix</em>', `Target ${pct2(yocState.targetYoc)} YOC · OpEx ${opexLabel} · ${Math.round(yocState.vacancy * 100)}% vacancy · ${yocState.unitSize} SF avg unit`)}
      <div class="callout warn"><strong>Placeholder cost basis.</strong> Development costs are carried over from the Denver build and have not been repriced for Portland. Treat required rents and returns as illustrative until Portland costs are loaded.</div>
      <div class="kpi-row three">${req}</div>
      ${exhibit('Table', `Submarkets clearing ${pct2(Y.floor)} return on cost`, 'All products · average comp rent', clears, SRC_COSTAR)}
      ${exhibit('Table', 'Asking rent per SF vs. required rent', 'Cell color shows return on cost at that rent against the target', legend + matrix, `${SRC_COSTAR}; Willow Bridge cost assumptions (see Appendix).`, 'flow')}
    </section>`;
  })();

  /* ---------------- 6. Unit Size · Rent Analysis ---------------- */
  const unitMixHtml = !sections.unitMix ? '' : (() => {
    const T = D.unitTypes.filter(t => t.rows.some(r => r.units > 0));
    if (!T.length) return '';
    const tbl = t => `
      <div class="bucket">
        <div class="bucket-h">${rv2esc(t.label)} units <span>${RV2F.int(t.units)} units in scope</span></div>
        <table class="grid dense">
          <colgroup><col style="width:22%"><col><col><col><col><col><col></colgroup>
          <thead><tr><th>Size bucket</th><th class="num">Mix</th><th class="num">Units</th><th class="num">Avg SF</th><th class="num">Occupancy</th><th class="num">Asking rent</th><th class="num">Asking $/SF</th></tr></thead>
          <tbody>${t.rows.map((r, i) => `<tr class="${i === t.bestIdx ? 'best' : ''}${r.units === 0 ? ' dim' : ''}"><td>${rv2esc(r.label)}${i === t.bestIdx ? ' <span class="top">Top $/SF</span>' : ''}</td><td class="num">${RV2F.pct0(r.mix)}</td><td class="num">${RV2F.int(r.units)}</td><td class="num">${RV2F.int(r.avgSf)}</td><td class="num">${RV2F.pct0(r.avgOcc)}</td><td class="num">${RV2F.money(r.avgRent)}</td><td class="num">${RV2F.money2(r.avgPsf)}</td></tr>`).join('')}</tbody>
        </table>
      </div>`;
    return `
    <section class="page">
      ${sectionHead('Unit Size · <em>Rent Analysis</em>', `Which unit sizes achieve the highest rents · Weighted by unit count · ${RV2F.int(k.props)} properties in scope`)}
      <p class="lede">Each bedroom type is split into size buckets with rent and $/SF weighted by unit count. The bucket with the highest asking $/SF in each type is highlighted.</p>
      ${T.map(tbl).join('')}
      <div class="ex-source">Source: ${SRC_COSTAR}</div>
    </section>`;
  })();

  /* ---------------- 7. Sale Comps (only when comps exist) ---------------- */
  const saleCompsHtml = (!sections.saleComps || (!D.invComps.length && !D.landComps.length)) ? '' : (() => {
    const inv = D.invComps.slice(0, 30), land = D.landComps.slice(0, 30);
    const wa = (arr, key, w) => weightedAvg(arr.filter(r => r[key] != null && r[w]), key, w);
    const price = v => v == null ? '—' : v >= 1e6 ? '$' + (v / 1e6).toFixed(1) + 'M' : '$' + RV2F.int(v);
    const invBlock = !inv.length ? '' : `
      <h2 class="sub-h">Investment sales</h2>
      <div class="kpi-row four">
        ${kpiTile('Investment volume', price(D.invComps.reduce((s, r) => s + (r.salePrice || 0), 0)), `${D.invComps.length} closed deals`)}
        ${kpiTile('Avg $ / unit', RV2F.money(wa(D.invComps, 'pricePerUnit', 'units')), 'Unit-weighted')}
        ${kpiTile('Avg $ / SF', RV2F.money2(wa(D.invComps, 'pricePerSF', 'units')), 'Unit-weighted')}
        ${kpiTile('Avg cap rate', (x => x == null ? '—' : x.toFixed(2) + '%')(wa(D.invComps, 'capRate', 'units')), 'Unit-weighted')}
      </div>
      <table class="grid dense"><thead><tr><th>Property</th><th>City</th><th class="num">Year built</th><th class="num">Units</th><th class="num">Sale date</th><th class="num">Price</th><th class="num">$ / unit</th><th class="num">Cap rate</th></tr></thead>
      <tbody>${inv.map(r => `<tr><td><div class="nm">${rv2esc(r.name || '—')}</div><div class="ad">${rv2esc(r.address || '')}</div></td><td>${rv2esc(r.city || '—')}</td><td class="num">${r.yearBuilt || '—'}</td><td class="num">${RV2F.int(r.units)}</td><td class="num">${rv2esc(fmtSaleDate(r.saleDate))}</td><td class="num">${price(r.salePrice)}</td><td class="num">${RV2F.money(r.pricePerUnit)}</td><td class="num">${r.capRate == null ? '—' : r.capRate.toFixed(2) + '%'}</td></tr>`).join('')}</tbody></table>`;
    const landBlock = !land.length ? '' : `
      <h2 class="sub-h">Land sales</h2>
      <table class="grid dense"><thead><tr><th>Property</th><th>Product</th><th class="num">Acres</th><th class="num">Proposed units</th><th class="num">Sale date</th><th class="num">Price</th><th class="num">$ / unit</th><th class="num">$ / SF</th></tr></thead>
      <tbody>${land.map(r => `<tr><td><div class="nm">${rv2esc(r.name || '—')}</div><div class="ad">${rv2esc(r.submarket || '')}</div></td><td>${rv2esc(r.productType || '—')}</td><td class="num">${r.acreage == null ? '—' : r.acreage.toFixed(2)}</td><td class="num">${RV2F.int(r.proposedUnits)}</td><td class="num">${rv2esc(fmtSaleDate(r.saleDate))}</td><td class="num">${price(r.salePrice)}</td><td class="num">${RV2F.money(r.pricePerUnit)}</td><td class="num">${RV2F.money2(r.pricePerSF)}</td></tr>`).join('')}</tbody></table>`;
    return `
    <section class="page">
      ${sectionHead('Sale <em>Comps</em>', `Closed transactions · ${rv2esc(D.scope.scYear)}`)}
      ${invBlock}${landBlock}
      <div class="ex-source">Source: Willow Bridge sale comp records.</div>
    </section>`;
  })();

  /* ---------------- 8. Appendix · Assumptions & Filters ---------------- */
  const appendixHtml = !sections.appendix ? '' : (() => {
    const costRows = YOC_PRODUCT_COLUMNS.map(prod => {
      const c = yocState.costs[prod];
      const tpc = c.land + c.hc * yocState.unitSize + (c.otherHc || 0) + c.soft;
      return `<tr><td>${prod}</td><td class="num">$${(c.land / 1000).toFixed(0)}K</td><td class="num">$${c.hc}</td><td class="num">$${((c.otherHc || 0) / 1000).toFixed(0)}K</td><td class="num">$${(c.soft / 1000).toFixed(0)}K</td><td class="num"><strong>$${(tpc / 1000).toFixed(0)}K</strong></td></tr>`;
    }).join('');
    return `
    <section class="page appendix">
      ${sectionHead('Appendix · <em>Assumptions &amp; Filters</em>', 'Methodology and data scope reference')}
      <div class="two-col text">
        <div>
          <h3>Active filters</h3>
          <table class="kv">
            <tr><td>Status scope</td><td>${rv2esc(D.scope.status)}</td></tr>
            <tr><td>Class</td><td>${rv2esc(D.scope.classes)}</td></tr>
            <tr><td>Product types</td><td>${rv2esc(D.scope.products)}</td></tr>
            <tr><td>Cities</td><td>${rv2esc(D.scope.cities)}</td></tr>
            <tr><td>Submarkets</td><td>${rv2esc(D.scope.submarkets)}</td></tr>
            <tr><td>Sale comps year</td><td>${rv2esc(D.scope.scYear)}</td></tr>
          </table>
          <h3>Methodology notes</h3>
          <p>All rent and occupancy averages are weighted by unit count. Concessions and pre-leasing are reported as straight averages where weighting is unavailable.</p>
          <p>Lease-up pace (leases / month) is occupied units divided by months since delivery. Estimated stabilization assumes ${D.velocity} leases per month from today.</p>
          <p>Sale comp KPIs (investment and land) are weighted by deal unit count and proposed unit count respectively.</p>
          <p>YOC required rent per SF: total cost × target YOC = NOI; NOI ÷ (1 − vacancy − OpEx) − other income = gross potential rent; ÷ 12 ÷ unit SF = required rent per SF.</p>
          <p>Property data: ${SRC_COSTAR}. Forecast data: ${SRC_RP}.</p>
        </div>
        <div>
          <h3>YOC cost assumptions</h3>
          <div class="callout warn small"><strong>Denver basis, placeholder.</strong> Not yet repriced for Portland.</div>
          <table class="grid dense">
            <colgroup><col style="width:22%"><col><col><col><col><col></colgroup>
            <thead><tr><th>Product</th><th class="num">Land / unit</th><th class="num">HC / NRSF</th><th class="num">Other HC</th><th class="num">Soft / unit</th><th class="num">TPC / unit</th></tr></thead>
            <tbody>${costRows}</tbody>
          </table>
          <p class="note">TPC per unit at ${yocState.unitSize} SF average unit size. Target YOC ${(yocState.targetYoc * 100).toFixed(2)}%; vacancy ${Math.round(yocState.vacancy * 100)}%; other income $${RV2F.int(yocState.otherIncomePerUnit || 0)} per unit per year.</p>
        </div>
      </div>
      <div class="disclaimer">Prepared by Willow Bridge Property Company from third-party data (CoStar, RealPage) believed to be reliable but not independently verified. Forecasts are the data providers' estimates and are not guarantees of future performance. © ${now.getFullYear()} Willow Bridge Property Company. Confidential.</div>
    </section>`;
  })();

  /* ---------------- Cover (original design) ---------------- */
  const facets = [
    ['Status Scope', D.scope.status], ['Class', D.scope.classes],
    ['Product Types', D.scope.products], ['Cities', D.scope.cities],
    ['Submarkets', D.scope.submarkets], ['Sale Comps Year', D.scope.scYear],
  ];
  const coverHtml = !sections.cover ? '' : `
    <section class="cover">
      <div class="cover-top">
        <img class="cover-logo" src="${REPORT_V2.logoWhite}" alt="Willow Bridge">
        <div class="division">Market Intel</div>
      </div>
      <div class="cover-middle">
        <div class="cover-eyebrow">Market Intelligence Report</div>
        <div class="cover-title">${title === 'Market Report' ? 'Market <em>Report</em>' : rv2esc(title)}</div>
        <div class="cover-scope">${rv2esc(subtitle)}</div>
        <div class="cover-facet-grid">
          ${facets.map(([l, v]) => `<div class="cover-facet"><div class="cover-facet-label">${rv2esc(l)}</div><div class="cover-facet-value">${rv2esc(v)}</div></div>`).join('')}
        </div>
      </div>
      <div class="cover-meta">
        <div class="doc-type">Confidential</div>
        <div class="doc-date">${reportDate}</div>
      </div>
    </section>`;

  const css = marketReportV2Css(REPORT_V2.colors, `${rv2esc(title)} · ${rv2esc(subtitle)}`, reportMonth);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${rv2esc(title)} · ${rv2esc(subtitle)} · ${reportDate}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter+Tight:ital,wght@0,300;0,400;0,500;0,600;0,700;1,300;1,400;1,500&display=swap" rel="stylesheet">
<style>${css}</style>
</head>
<body>
${coverHtml}
${overviewHtml}
${leaseUpHtml}
${pipelineHtml}
${forecastHtml}
${yocHtml}
${unitMixHtml}
${saleCompsHtml}
${appendixHtml}
<script>
  window.addEventListener('load', function () {
    var go = function () { setTimeout(function () { window.print(); }, 250); };
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(go); else go();
  });
<\/script>
</body>
</html>`;
}



/* ------------------------------------------------------------------
   PRINT STYLESHEET
   ------------------------------------------------------------------ */
function marketReportV2Css(C, runningTitle, runningDate) {
  return `
  @page {
    size: letter portrait;
    margin: 0.78in 0.7in 0.75in 0.7in;
    @top-left { content: "${runningTitle.replace(/"/g, '')}"; font: 500 7pt 'Inter Tight', Arial, sans-serif; letter-spacing: 0.14em; text-transform: uppercase; color: ${C.muted}; vertical-align: bottom; padding-bottom: 10pt; }
    @top-right { content: "${runningDate}"; font: 500 7pt 'Inter Tight', Arial, sans-serif; letter-spacing: 0.14em; text-transform: uppercase; color: ${C.muted}; vertical-align: bottom; padding-bottom: 10pt; }
    @bottom-left { content: "Willow Bridge Property Company  ·  Confidential"; font: 500 7pt 'Inter Tight', Arial, sans-serif; letter-spacing: 0.08em; color: ${C.muted}; vertical-align: top; padding-top: 10pt; }
    @bottom-right { content: counter(page); font: 600 7.5pt 'Inter Tight', Arial, sans-serif; color: ${C.midnight}; vertical-align: top; padding-top: 10pt; }
  }
  @page :first {
    margin: 0;
    @top-left { content: none; } @top-right { content: none; }
    @bottom-left { content: none; } @bottom-right { content: none; }
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body {
    font-family: 'Inter Tight', Arial, sans-serif; font-size: 8.8pt; line-height: 1.42; color: ${C.ink};
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
    font-feature-settings: "cv05" 1, "tnum" 1, "kern" 1;
  }
  .page { break-before: page; }
  .cover + .page { break-before: auto; }
  p { margin: 0 0 6pt; }
  strong { font-weight: 600; color: ${C.midnight}; }

  /* Section opener */
  .sec-head { margin: 0 0 14pt; padding-bottom: 10pt; border-bottom: 1.5pt solid ${C.midnight}; }
  .sec-kicker { display: flex; align-items: center; gap: 7pt; font-size: 7pt; font-weight: 600; letter-spacing: 0.16em; text-transform: uppercase; color: ${C.purple}; margin-bottom: 6pt; }
  .sec-mark { width: 13pt; height: 13pt; }
  .sec-kicker-label { color: ${C.muted}; font-weight: 500; }
  .sec-kicker-label::before { content: "/"; margin-right: 7pt; color: ${C.rule}; }
  .sec-head h1 { font-size: 19pt; line-height: 1.12; font-weight: 600; letter-spacing: -0.012em; color: ${C.midnight}; margin: 0 0 6pt; }
  .standfirst { font-size: 10pt; line-height: 1.45; color: #3A3747; margin: 0; max-width: 6.3in; }

  /* KPI tiles */
  .kpi-row { display: grid; gap: 0; margin: 0 0 14pt; border-top: 2pt solid ${C.midnight}; border-bottom: 0.75pt solid ${C.rule}; }
  .kpi-row.six { grid-template-columns: repeat(6, 1fr); }
  .kpi-row.four { grid-template-columns: repeat(4, 1fr); }
  .kpi { padding: 8pt 9pt 8pt 0; }
  .kpi + .kpi { padding-left: 9pt; border-left: 0.75pt solid ${C.rule}; }
  .kpi-l { font-size: 6.6pt; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: ${C.muted}; }
  .kpi-v { font-size: 16pt; font-weight: 600; color: ${C.midnight}; letter-spacing: -0.01em; margin: 3pt 0 2pt; line-height: 1.05; }
  .kpi-s { font-size: 7pt; color: ${C.muted}; line-height: 1.3; }

  /* Takeaways */
  .takeaways { background: ${C.zebra}; border-left: 2.5pt solid ${C.purple}; padding: 10pt 14pt 6pt; margin: 0 0 16pt; }
  .tk-label { font-size: 6.8pt; font-weight: 600; letter-spacing: 0.16em; text-transform: uppercase; color: ${C.purple}; margin-bottom: 5pt; }
  .takeaways ul { margin: 0; padding: 0 0 0 11pt; }
  .takeaways li { margin: 0 0 5pt; font-size: 9.2pt; line-height: 1.45; }
  .takeaways li::marker { color: ${C.purple}; }

  /* Exhibits */
  .exhibit { margin: 0 0 14pt; break-inside: avoid; }
  .exhibit.flow { break-inside: auto; }
  .ex-source { break-before: avoid; }
  .bucket-grid table.grid.dense td { padding-top: 2.6pt; padding-bottom: 2.6pt; }
  figcaption { break-after: avoid; }
  .bucket { break-inside: avoid; }
  figcaption { display: block; margin-bottom: 6pt; }
  .ex-no { display: block; font-size: 6.6pt; font-weight: 600; letter-spacing: 0.16em; text-transform: uppercase; color: ${C.purple}; margin-bottom: 1.5pt; }
  .ex-title { display: block; font-size: 10pt; font-weight: 600; color: ${C.midnight}; line-height: 1.25; }
  .ex-sub { display: block; font-size: 7.6pt; color: ${C.muted}; margin-top: 1pt; }
  .ex-body { }
  .ex-source { font-size: 6.6pt; color: ${C.muted}; margin-top: 5pt; padding-top: 4pt; border-top: 0.5pt solid ${C.rule}; line-height: 1.35; }
  .rv2-svg { display: block; width: 100%; height: auto; }
  .legend { display: flex; flex-wrap: wrap; gap: 4pt 12pt; font-size: 7.4pt; color: ${C.ink}; margin: 0 0 3pt; }
  .legend .lg { display: inline-flex; align-items: center; gap: 4pt; }
  .legend i { display: inline-block; width: 9pt; height: 7pt; }
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 0 22pt; }
  .two-col.tall .exhibit { margin-bottom: 10pt; }
  .note { font-size: 7.6pt; color: ${C.muted}; line-height: 1.45; margin-top: -4pt; }

  /* Tables */
  table.grid { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 8pt; }
  table.grid th { font-size: 6.6pt; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: ${C.midnight}; text-align: left; vertical-align: bottom; padding: 4pt 5pt 4pt 0; border-bottom: 1.2pt solid ${C.midnight}; line-height: 1.25; }
  table.grid td { padding: 4.2pt 5pt 4.2pt 0; border-bottom: 0.5pt solid ${C.rule}; vertical-align: top; line-height: 1.3; }
  table.grid tbody tr:nth-child(even) td { background: ${C.zebra}; }
  table.grid th:first-child, table.grid td:first-child { padding-left: 4pt; }
  table.grid .num { text-align: right; font-variant-numeric: tabular-nums; }
  table.grid td.num { white-space: nowrap; }
  table.grid th { white-space: normal; overflow-wrap: normal; }
  table.grid tr { break-inside: avoid; }
  table.grid thead { display: table-header-group; }
  table.grid tr.total td { font-weight: 600; color: ${C.midnight}; border-top: 1.2pt solid ${C.midnight}; border-bottom: 0; background: #fff !important; }
  table.grid.dense { font-size: 7.6pt; }
  table.grid.dense th { font-size: 6.2pt; letter-spacing: 0.04em; }
  table.grid.dense td { padding-top: 3.2pt; padding-bottom: 3.2pt; }
  table.grid .nm { font-weight: 600; color: ${C.midnight}; }
  table.grid .ad { font-size: 6.8pt; color: ${C.muted}; }
  table.grid.fcst th.cur, table.grid.fcst th.fc { color: ${C.purple}; }
  table.grid.fcst th span { display: block; font-size: 5.8pt; letter-spacing: 0.1em; color: ${C.muted}; font-weight: 500; }
  table.grid.fcst td.fc { background: rgba(227,228,254,0.45) !important; }
  table.grid.fcst td:first-child { width: 26%; }
  table.grid.fcst colgroup { }
  .nm-flag { color: ${C.muted}; font-style: italic; }
  tr.best td { background: rgba(199,201,254,0.38) !important; font-weight: 600; }

  .bucket-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10pt 20pt; }
  .bucket-h { font-size: 8.4pt; font-weight: 600; color: ${C.midnight}; margin: 0 0 3pt; }
  .bucket-h span { font-weight: 400; color: ${C.muted}; font-size: 7.4pt; margin-left: 4pt; }

  /* Appendix */
  .appendix .two-col.text { gap: 0 26pt; }
  .appendix h3 { font-size: 7.2pt; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; color: ${C.purple}; margin: 0 0 5pt; padding-top: 2pt; }
  .appendix p, .appendix dd { font-size: 8.2pt; line-height: 1.5; }
  .appendix p + h3, .appendix table + h3 { margin-top: 12pt; }
  .appendix dl { margin: 0; }
  .appendix dt { font-weight: 600; color: ${C.midnight}; font-size: 8.2pt; margin-top: 6pt; }
  .appendix dd { margin: 1pt 0 0; color: #3A3747; }
  table.kv { border-collapse: collapse; width: 100%; font-size: 8.2pt; }
  table.kv td { padding: 3pt 0; border-bottom: 0.5pt solid ${C.rule}; vertical-align: top; }
  table.kv td:first-child { width: 32%; color: ${C.muted}; }
  .disclaimer { margin-top: 18pt; padding-top: 8pt; border-top: 0.75pt solid ${C.rule}; font-size: 6.9pt; line-height: 1.5; color: ${C.muted}; }


  /* Section header — original layout: mark + title with italic accent, caps subline, rule */
  .sec-title-row { display: flex; align-items: center; gap: 9pt; }
  .sec-title-row .sec-mark { width: 16pt; height: 16pt; }
  .sec-head h1 { margin: 0; font-size: 19pt; font-weight: 500; }
  .sec-head h1 em { color: ${C.purple}; font-style: italic; font-weight: 400; }
  .sec-sub { font-size: 7.2pt; font-weight: 500; letter-spacing: 0.14em; text-transform: uppercase; color: ${C.muted}; margin-top: 5pt; }
  .page-break { break-before: page; }
  .kpi-row.three { grid-template-columns: repeat(3, 1fr); }
  .kpi-v .unit { font-size: 9pt; font-weight: 500; color: ${C.muted}; }
  .lede { font-size: 8.8pt; color: #3A3747; margin: 0 0 10pt; }
  .sub-h { font-size: 11pt; font-weight: 600; color: ${C.midnight}; margin: 4pt 0 8pt; }
  .callout { border-left: 2.5pt solid ${C.purple}; background: ${C.zebra}; padding: 7pt 11pt; font-size: 8.4pt; line-height: 1.45; margin: 0 0 12pt; }
  .callout.warn { border-left-color: ${C.brick}; background: #FBF4F3; }
  .callout.warn strong { color: ${C.brick}; }
  .callout.small { font-size: 7.6pt; padding: 5pt 9pt; margin-bottom: 8pt; }
  .pbar { position: relative; height: 7pt; background: ${C.sandLight}; margin-top: 2pt; }
  .pbar i { position: absolute; left: 0; top: 0; bottom: 0; }
  .ok { color: ${C.forest}; font-weight: 600; }
  .fc-block { margin-bottom: 6pt; }
  .fc-head { background: ${C.zebra}; border-left: 2.5pt solid ${C.midnight}; padding: 7pt 11pt; margin-bottom: 10pt; }
  .fc-title { font-size: 10.5pt; font-weight: 600; color: ${C.midnight}; }
  .fc-sub { font-size: 7pt; letter-spacing: 0.12em; text-transform: uppercase; color: ${C.muted}; margin-top: 2pt; }
  table.grid.yoc th.grp { text-align: center; border-bottom: 0.75pt solid ${C.rule}; }
  table.grid.yoc td.yc { text-align: center; font-weight: 600; font-variant-numeric: tabular-nums; border-bottom: 1.5pt solid #fff; border-left: 1.5pt solid #fff; vertical-align: middle; }
  table.grid.yoc td.yc.na { background: ${C.sandLight} !important; color: #A6A1AE; font-weight: 400; }
  table.grid.yoc tbody tr:nth-child(even) td:first-child { background: ${C.zebra}; }
  .yoc-legend { display: flex; flex-wrap: wrap; align-items: center; gap: 0; margin: 0 0 6pt; font-size: 7pt; }
  .yoc-legend span { padding: 2.5pt 7pt; font-weight: 600; }
  .yoc-legend em { font-style: normal; color: ${C.muted}; margin-left: 8pt; }
  .bucket { margin-bottom: 12pt; }
  .bucket-h { font-size: 9pt; }
  tr.dim td { color: #A6A1AE; }
  .top { display: inline-block; margin-left: 4pt; font-size: 6pt; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: ${C.purple}; }

  .appendix .note { margin-top: 6pt; }
  /* Cover — same design as the legacy report */
  .cover { height: 11in; width: 8.5in; display: grid; grid-template-rows: auto 1fr auto; padding: 0.75in 0.7in 0.55in; background: #1d104b; color: #f6f4ef; position: relative; overflow: hidden; break-after: page; }
  .cover::before { content: ''; position: absolute; right: -180px; bottom: -180px; width: 540px; height: 540px; border-radius: 50%; background: radial-gradient(circle at 30% 30%, #6a4fc0 0%, #432890 55%, transparent 75%); opacity: 0.7; }
  .cover-top { display: flex; justify-content: space-between; align-items: center; padding-bottom: 18px; border-bottom: 1px solid rgba(246,244,239,0.25); position: relative; z-index: 1; }
  .cover-logo { display: block; width: 200px; height: auto; }
  .division, .cover-eyebrow { font-size: 12.5px; letter-spacing: 0.28em; text-transform: uppercase; color: #C7C9FE; font-weight: 600; }
  .cover-middle { display: flex; flex-direction: column; justify-content: center; max-width: 6in; position: relative; z-index: 1; }
  .cover-eyebrow { margin-bottom: 14px; }
  .cover-title { font-size: 52px; font-weight: 600; line-height: 0.95; color: #f6f4ef; letter-spacing: -0.01em; margin: 0 0 14px; }
  .cover-title em { color: #C7C9FE; font-style: italic; font-weight: 300; }
  .cover-scope { font-size: 20px; font-weight: 500; color: #e5dcfa; font-style: italic; letter-spacing: 0.02em; margin-bottom: 36px; }
  .cover-facet-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px 28px; margin-bottom: 14px; }
  .cover-facet { padding: 11px 14px; border-left: 2px solid #6a4fc0; background: rgba(246,244,239,0.04); }
  .cover-facet-label { font-size: 12px; letter-spacing: 0.22em; text-transform: uppercase; color: #C7C9FE; font-weight: 600; margin-bottom: 4px; }
  .cover-facet-value { font-size: 13px; color: #f6f4ef; font-weight: 500; line-height: 1.35; }
  .cover-meta { display: flex; justify-content: space-between; align-items: flex-end; padding-top: 18px; border-top: 1px solid rgba(246,244,239,0.25); position: relative; z-index: 1; }
  .cover-meta .doc-type { font-size: 12px; letter-spacing: 0.22em; text-transform: uppercase; color: #C7C9FE; font-weight: 600; }
  .cover-meta .doc-date { font-size: 16px; font-style: italic; color: #f6f4ef; letter-spacing: -0.01em; font-weight: 500; }
  `;
}
