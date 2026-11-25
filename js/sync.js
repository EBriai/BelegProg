// Eén centrale, versleutelde aandelenlijst in de repository van de app zelf,
// plus het ophalen van de koersen die GitHub Actions klaarzet.
//
// Het bestand data/kluis.json is openbaar leesbaar, maar de inhoud is met
// AES-256 versleuteld met jouw wachtwoord. Daarin staan je lijst én het
// GitHub-token waarmee de app wijzigingen opslaat. Zo hoeft een nieuw
// apparaat alleen het wachtwoord te weten.
window.Beleg = window.Beleg || {};

Beleg.sync = (() => {
  const PATH = "data/kluis.json";
  // Lijst en tickers staan op een eigen branch, zodat niet elke wijziging
  // de website opnieuw laat bouwen (GitHub Pages bouwt alleen vanaf main).
  const BRANCH = "data";
  const API = "https://api.github.com";
  const ITER = 310000;
  const PW_KEY = "beleg.kluisWachtwoord";
  const ls = {
    get: (k) => { try { return localStorage.getItem(k) || ""; } catch { return ""; } },
    set: (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch {} },
  };

  // Welke repository? Op GitHub Pages volgt dat uit het adres (naam.github.io/Repo/).
  function repo() {
    if (window.BELEG_DATA_REPO) return window.BELEG_DATA_REPO;
    const m = location.hostname.match(/^([^.]+)\.github\.io$/);
    const first = location.pathname.split("/").filter(Boolean)[0];
    return m && first ? `${m[1]}/${first}` : "EBriai/BelegProg";
  }

  let vault = null;      // ontsleutelde inhoud: {token, stocks}
  let password = "";
  let lastSha = null;
  let exists = null;     // bestaat data/kluis.json al?

  // ---------- versleuteling ----------
  const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  async function keyFrom(pw, salt) {
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: ITER, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }
  async function encrypt(obj, pw) {
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await keyFrom(pw, salt), new TextEncoder().encode(JSON.stringify(obj)));
    return { versie: 1, uitleg: "Versleutelde aandelenlijst van de Koersvergelijker (AES-256-GCM, PBKDF2).", iter: ITER, salt: b64(salt), iv: b64(iv), data: b64(ct) };
  }
  async function decrypt(file, pw) {
    try {
      const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(file.iv) }, await keyFrom(pw, unb64(file.salt)), unb64(file.data));
      return JSON.parse(new TextDecoder().decode(pt));
    } catch { throw new Error("Wachtwoord klopt niet."); }
  }

  // ---------- GitHub ----------
  async function gh(path, opts = {}) {
    const headers = { Accept: "application/vnd.github+json" };
    const token = opts.token ?? vault?.token;
    if (token) headers.Authorization = `Bearer ${token}`;
    if (opts.body) headers["Content-Type"] = "application/json";
    const r = await fetch(API + path, { method: opts.method || "GET", body: opts.body, headers, cache: "no-store" });
    if (r.status === 404 && opts.allow404) return null;
    if (r.status === 401) throw Object.assign(new Error("Het GitHub-token is ongeldig of verlopen. Vul bij Instellingen een nieuw token in."), { tokenProblem: true });
    if ((r.status === 403 || r.status === 404) && opts.secretsCall) throw Object.assign(new Error(`Het token mag geen secret zetten in ${repo()}. Geef het bij Repository permissions → Secrets "Read and write".`), { tokenProblem: true });
    if (r.status === 403 || r.status === 404) throw Object.assign(new Error(`Het token mag niet schrijven in ${repo()}. Geef het bij Repository permissions → Contents "Read and write".`), { tokenProblem: true });
    if (r.status === 409 || r.status === 422) throw Object.assign(new Error("conflict"), { conflict: true });
    if (!r.ok) throw new Error(`GitHub gaf fout ${r.status}.`);
    const txt = await r.text();   // sommige antwoorden (secret zetten) zijn leeg
    return txt ? JSON.parse(txt) : null;
  }
  async function readFile() {
    const f = await gh(`/repos/${repo()}/contents/${PATH}?ref=${BRANCH}`, { allow404: true });
    exists = !!f;
    if (!f) return null;
    lastSha = f.sha;
    return JSON.parse(atob(f.content.replace(/\s/g, "")));
  }
  async function writeFile(content, token) {
    const body = { message: "Aandelenlijst bijgewerkt (versleuteld)", branch: BRANCH, content: btoa(JSON.stringify(content, null, 1) + "\n") };
    if (lastSha) body.sha = lastSha;
    const r = await gh(`/repos/${repo()}/contents/${PATH}`, { method: "PUT", body: JSON.stringify(body), token });
    lastSha = r?.content?.sha || lastSha;
    exists = true;
  }

  // ---------- koersen via GitHub Actions ----------
  // Aparte sleutel voor de lijst met tickers en de koersen. GitHub Actions kent
  // deze sleutel (als secret KOERS_KEY), jouw wachtwoord kent hij niet.
  const gz = async (bytes, dir) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(dir === "in" ? new CompressionStream("gzip") : new DecompressionStream("gzip"))).arrayBuffer());
  const aesKey = (b64key) => crypto.subtle.importKey("raw", unb64(b64key), "AES-GCM", false, ["encrypt", "decrypt"]);
  async function sealData(obj, b64key) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(b64key), await gz(new TextEncoder().encode(JSON.stringify(obj)), "in"));
    return { versie: 1, iv: b64(iv), data: b64(ct) };
  }
  async function openData(file, b64key) {
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(file.iv) }, await aesKey(b64key), unb64(file.data));
    return JSON.parse(new TextDecoder().decode(await gz(new Uint8Array(pt), "out")));
  }

  async function setSecret(token, keyB64) {
    const pub = await gh(`/repos/${repo()}/actions/secrets/public-key`, { token, secretsCall: true });
    await gh(`/repos/${repo()}/actions/secrets/KOERS_KEY`, { method: "PUT", token, secretsCall: true, body: JSON.stringify({ encrypted_value: Beleg.sealedBox(pub.key, keyB64), key_id: pub.key_id }) });
  }

  /** Zet de (versleutelde) tickerlijst klaar; GitHub Actions haalt dan de koersen op. */
  async function writeTickers(stocks) {
    const tickers = [...new Set(stocks.map((s) => s.ticker))].sort();
    const path = `/repos/${repo()}/contents/data/tickers.enc`;
    for (let i = 0; i < 3; i++) {
      const cur = await gh(`${path}?ref=${BRANCH}`, { allow404: true });
      const body = { message: "Tickerlijst bijgewerkt (versleuteld)", branch: BRANCH, content: btoa(JSON.stringify(await sealData({ tickers }, vault.koersKey)) + "\n") };
      if (cur) body.sha = cur.sha;
      try { await gh(path, { method: "PUT", body: JSON.stringify(body) }); return; }
      catch (e) { if (!e.conflict) throw e; }
    }
  }

  /** De laatst opgehaalde koersen, of null als GitHub Actions nog niet klaar is. */
  async function readKoersen() {
    const r = await fetch(`${API}/repos/${repo()}/contents/koersen.enc?ref=koersen`, { cache: "no-store", headers: { Accept: "application/vnd.github.raw+json", Authorization: `Bearer ${vault.token}` } });
    if (r.status === 404) return null;
    if (r.status === 401) throw Object.assign(new Error("Het GitHub-token is ongeldig of verlopen. Vul bij Instellingen een nieuw token in."), { tokenProblem: true });
    if (!r.ok) throw new Error(`Koersen ophalen bij GitHub gaf fout ${r.status}.`);
    return openData(await r.json(), vault.koersKey);
  }

  /** Zorg dat er een koerssleutel is en dat GitHub Actions hem kent. */
  async function ensureKoersKey() {
    if (vault.koersKey) return;
    vault = { ...vault, koersKey: b64(crypto.getRandomValues(new Uint8Array(32))) };
    await setSecret(vault.token, vault.koersKey);
    await writeFile(await encrypt(vault, password), vault.token);
  }

  // ---------- openbare functies ----------
  /** "off" (nog niet ingesteld), "locked" (wachtwoord nodig) of "on". */
  async function init() {
    const file = await readFile();
    if (!file) return "off";
    const pw = ls.get(PW_KEY);
    if (pw) { try { vault = await decrypt(file, pw); password = pw; return "on"; } catch { ls.set(PW_KEY, ""); } }
    return "locked";
  }

  async function unlock(pw) {
    const file = await readFile();
    if (!file) throw new Error("Er is nog geen centrale lijst. Stel hem eerst in op je pc.");
    vault = await decrypt(file, pw);
    password = pw; ls.set(PW_KEY, pw);
    return vault.stocks || [];
  }

  // Maak de branch "data" aan (vanaf main) als hij nog niet bestaat.
  async function ensureBranch(token) {
    if (await gh(`/repos/${repo()}/git/ref/heads/${BRANCH}`, { allow404: true, token })) return;
    const main = await gh(`/repos/${repo()}/git/ref/heads/main`, { token });
    await gh(`/repos/${repo()}/git/refs`, { method: "POST", token, body: JSON.stringify({ ref: `refs/heads/${BRANCH}`, sha: main.object.sha }) });
  }

  /** Eenmalig instellen: token + wachtwoord. De huidige lijst wordt de centrale lijst. */
  async function setup(token, pw, stocks) {
    if (pw.length < 8) throw new Error("Kies een wachtwoord van minstens 8 tekens.");
    await readFile();
    if (exists) throw new Error("Er bestaat al een centrale lijst. Gebruik Ontgrendelen met je wachtwoord.");
    const next = { token: token.trim(), stocks, koersKey: b64(crypto.getRandomValues(new Uint8Array(32))) };
    await setSecret(next.token, next.koersKey);   // eerst: zonder sleutel kan Actions niets
    await ensureBranch(next.token);
    vault = next; password = pw;
    await writeTickers(stocks);
    await writeFile(await encrypt(next, pw), next.token);
    ls.set(PW_KEY, pw);
  }

  async function pull() {
    if (!vault) return null;
    const file = await readFile();
    if (!file) return vault.stocks;
    vault = await decrypt(file, password);
    return vault.stocks || [];
  }

  /** Pas een wijziging toe op de nieuwste centrale lijst en sla hem versleuteld op. */
  async function change(mutate, mutateGroups) {
    for (let i = 0; i < 3; i++) {
      const latest = (await pull()) || [];
      const next = { ...vault, stocks: mutate(latest.map((s) => ({ ...s }))) };
      if (mutateGroups) next.groups = mutateGroups([...(vault.groups || [])]);
      try {
        await writeFile(await encrypt(next, password), next.token); vault = next;
        const before = latest.map((s) => s.ticker).sort().join(), after = next.stocks.map((s) => s.ticker).sort().join();
        if (before !== after) await writeTickers(next.stocks);
        return next.stocks;
      }
      catch (e) { if (!e.conflict) throw e; }
    }
    throw new Error("De lijst werd tegelijk op een ander apparaat gewijzigd. Probeer het nog eens.");
  }

  async function replaceToken(token) {
    if (!vault) throw new Error("Ontgrendel eerst de lijst.");
    await pull();
    const next = { ...vault, token: token.trim() };
    await writeFile(await encrypt(next, password), next.token);
    vault = next;
  }

  function forget() { vault = null; password = ""; ls.set(PW_KEY, ""); }

  return { init, unlock, setup, pull, change, replaceToken, forget, repo, readKoersen, groups: () => vault?.groups || null, writeTickers, ensureKoersKey, enabled: () => !!vault };
})();
