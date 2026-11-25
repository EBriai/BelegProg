// Opslag in de browser (localStorage). Alles wat bewaard wordt loopt via hier,
// zodat later een andere opslag (bijv. synchronisatie) kan worden ingeplugd.
window.Beleg = window.Beleg || {};

Beleg.storage = (() => {
  const P = "beleg.";
  const read = (k, fallback) => {
    try { const v = localStorage.getItem(P + k); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
  };
  const write = (k, v) => {
    try { localStorage.setItem(P + k, JSON.stringify(v)); return true; }
    catch (e) { console.warn("Opslaan mislukt", k, e); return false; }
  };
  const remove = (k) => { try { localStorage.removeItem(P + k); } catch {} };

  return {
    // aandelen: [{ticker, name, currency, addedAt}]
    getStocks: () => read("stocks", []),
    saveStocks: (list) => write("stocks", list),
    // koerscache per ticker: {days, close, refreshed, source}
    getPrices: (t) => read("prices." + t, null),
    savePrices: (t, s) => write("prices." + t, s),
    removePrices: (t) => remove("prices." + t),
    getSettings() {
      const s = { provider: window.BELEG_DEFAULT_PROVIDER || "github", ...read("settings", {}) };
      if (!["github", "demo"].includes(s.provider)) s.provider = "github"; // oude bronnen (proxy, Twelve Data) bestaan niet meer
      return s;
    },
    saveSettings: (s) => write("settings", s),
    getUi: () => read("ui", {}),
    saveUi: (u) => write("ui", u),
    exportAll: () => ({ version: 1, exportedAt: new Date().toISOString(), stocks: read("stocks", []), settings: read("settings", {}) }),
    importAll(data) {
      if (!data || !Array.isArray(data.stocks)) throw new Error("Dit is geen geldig exportbestand.");
      write("stocks", data.stocks.filter((s) => s && typeof s.ticker === "string"));
      if (data.settings) write("settings", data.settings);
    },
  };
})();
