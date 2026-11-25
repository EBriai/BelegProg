// Synchronisatie van de aandelenlijst via een PRIVÉ GitHub-repository.
// De lijst staat als data/stocks.json in die repository; alleen jij kunt hem zien.
// Nodig per apparaat: de naam van de repository en een "fine-grained" token
// dat alleen die ene repository mag lezen en schrijven.
window.Beleg = window.Beleg || {};

Beleg.sync = (() => {
  const PATH = "data/stocks.json";
  const API = "https://api.github.com";
  const K = { token: "beleg.ghToken", repo: "beleg.dataRepo" };
  const ls = {
    get: (k) => { try { return localStorage.getItem(k) || ""; } catch { return ""; } },
    set: (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch {} },
  };
  const repo = () => ls.get(K.repo);

  async function gh(path, opts = {}) {
    const r = await fetch(API + path, {
      ...opts, cache: "no-store",
      headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${ls.get(K.token)}`, ...(opts.body ? { "Content-Type": "application/json" } : {}) },
    });
    if (r.status === 401) throw new Error("GitHub-token ongeldig of verlopen. Maak een nieuw token en koppel opnieuw.");
    if (r.status === 403) throw new Error(`Het token mag niet in ${repo()} schrijven. Geef het token bij Repository permissions → Contents "Read and write".`);
    if (r.status === 404 && opts.allow404) return null;
    if (r.status === 404) throw new Error(`Repository ${repo()} niet gevonden. Klopt de naam, en mag het token erbij?`);
    if (r.status === 409 || r.status === 422) { const e = new Error("conflict"); e.conflict = true; throw e; }
    if (!r.ok) throw new Error(`GitHub gaf fout ${r.status}.`);
    return r.json();
  }

  // base64 <-> UTF-8 tekst
  const enc = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
  const dec = (b) => new TextDecoder().decode(Uint8Array.from(atob(b.replace(/\s/g, "")), (c) => c.charCodeAt(0)));

  async function read() {
    const f = await gh(`/repos/${repo()}/contents/${PATH}`, { allow404: true });
    if (!f) return { stocks: null, sha: null };
    const data = JSON.parse(dec(f.content) || "{}");
    return { stocks: Array.isArray(data.stocks) ? data.stocks : [], sha: f.sha };
  }

  async function write(stocks, sha) {
    const body = { message: "Aandelenlijst bijgewerkt", content: enc(JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), stocks }, null, 2) + "\n") };
    if (sha) body.sha = sha;
    await gh(`/repos/${repo()}/contents/${PATH}`, { method: "PUT", body: JSON.stringify(body) });
  }

  async function checkPrivate() {
    const info = await gh(`/repos/${repo()}`);
    if (!info.private) throw new Error(`${repo()} is openbaar. Maak hem privé (Settings → General → Change visibility) of kies een andere repository.`);
  }

  /** Haal de centrale lijst op; bestaat die nog niet, dan wordt hij gemaakt met initialStocks. */
  async function pull(initialStocks = []) {
    const { stocks } = await read();
    if (stocks) return stocks;
    await write(initialStocks, null);
    return initialStocks;
  }

  /** Pas een wijziging toe op de NIEUWSTE centrale lijst en sla die op.
   *  Wijzigde het andere apparaat tegelijk iets, dan probeert hij het opnieuw. */
  async function change(mutate) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const { stocks, sha } = await read();
      const next = mutate((stocks || []).map((s) => ({ ...s })));
      try { await write(next, sha); return next; }
      catch (e) { if (!e.conflict) throw e; }
    }
    throw new Error("De lijst werd tegelijk op een ander apparaat gewijzigd. Probeer het nog eens.");
  }

  return {
    enabled: () => !!(ls.get(K.token) && repo()),
    pull, change, checkPrivate,
    getRepo: repo,
    hasToken: () => !!ls.get(K.token),
    configure(token, repoName) {
      if (token !== null) ls.set(K.token, token ? token.trim() : "");
      ls.set(K.repo, repoName ? repoName.trim().replace(/^https:\/\/github\.com\//, "").replace(/\/$/, "") : "");
    },
  };
})();
