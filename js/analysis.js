// Rekenwerk op koersreeksen. Puur JavaScript zonder netwerk of opslag.
// Een reeks = { days: ["2024-01-02", ...], close: [12.3, ...] } (oudste eerst).
window.Beleg = window.Beleg || {};

Beleg.analysis = (() => {
  /** Leg reeksen op één datum-as die begint op de eerste dag waarop ALLE
   *  reeksen een koers hebben (op of na start). Op een dag zonder handel
   *  op een beurs geldt de laatst bekende koers. */
  function align(seriesByTicker, start = null, end = null) {
    const clipped = {};
    for (const [t, s] of Object.entries(seriesByTicker)) {
      const pts = [];
      for (let i = 0; i < s.days.length; i++) {
        const d = s.days[i];
        if ((!start || d >= start) && (!end || d <= end)) pts.push([d, s.close[i]]);
      }
      if (pts.length) clipped[t] = pts;
    }
    const tickers = Object.keys(clipped);
    if (!tickers.length) return { dates: [], values: {} };

    const commonStart = tickers.map((t) => clipped[t][0][0]).sort().at(-1);
    const daySet = new Set();
    for (const t of tickers) for (const [d] of clipped[t]) if (d >= commonStart) daySet.add(d);
    const dates = [...daySet].sort();

    const values = {};
    for (const t of tickers) {
      const lookup = new Map(clipped[t]);
      let last = null;
      // de laatste koers vóór de gezamenlijke start telt als beginwaarde
      for (const [d, v] of clipped[t]) { if (d <= commonStart) last = v; else break; }
      values[t] = dates.map((d) => (last = lookup.has(d) ? lookup.get(d) : last));
    }
    return { dates, values };
  }

  /** Alle reeksen = base (100) op de gezamenlijke startdatum. 130 = +30%. */
  function normalize(seriesByTicker, start = null, end = null, base = 100) {
    const { dates, values } = align(seriesByTicker, start, end);
    const series = {};
    for (const [t, v] of Object.entries(values)) series[t] = v.map((x) => Math.round((x / v[0]) * base * 1e4) / 1e4);
    return { start: dates[0] ?? null, dates, series, closes: values };
  }

  /** Zoals normalize, maar zonder gezamenlijke start: de datum-as dekt de hele
   *  periode en elk aandeel staat op 100 op zijn EIGEN eerste koersdag in die
   *  periode. Een aandeel dat later begint (bijv. een recente beursgang) maakt
   *  de periode dus niet korter. Vóór de eerste koers is de waarde null. */
  function normalizeEach(seriesByTicker, start = null, end = null, base = 100) {
    const clipped = {};
    for (const [t, s] of Object.entries(seriesByTicker)) {
      const pts = [];
      for (let i = 0; i < s.days.length; i++) {
        const d = s.days[i];
        if ((!start || d >= start) && (!end || d <= end) && s.close[i] != null) pts.push([d, s.close[i]]);
      }
      if (pts.length) clipped[t] = pts;
    }
    const daySet = new Set();
    for (const pts of Object.values(clipped)) for (const [d] of pts) daySet.add(d);
    const dates = [...daySet].sort();
    const series = {}, closes = {}, firstDay = {};
    for (const [t, pts] of Object.entries(clipped)) {
      const lookup = new Map(pts);
      firstDay[t] = pts[0][0];
      let last = null;
      closes[t] = dates.map((d) => (lookup.has(d) ? (last = lookup.get(d)) : last));
      const b0 = pts[0][1];
      series[t] = closes[t].map((x) => (x == null ? null : Math.round((x / b0) * base * 1e4) / 1e4));
    }
    return { start: dates[0] ?? null, dates, series, closes, firstDay };
  }

  return { align, normalize, normalizeEach };
})();
