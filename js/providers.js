// Koersbronnen.
//  - "github": echte koersen van Yahoo Finance, opgehaald door GitHub Actions
//    (zie scripts/koersen.py). Vereist dat de centrale lijst is ingesteld.
//  - "demo": verzonnen, reproduceerbare koersen om de app uit te proberen.
// Elke bron levert: snapshot(tickers) -> {generated, items: {ticker: item}}
// waarbij item = {symbol, name, currency, exchange, days, close, candidates}
//           of   {error, candidates}.
window.Beleg = window.Beleg || {};

Beleg.providers = (() => {
  const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

  const github = {
    label: "Echte koersen (Yahoo Finance via GitHub)",
    async snapshot() {
      if (!Beleg.sync.enabled()) throw new Error("Voor echte koersen moet je eerst de centrale lijst instellen of openen.");
      return (await Beleg.sync.readKoersen()) || { generated: null, items: {} };
    },
  };

  const demo = {
    label: "Demo (verzonnen koersen)",
    series(ticker) {
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
        days.push(iso(t)); close.push(Math.round(price * 100) / 100);
      }
      return { symbol: ticker, name: `Demo ${ticker}`, currency: "EUR", days, close, candidates: [] };
    },
    async snapshot(tickers) {
      return { generated: new Date().toISOString(), items: Object.fromEntries(tickers.map((t) => [t, this.series(t)])) };
    },
  };

  const PROVIDERS = { github, demo };
  return { get: (name) => PROVIDERS[name] || github, all: PROVIDERS };
})();
