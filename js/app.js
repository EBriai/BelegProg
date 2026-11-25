// Gebruikersinterface: verbindt opslag, koersen en grafiek.
(() => {
  const { storage, prices, analysis, providers, sync } = Beleg;
  const PALETTE = {
    light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"],
    dark: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#0ca30c", "#9085e9", "#e66767"],
  };
  const MAX = 8;
  const RANGES = [["1M", 1], ["6M", 6], ["YTD", "ytd"], ["1J", 12], ["3J", 36], ["5J", 60], ["10J", 120], ["Max", null]];
  const $ = (s) => document.querySelector(s);
  const darkMq = matchMedia("(prefers-color-scheme: dark)");
  const isDark = () => {
    const t = document.documentElement.getAttribute("data-theme");
    return t ? t === "dark" : darkMq.matches;
  };
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const fmt = (n, d = 2) => (n == null ? "–" : n.toLocaleString("nl-NL", { minimumFractionDigits: d, maximumFractionDigits: d }));
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  const ui = storage.getUi();
  const state = {
    stocks: storage.getStocks(),
    selected: new Set(ui.selected || []),
    range: ui.range && ui.range !== "custom" ? ui.range : "1J",
    pendingDelete: null,
    waiting: false,   // wacht op GitHub Actions
  };
  // Beurzen: Yahoo-achtervoegsel, afkortingen (de eerste wordt getoond) en volledige naam.
  const EXCHANGES = [
    [".AS", ["AMS", "EAM", "AEX"], "Euronext Amsterdam"], [".BR", ["BRU", "EBR"], "Euronext Brussel"],
    [".PA", ["PAR", "EPA"], "Euronext Parijs"], [".LS", ["LIS", "ELI"], "Euronext Lissabon"], [".IR", ["ISE", "EDU"], "Euronext Dublin"],
    [".DE", ["XETRA", "IBIS", "XETR", "ETR", "GER"], "Xetra (elektronisch handelsplatform van de Deutsche Börse)"],
    [".F", ["FWB", "FRA", "FSE"], "Frankfurter Wertpapierbörse (parkethandel)"],
    [".BE", ["BER"], "Börse Berlin"], [".DU", ["DUS"], "Börse Düsseldorf"], [".HM", ["HAM"], "Börse Hamburg"],
    [".MU", ["MUN"], "Börse München"], [".SG", ["STU"], "Börse Stuttgart"],
    [".L", ["LSE", "LON"], "London Stock Exchange"], [".MI", ["MIL", "BIT"], "Borsa Italiana, Milaan"], [".MC", ["BME", "MCE"], "Bolsa de Madrid"],
    [".SW", ["SIX", "SWX", "VTX"], "SIX Swiss Exchange, Zürich"], [".VI", ["VIE", "WBAG"], "Wiener Börse"], [".WA", ["WSE", "GPW"], "Warschau"],
    [".ST", ["STO", "OMX"], "Nasdaq Stockholm"], [".CO", ["CPH"], "Nasdaq Kopenhagen"], [".HE", ["HEL"], "Nasdaq Helsinki"], [".OL", ["OSL", "OSE"], "Oslo Børs"],
    ["=US", ["NYSE", "NASDAQ", "US", "NMS", "NYQ"], "Verenigde Staten"], [".TO", ["TSX", "TOR"], "Toronto Stock Exchange"],
    [".T", ["TSE", "TYO", "JPX"], "Tokyo Stock Exchange"], [".HK", ["HKEX", "HKG"], "Hong Kong Exchange"], [".AX", ["ASX"], "Australian Securities Exchange"],
  ];
  const exchByCode = (code) => EXCHANGES.find(([, codes]) => codes.includes(code.toUpperCase()));
  const exchCodes = (e) => (e[0] === "=US" ? "NYSE / NASDAQ" : e[1].slice(0, e[0] === ".DE" ? 2 : 1).join(" / "));

  /** Begrijpt "RHM FWB", "RHM.FWB", "FWB:RHM" en "RHM" + gekozen beurs. */
  function parseInput(raw, suffix) {
    let t = raw.trim().toUpperCase().replace(/\s+/g, " ");
    let m = /^([A-Z]{2,6}):(.+)$/.exec(t) || null;                 // FWB:RHM (zoals op Google)
    if (m && exchByCode(m[1])) { suffix = exchByCode(m[1])[0]; t = m[2]; }
    else if ((m = /^(.+?)[ .]([A-Z]{2,6})$/.exec(t)) && exchByCode(m[2])) { suffix = exchByCode(m[2])[0]; t = m[1]; } // RHM FWB / RHM.FWB
    if (suffix && !/[.^=]/.test(t)) t += suffix === "=US" ? "" : suffix;
    return t;
  }
  /** "XETRA / IBIS – Xetra, Frankfurt (elektronisch)" voor RHM.DE; anders wat Yahoo meegeeft. */
  function exchLabel(symbol, yahooName) {
    const m = /\.[A-Z]{1,3}$/.exec(symbol || "");
    const e = m && EXCHANGES.find(([suf]) => suf === m[0]);
    if (e) return `${exchCodes(e)} – ${e[2]}`;
    return yahooName || "";
  }
  const item = (t) => Beleg.prices.cached()?.items?.[t];
  const isPending = (s) => {
    const snap = Beleg.prices.cached(), it = snap?.items?.[s.ticker];
    return !it || (s.addedAt && snap.generated && snap.generated < s.addedAt && it.error);
  };
  const saveUi = () => storage.saveUi({ selected: [...state.selected], range: state.range });
  // kleur volgt het aandeel en blijft gelijk bij (de)selecteren
  const colorOf = (t) => {
    const s = state.stocks.find((x) => x.ticker === t);
    return PALETTE[isDark() ? "dark" : "light"][(s?.color ?? 0) % MAX];
  };
  const freeColor = () => {
    const used = new Set(state.stocks.map((s) => s.color));
    let i = 0; while (used.has(i)) i++;
    return i;
  };

  // Geef elk aandeel een eigen kleur; bestaande kleuren blijven staan.
  function fixColors(list) {
    const used = new Set();
    for (const s of list) {
      if (s.color == null || used.has(s.color)) { let i = 0; while (used.has(i)) i++; s.color = i; }
      used.add(s.color);
    }
    return list;
  }

  function setSync(text, err = false) { const t = $("#sync-status"); t.textContent = text; t.classList.toggle("err", err); }

  /** Alle wijzigingen aan de lijst lopen hierlangs: centraal (gist) als dat
   *  is ingesteld, anders alleen op dit apparaat. */
  async function commit(mutate) {
    if (sync.enabled()) {
      setSync("Opslaan…");
      try { state.stocks = fixColors(await sync.change(mutate)); setSync("Gesynchroniseerd"); }
      catch (e) { setSync("Niet gesynchroniseerd", true); throw new Error(`Opslaan mislukt: ${e.message}`); }
    } else {
      state.stocks = fixColors(mutate(state.stocks.map((s) => ({ ...s }))));
    }
    storage.saveStocks(state.stocks);
  }

  async function pullCentral(quiet = false) {
    if (!sync.enabled()) return;
    if (!quiet) setSync("Ophalen…");
    try { applyCentral(await sync.pull()); setSync("Gesynchroniseerd"); }
    catch (e) { setSync("Niet gesynchroniseerd", true); if (!quiet) msg(e.message, true); }
  }

  function applyCentral(list) {
    const before = JSON.stringify(state.stocks.map((s) => s.ticker).sort());
    state.stocks = fixColors(list);
    // nieuw apparaat: zet de eerste aandelen meteen aan in de grafiek
    if (!storage.getUi().selected) { state.selected = new Set(state.stocks.slice(0, MAX).map((s) => s.ticker)); saveUi(); }
    storage.saveStocks(state.stocks);
    if (JSON.stringify(state.stocks.map((s) => s.ticker).sort()) !== before) {
      const known = new Set(state.stocks.map((s) => s.ticker));
      state.selected = new Set([...state.selected].filter((t) => known.has(t)));
      renderList(); drawChart();
    }
  }

  // Toon de juiste onderdelen voor "niet ingesteld", "vergrendeld" of "actief".
  function showSyncState(mode) {
    $("#unlock-box").hidden = mode !== "locked";
    $("#sync-setup").hidden = mode !== "off";
    $("#sync-on").hidden = mode !== "on";
    $("#setup-hint").hidden = mode !== "off";
    setSync({ off: "Alleen op dit apparaat", locked: "Vergrendeld", on: "Gesynchroniseerd", error: "Niet gesynchroniseerd" }[mode] || "", mode === "error");
  }

  function msg(text, err = false) { const m = $("#msg"); m.textContent = text; m.classList.toggle("err", err); }

  // ---------- lijst ----------
  function renderList() {
    const ul = $("#stocks");
    ul.innerHTML = "";
    if (!state.stocks.length) {
      ul.innerHTML = '<li class="empty-list">Nog geen aandelen. Voeg er hierboven een toe, bijvoorbeeld <b>ASML.AS</b>.</li>';
      return;
    }
    for (const s of [...state.stocks].sort((a, b) => a.ticker.localeCompare(b.ticker))) {
      const on = state.selected.has(s.ticker);
      const c = colorOf(s.ticker);
      const li = document.createElement("li");
      const confirming = state.pendingDelete === s.ticker;
      const it = item(s.ticker);
      let sub, subClass = "";
      if (it && !it.error) sub = [it.symbol !== s.ticker ? it.symbol : null, it.name, exchLabel(it.symbol, it.exchange), it.currency].filter(Boolean).join(" · ");
      else if (isPending(s)) { sub = "Koersen worden opgehaald…"; subClass = "pending"; }
      else { sub = it.candidates?.length ? "Niet gevonden, kies hieronder een beurs" : "Niet gevonden bij Yahoo. Controleer de ticker."; subClass = "bad"; }
      const altList = (it?.candidates || []).filter((a) => a.symbol !== it?.symbol);
      const alts = altList.length ? altList : null;
      li.innerHTML = `
        <div class="stock-main">
        <label class="stock">
          <input type="checkbox" ${on ? "checked" : ""}>
          <span class="swatch" style="background:${on ? c : "transparent"};border-color:${c}"></span>
          <span class="name"><strong>${esc(s.ticker)}</strong><small class="${subClass}">${esc(sub)}</small></span>
        </label>
        ${confirming
          ? '<button class="del-yes">Verwijderen</button><button class="del-no">Annuleer</button>'
          : `<button class="del" aria-label="${esc(s.ticker)} verwijderen">×</button>`}
        </div>
        ${alts ? `<select class="alt" aria-label="Andere beurs voor ${esc(s.ticker)}"><option value="">${it.error ? "Kies de juiste notering…" : "Andere beurs kiezen…"}</option>${alts.map((a) => `<option value="${esc(a.symbol)}">${esc(a.symbol)} · ${esc(exchLabel(a.symbol, a.exchange))}</option>`).join("")}</select>` : ""}`;
      const altSel = li.querySelector(".alt");
      if (altSel) altSel.onchange = () => { if (altSel.value) replaceTicker(s.ticker, altSel.value); };
      li.querySelector("input").onchange = (e) => {
        if (e.target.checked && state.selected.size >= MAX) {
          e.target.checked = false; msg(`Maximaal ${MAX} aandelen tegelijk in de grafiek.`, true); return;
        }
        e.target.checked ? state.selected.add(s.ticker) : state.selected.delete(s.ticker);
        saveUi(); renderList(); drawChart();
      };
      if (confirming) {
        li.querySelector(".del-yes").onclick = async () => {
          state.pendingDelete = null;
          try { await commit((list) => list.filter((x) => x.ticker !== s.ticker)); }
          catch (e) { msg(e.message, true); renderList(); return; }
          state.selected.delete(s.ticker); saveUi();
          msg(`${s.ticker} verwijderd.`); renderList(); drawChart();
        };
        li.querySelector(".del-no").onclick = () => { state.pendingDelete = null; renderList(); };
      } else {
        li.querySelector(".del").onclick = () => { state.pendingDelete = s.ticker; renderList(); };
      }
      ul.appendChild(li);
    }
  }

  // Na een wijziging zet GitHub Actions de koersen klaar (±1 minuut). Zolang
  // er aandelen wachten, kijken we elke 10 seconden of ze er zijn.
  async function waitForPrices() {
    if (state.waiting) return;
    state.waiting = true;
    const until = Date.now() + 5 * 60_000;
    try {
      while (Date.now() < until && state.stocks.some(isPending)) {
        await new Promise((r) => setTimeout(r, 10_000));
        try { await Beleg.prices.snapshot(state.stocks.map((s) => s.ticker), 0); } catch {}
        renderList(); drawChart();
      }
      if (state.stocks.some(isPending)) msg("De koersen zijn er na 5 minuten nog niet. GitHub is mogelijk traag; de app probeert het opnieuw als je hem straks opent.", true);
    } finally { state.waiting = false; }
  }

  async function addStock(raw, suffix) {
    const ticker = parseInput(raw, suffix);
    if (!ticker) return;
    if (state.stocks.some((s) => s.ticker === ticker)) { msg(`${ticker} staat al in de lijst.`, true); return; }
    if (storage.getSettings().provider === "github" && !sync.enabled()) { msg("Stel eerst de centrale lijst in (of open hem met je wachtwoord). Pas dan kan de app koersen ophalen.", true); return; }
    const btn = $("#add-btn"); btn.disabled = true; msg(`${ticker} toevoegen…`);
    try {
      const entry = { ticker, color: freeColor(), addedAt: new Date().toISOString() };
      await commit((list) => (list.some((x) => x.ticker === ticker) ? list : [...list, entry]));
      if (state.selected.size < MAX) state.selected.add(ticker);
      saveUi();
      $("#ticker").value = ""; $("#exchange").value = "";
      if (storage.getSettings().provider === "demo") { await Beleg.prices.snapshot(state.stocks.map((s) => s.ticker), 0); msg(`${ticker} toegevoegd.`); }
      else { msg(`${ticker} toegevoegd. GitHub haalt nu de koersen op, dat duurt ongeveer een minuut.`); waitForPrices(); }
      renderList(); drawChart();
    } catch (e) { msg(e.message, true); }
    finally { btn.disabled = false; }
  }

  async function replaceTicker(oldT, newT) {
    if (state.stocks.some((s) => s.ticker === newT)) { msg(`${newT} staat al in de lijst.`, true); renderList(); return; }
    try {
      await commit((list) => list.map((x) => (x.ticker === oldT ? { ...x, ticker: newT, addedAt: new Date().toISOString() } : x)));
      if (state.selected.delete(oldT)) state.selected.add(newT);
      saveUi(); msg(`${oldT} vervangen door ${newT}. Koersen worden opgehaald…`);
      renderList(); drawChart(); waitForPrices();
    } catch (e) { msg(e.message, true); renderList(); }
  }

  // ---------- periode ----------
  function startDate() {
    if (state.range === "custom") return $("#start").value || null;
    const r = RANGES.find(([k]) => k === state.range)?.[1];
    if (r == null) return null;
    const d = new Date();
    if (r === "ytd") return `${d.getFullYear()}-01-01`;
    d.setMonth(d.getMonth() - r);
    return d.toISOString().slice(0, 10);
  }
  function renderRanges() {
    const box = $("#ranges"); box.innerHTML = "";
    for (const [k] of RANGES) {
      const b = document.createElement("button");
      b.textContent = k; b.setAttribute("aria-pressed", state.range === k);
      b.onclick = () => { state.range = k; $("#start").value = ""; saveUi(); renderRanges(); drawChart(); };
      box.appendChild(b);
    }
  }

  // ---------- grafiek ----------
  function empty(text) { $("#empty").textContent = text; $("#empty").hidden = !text; $("#chart").hidden = !!text; }
  let drawSeq = 0;
  async function drawChart() {
    const seq = ++drawSeq;
    const tickers = state.stocks.map((s) => s.ticker).filter((t) => state.selected.has(t));
    $("#summary tbody").innerHTML = ""; $("#warnings").textContent = ""; $("#base-day").textContent = "";
    if (!tickers.length) { Plotly.purge("chart"); empty("Vink één of meer aandelen aan om ze te vergelijken."); return; }
    empty(""); $("#loading").hidden = false;
    const series = {}, warnings = [];
    let snap = prices.cached();
    try { snap = await prices.snapshot(state.stocks.map((s) => s.ticker)); }
    catch (e) { warnings.push(snap ? `Bijwerken mislukt (${e.message}). Je ziet de laatst opgehaalde koersen.` : e.message); }
    if (seq !== drawSeq) return; // er is intussen opnieuw getekend
    $("#loading").hidden = true;
    renderList(); // namen en status komen uit de koersen
    for (const t of tickers) { const it = snap?.items?.[t]; if (it && it.days) series[t] = it; }
    const waiting = tickers.filter((t) => !snap?.items?.[t]);
    const notFound = tickers.filter((t) => snap?.items?.[t]?.error);
    if (waiting.length) warnings.push(`Koersen voor ${waiting.join(", ")} worden nog opgehaald.`);
    if (notFound.length) warnings.push(`Niet gevonden: ${notFound.join(", ")}.`);
    $("#warnings").textContent = warnings.join(" ");
    if (snap?.generated) $("#as-of").textContent = `Koersen bijgewerkt: ${new Date(snap.generated).toLocaleString("nl-NL", { dateStyle: "medium", timeStyle: "short" })}`;
    if (!Object.keys(series).length) { Plotly.purge("chart"); empty(waiting.length ? "De koersen worden opgehaald. Dit duurt ongeveer een minuut." : "Geen koersen."); renderList(); return; }
    const data = analysis.normalize(series, startDate());
    if (!data.dates.length) { Plotly.purge("chart"); empty("Geen koersen in deze periode."); return; }
    $("#base-day").textContent = ` (${new Date(data.start).toLocaleDateString("nl-NL")})`;

    const shown = tickers.filter((t) => data.series[t]);
    const traces = shown.map((t) => ({
      x: data.dates, y: data.series[t], name: t, type: "scatter", mode: "lines",
      line: { color: colorOf(t), width: 2 }, customdata: data.closes[t],
      hovertemplate: `<b>${esc(t)}</b> %{y:.1f}  (koers %{customdata:.2f})<extra></extra>`,
    }));
    const text = css("--muted"), grid = css("--grid");
    const narrow = innerWidth < 640;
    Plotly.react("chart", traces, {
      paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",
      font: { family: css("--font-body"), color: text, size: 12 },
      margin: { l: 40, r: 8, t: 8, b: 30 }, hovermode: "x unified", dragmode: narrow ? false : "zoom",
      hoverlabel: { bgcolor: css("--surface"), bordercolor: css("--line"), font: { color: css("--ink") } },
      showlegend: true, legend: { orientation: "h", y: -0.14, x: 0 },
      xaxis: { gridcolor: grid, hoverformat: "%d-%m-%Y", showspikes: true, spikemode: "across", spikethickness: 1, spikecolor: text, spikedash: "solid", fixedrange: narrow },
      yaxis: { gridcolor: grid, zeroline: false, fixedrange: narrow },
      shapes: [{ type: "line", xref: "paper", x0: 0, x1: 1, y0: 100, y1: 100, line: { color: text, width: 1, dash: "dot" } }],
    }, { responsive: true, displaylogo: false, displayModeBar: !narrow });

    const tbody = $("#summary tbody");
    for (const t of shown) {
      const c = data.closes[t], ret = data.series[t].at(-1) - 100;
      const cur = item(t)?.currency || "";
      const tr = document.createElement("tr");
      tr.innerHTML = `<td><span class="swatch" style="background:${colorOf(t)};border-color:${colorOf(t)}"></span>${esc(t)}</td>
        <td>${fmt(c[0])}</td><td>${fmt(c.at(-1))} <span class="cur">${esc(cur)}</span></td>
        <td class="${ret >= 0 ? "up" : "down"}">${ret >= 0 ? "+" : "−"}${fmt(Math.abs(ret), 1)}%</td>`;
      tbody.appendChild(tr);
    }
  }

  // ---------- instellingen ----------
  function renderSettings() {
    const s = storage.getSettings();
    const sel = $("#provider"); sel.innerHTML = "";
    for (const [k, p] of Object.entries(providers.all)) {
      const o = document.createElement("option"); o.value = k; o.textContent = p.label; o.selected = k === s.provider; sel.appendChild(o);
    }
  }
  $("#provider").onchange = (e) => {
    storage.saveSettings({ ...storage.getSettings(), provider: e.target.value });
    prices.reset(); renderSettings(); msg("Koersbron gewijzigd."); renderList(); drawChart();
  };
  $("#export").onclick = async () => {
    const txt = JSON.stringify(storage.exportAll());
    $("#transfer").value = txt;
    try { await navigator.clipboard.writeText(txt); msg("Je lijst is gekopieerd. Plak hem op je andere apparaat bij Importeren."); }
    catch { $("#transfer").select(); msg("Kopieer de geselecteerde tekst en plak die op je andere apparaat."); }
  };
  $("#import").onclick = async () => {
    try {
      storage.importAll(JSON.parse($("#transfer").value));
      const imported = storage.getStocks();
      await commit(() => imported);
      renderSettings(); renderList(); drawChart(); msg(`${state.stocks.length} aandelen geïmporteerd.`);
    } catch (e) { msg(`Importeren mislukt: ${e.message}`, true); }
  };

  $("#unlock-box").onsubmit = async (e) => {
    e.preventDefault();
    const btn = $("#unlock-btn"); btn.disabled = true; msg("Openen…");
    try { applyCentral(await sync.unlock($("#unlock-pw").value)); $("#unlock-pw").value = ""; showSyncState("on"); prices.reset(); msg(`Je centrale lijst is geopend (${state.stocks.length} aandelen).`); renderList(); drawChart(); }
    catch (err) { msg(err.message, true); }
    finally { btn.disabled = false; }
  };
  $("#setup-btn").onclick = async () => {
    const t = $("#setup-token").value.trim(), pw = $("#setup-pw").value;
    if (!t) { msg("Plak eerst het GitHub-token.", true); return; }
    const btn = $("#setup-btn"); btn.disabled = true; msg("Centrale lijst aanmaken…");
    try {
      await sync.setup(t, pw, state.stocks);
      $("#setup-token").value = ""; $("#setup-pw").value = "";
      showSyncState("on"); msg("Klaar. GitHub haalt nu de koersen op (ongeveer een minuut). Op je telefoon vul je straks alleen dit wachtwoord in.");
      renderList(); drawChart(); waitForPrices();
    } catch (err) { msg(err.message, true); }
    finally { btn.disabled = false; }
  };
  $("#token-btn").onclick = async () => {
    const t = $("#new-token").value.trim(); if (!t) { msg("Plak eerst het nieuwe token.", true); return; }
    try { await sync.replaceToken(t); $("#new-token").value = ""; showSyncState("on"); msg("Token vervangen."); }
    catch (err) { msg(err.message, true); }
  };
  $("#setup-hint").onclick = () => { $("#settings").open = true; $("#sync-setup").scrollIntoView({ behavior: "smooth", block: "start" }); };
  $("#forget-btn").onclick = () => { sync.forget(); showSyncState("locked"); msg("Dit apparaat is vergrendeld. Je lijst blijft centraal bewaard."); };
  document.addEventListener("visibilitychange", () => { if (!document.hidden) pullCentral(true); });

  // ---------- start ----------
  $("#add-form").onsubmit = (e) => { e.preventDefault(); addStock($("#ticker").value, $("#exchange").value); };
  { const o = document.createElement("option"); o.value = ""; o.textContent = "Beurs: automatisch (hoofdbeurs)"; $("#exchange").appendChild(o); }
  for (const e of EXCHANGES) {
    const o = document.createElement("option"); o.value = e[0]; o.textContent = `${exchCodes(e)} – ${e[2]}`; $("#exchange").appendChild(o);
  }
  $("#start").onchange = () => { state.range = "custom"; renderRanges(); drawChart(); };
  darkMq.addEventListener("change", () => { renderList(); drawChart(); });
  new MutationObserver(() => { renderList(); drawChart(); }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  state.selected = new Set([...state.selected].filter((t) => state.stocks.some((s) => s.ticker === t)));
  if (window.BELEG_ARTIFACT) {
    $("#mode-tag").textContent = "Testversie";
    const b = document.createElement("p"); b.className = "banner";
    b.textContent = "Testversie op claude.ai met verzonnen demokoersen. De echte app staat op https://ebriai.github.io/BelegProg/";
    $("#banner-slot").appendChild(b);
  }
  renderSettings(); renderRanges(); renderList(); drawChart();
  if (window.BELEG_ARTIFACT) { setSync(""); $("#sync-setup").hidden = true; }
  else sync.init().then(async (mode) => {
      showSyncState(mode);
      if (mode !== "on") return;
      await pullCentral();
      try { await sync.ensureKoersKey(); } catch (e) { msg(e.message, true); }
      drawChart(); if (state.stocks.some(isPending)) waitForPrices();
    })
    .catch((e) => { showSyncState("error"); msg(`Centrale lijst niet bereikbaar: ${e.message}. Je ziet de lijst van dit apparaat.`, true); });

  if ("serviceWorker" in navigator && !window.BELEG_NO_SW) navigator.serviceWorker.register("sw.js").catch(() => {});
})();
