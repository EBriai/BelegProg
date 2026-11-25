// Koersbronnen. Elke bron heeft:
//   lookup(ticker)           -> {ticker, name, currency}   (gooit Error als onbekend)
//   history(ticker, fromDay) -> {days, close, currency, name}
// Een nieuwe bron toevoegen = een object met deze twee functies in PROVIDERS zetten.
window.Beleg = window.Beleg || {};

Beleg.providers = (() => {
  const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

  async function getJson(url) {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }

  // --- Yahoo Finance via een CORS-proxy --------------------------------------
  // Yahoo staat ophalen vanuit een webpagina niet toe (CORS). Een publieke
  // proxy stuurt het verzoek door. Gratis en alle beurzen, maar onofficieel:
  // een proxy kan traag zijn of verdwijnen, daarom proberen we er meerdere.
  const PROXIES = [
    (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
    (u) => `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(u)}`,
    (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
  ];
  let workingProxy = 0;

  async function viaProxy(url) {
    const errors = [];
    for (let k = 0; k < PROXIES.length; k++) {
      const i = (workingProxy + k) % PROXIES.length;
      try {
        const data = await getJson(PROXIES[i](url));
        workingProxy = i;
        return data;
      } catch (e) { errors.push(e.message); }
    }
    throw new Error(`Koersen ophalen lukt niet (alle proxy's faalden: ${errors.join(", ")}). Controleer je internet of probeer later opnieuw.`);
  }

  const yahoo = {
    label: "Yahoo Finance (gratis, alle beurzen, via proxy)",
    async history(ticker, fromDay = "2000-01-01") {
      const p1 = Math.floor(Date.parse(fromDay) / 1000);
      const p2 = Math.floor(Date.now() / 1000) + 86400;
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${p1}&period2=${p2}&interval=1d&events=div%2Csplits`;
      const data = await viaProxy(url);
      const res = data?.chart?.result?.[0];
      if (!res) throw new Error(`Ticker '${ticker}' niet gevonden bij Yahoo. Controleer de schrijfwijze (bijv. ASML.AS).`);
      const ts = res.timestamp || [];
      const adj = res.indicators?.adjclose?.[0]?.adjclose || res.indicators?.quote?.[0]?.close || [];
      const offset = (res.meta?.gmtoffset || 0) * 1000;
      const days = [], close = [];
      for (let i = 0; i < ts.length; i++) {
        if (adj[i] == null) continue;
        const d = iso(ts[i] * 1000 + offset);
        if (days.at(-1) === d) { close[close.length - 1] = adj[i]; continue; }
        days.push(d); close.push(adj[i]);
      }
      return { days, close, currency: res.meta?.currency || null, name: res.meta?.longName || res.meta?.shortName || null };
    },
    async lookup(ticker) {
      const h = await this.history(ticker, iso(Date.now() - 14 * 864e5));
      if (!h.days.length) throw new Error(`Geen koersen gevonden voor '${ticker}'. Klopt de ticker?`);
      return { ticker, name: h.name, currency: h.currency };
    },
  };

  // --- Twelve Data (eigen gratis sleutel) ------------------------------------
  // Officiële API die vanuit de browser werkt. Gratis plan: 800 verzoeken per
  // dag, maar alleen Amerikaanse aandelen/ETF's. Niet gecorrigeerd voor dividend.
  const twelve = {
    label: "Twelve Data (eigen sleutel, gratis alleen VS)",
    key: () => Beleg.storage.getSettings().twelveKey,
    async history(ticker, fromDay = "2000-01-01") {
      if (!this.key()) throw new Error("Vul eerst je Twelve Data API-sleutel in bij Instellingen.");
      const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(ticker)}&interval=1day&start_date=${fromDay}&outputsize=5000&order=ASC&apikey=${encodeURIComponent(this.key())}`;
      const data = await getJson(url);
      if (data.status === "error") throw new Error(`Twelve Data: ${data.message}`);
      const vals = data.values || [];
      return { days: vals.map((v) => v.datetime.slice(0, 10)), close: vals.map((v) => +v.close), currency: data.meta?.currency || null, name: null };
    },
    async lookup(ticker) {
      const h = await this.history(ticker, iso(Date.now() - 14 * 864e5));
      if (!h.days.length) throw new Error(`Geen koersen gevonden voor '${ticker}'.`);
      return { ticker, name: null, currency: h.currency };
    },
  };

  // --- Demo: verzonnen, reproduceerbare koersen -------------------------------
  const demo = {
    label: "Demo (verzonnen koersen, werkt altijd)",
    async history(ticker, fromDay = "2000-01-01") {
      let seed = 0; for (const c of ticker) seed = (seed * 31 + c.charCodeAt(0)) >>> 0;
      const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
      const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
      const drift = -0.0002 + rnd() * 0.001, vol = 0.008 + rnd() * 0.017;
      let price = 20 + rnd() * 280;
      const days = [], close = [];
      for (let t = Date.parse("2015-01-02"); t <= Date.now(); t += 864e5) {
        const wd = new Date(t).getUTCDay();
        if (wd === 0 || wd === 6) continue;
        price *= Math.exp(drift + vol * gauss());
        const d = iso(t);
        if (d >= fromDay) { days.push(d); close.push(Math.round(price * 100) / 100); }
      }
      return { days, close, currency: "EUR", name: `Demo ${ticker}` };
    },
    async lookup(ticker) {
      if (ticker.startsWith("FOUT")) throw new Error(`Onbekende ticker '${ticker}'`);
      return { ticker, name: `Demo ${ticker}`, currency: "EUR" };
    },
  };

  const PROVIDERS = { yahoo, twelve, demo };
  const get = (name) => PROVIDERS[name] || yahoo;
  return { get, all: PROVIDERS };
})();
