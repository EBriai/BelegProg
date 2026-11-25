// Synchronisatie van de aandelenlijst via een geheime GitHub-gist.
// Zo staat de lijst op één plek en zien pc en telefoon hetzelfde.
// Nodig: een GitHub-token met alleen het recht "gist" (per apparaat één keer invullen).
window.Beleg = window.Beleg || {};

Beleg.sync = (() => {
  const FILE = "koersvergelijker.json";
  const API = "https://api.github.com";
  const TOKEN_KEY = "beleg.ghToken", GIST_KEY = "beleg.gistId";
  const ls = {
    get: (k) => { try { return localStorage.getItem(k) || ""; } catch { return ""; } },
    set: (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch {} },
  };

  async function gh(path, opts = {}) {
    const r = await fetch(API + path, {
      ...opts, cache: "no-store",
      headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${ls.get(TOKEN_KEY)}`, ...(opts.body ? { "Content-Type": "application/json" } : {}) },
    });
    if (r.status === 401) throw new Error("GitHub-token ongeldig of verlopen. Vul een nieuwe in bij Instellingen.");
    if (r.status === 403 || r.status === 404) throw new Error(`GitHub weigert toegang (${r.status}). Heeft het token het recht "gist"?`);
    if (!r.ok) throw new Error(`GitHub gaf fout ${r.status}.`);
    return r.json();
  }

  const enabled = () => !!ls.get(TOKEN_KEY);

  async function findGist() {
    const known = ls.get(GIST_KEY);
    if (known) {
      try { return await gh(`/gists/${known}`); } catch (e) { if (!/404|toegang/.test(e.message)) throw e; }
    }
    for (let page = 1; page <= 5; page++) {
      const list = await gh(`/gists?per_page=100&page=${page}`);
      const hit = list.find((g) => g.files && g.files[FILE]);
      if (hit) { ls.set(GIST_KEY, hit.id); return gh(`/gists/${hit.id}`); }
      if (list.length < 100) break;
    }
    return null;
  }

  function parse(gist) {
    const f = gist.files[FILE];
    const data = JSON.parse(f.content || "{}");
    return Array.isArray(data.stocks) ? data.stocks : [];
  }

  /** Haal de centrale lijst op. Maakt de gist aan (met initialStocks) als die nog niet bestaat. */
  async function pull(initialStocks = []) {
    const gist = await findGist();
    if (gist) return parse(gist);
    const created = await gh("/gists", {
      method: "POST",
      body: JSON.stringify({ description: "Koersvergelijker: mijn aandelenlijst", public: false, files: { [FILE]: { content: serialize(initialStocks) } } }),
    });
    ls.set(GIST_KEY, created.id);
    return initialStocks;
  }

  function serialize(stocks) {
    return JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), stocks }, null, 2);
  }

  /** Pas een wijziging toe op de NIEUWSTE centrale lijst en sla die op.
   *  Zo gaat een wijziging op het andere apparaat niet verloren. */
  async function change(mutate) {
    const latest = await pull();
    const next = mutate(latest.map((s) => ({ ...s })));
    await gh(`/gists/${ls.get(GIST_KEY)}`, { method: "PATCH", body: JSON.stringify({ files: { [FILE]: { content: serialize(next) } } }) });
    return next;
  }

  return {
    enabled, pull, change,
    getToken: () => ls.get(TOKEN_KEY),
    setToken: (t) => { ls.set(TOKEN_KEY, t.trim()); ls.set(GIST_KEY, ""); },
    gistUrl: () => (ls.get(GIST_KEY) ? `https://gist.github.com/${ls.get(GIST_KEY)}` : null),
  };
})();
