// Koersen voor de app: één momentopname met alle aandelen, in het geheugen
// gehouden en op dit apparaat bewaard zodat de app snel opent.
window.Beleg = window.Beleg || {};

Beleg.prices = (() => {
  let snap = null, fetchedAt = 0;
  const providerName = () => Beleg.storage.getSettings().provider;
  const CACHE = "beleg.koersen";
  try { const c = JSON.parse(localStorage.getItem(CACHE) || "null"); if (c && c.source === providerName()) snap = c.snap; } catch {}

  /** Momentopname ophalen; maxAgeMs bepaalt hoe oud het geheugen mag zijn. */
  async function snapshot(tickers, maxAgeMs = 60_000) {
    if (snap && Date.now() - fetchedAt < maxAgeMs && tickers.every((t) => snap.items[t])) return snap;
    const fresh = await Beleg.providers.get(providerName()).snapshot(tickers);
    snap = fresh; fetchedAt = Date.now();
    try { localStorage.setItem(CACHE, JSON.stringify({ source: providerName(), snap })); } catch { /* te groot: alleen in geheugen */ }
    return snap;
  }
  const cached = () => snap;
  const reset = () => { snap = null; fetchedAt = 0; try { localStorage.removeItem(CACHE); } catch {} };
  return { snapshot, cached, reset };
})();
