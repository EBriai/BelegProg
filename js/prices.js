// Koersen met cache: volledige historie één keer ophalen, daarna hooguit
// één keer per dag de laatste dagen erbij.
window.Beleg = window.Beleg || {};

Beleg.prices = (() => {
  const S = () => Beleg.storage;
  const today = () => new Date().toISOString().slice(0, 10);
  const provider = () => Beleg.providers.get(S().getSettings().provider);
  const providerName = () => S().getSettings().provider;

  async function loadFull(ticker) {
    const h = await provider().history(ticker, "2000-01-01");
    const entry = { days: h.days, close: h.close, refreshed: today(), source: providerName() };
    if (!S().savePrices(ticker, entry)) console.warn("Cache vol; koersen alleen in geheugen voor", ticker);
    return entry;
  }

  /** Geeft {series, warning}. Bij een mislukte update wordt de oude cache gebruikt. */
  async function get(ticker) {
    let c = S().getPrices(ticker);
    if (!c || c.source !== providerName()) return { series: await loadFull(ticker) };
    if (c.refreshed === today()) return { series: c };
    try {
      const from = c.days.at(-8) || c.days[0];
      const h = await provider().history(ticker, from);
      const keep = c.days.findIndex((d) => d >= (h.days[0] || "9999"));
      const cut = keep === -1 ? c.days.length : keep;
      c = { ...c, days: c.days.slice(0, cut).concat(h.days), close: c.close.slice(0, cut).concat(h.close), refreshed: today() };
      S().savePrices(ticker, c);
      return { series: c };
    } catch (e) {
      return { series: c, warning: `${ticker}: bijwerken mislukt, koersen tot ${c.days.at(-1)} getoond.` };
    }
  }

  return { get, loadFull };
})();
