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
      catch (e) { setSync("Niet gesynchroniseerd", true); throw new Error(`Opslaan in GitHub mislukt: ${e.message}`); }
    } else {
      state.stocks = fixColors(mutate(state.stocks.map((s) => ({ ...s }))));
    }
    storage.saveStocks(state.stocks);
  }

  async function pullCentral(quiet = false) {
    if (!sync.enabled()) { setSync("Alleen op dit apparaat"); return; }
    if (!quiet) setSync("Ophalen…");
    try {
      const before = JSON.stringify(state.stocks.map((s) => s.ticker).sort());
      state.stocks = fixColors(await sync.pull(state.stocks));
      storage.saveStocks(state.stocks);
      setSync("Gesynchroniseerd");
      if (JSON.stringify(state.stocks.map((s) => s.ticker).sort()) !== before) {
        const known = new Set(state.stocks.map((s) => s.ticker));
        state.selected = new Set([...state.selected].filter((t) => known.has(t)));
        renderList(); drawChart();
      }
    } catch (e) { setSync("Niet gesynchroniseerd", true); msg(e.message, true); }
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
      li.innerHTML = `
        <label class="stock">
          <input type="checkbox" ${on ? "checked" : ""}>
          <span class="swatch" style="background:${on ? c : "transparent"};border-color:${c}"></span>
          <span class="name"><strong>${esc(s.ticker)}</strong><small>${esc([s.name, s.currency].filter(Boolean).join(" · "))}</small></span>
        </label>
        ${confirming
          ? '<button class="del-yes">Verwijderen</button><button class="del-no">Annuleer</button>'
          : `<button class="del" aria-label="${esc(s.ticker)} verwijderen">×</button>`}`;
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
          state.selected.delete(s.ticker); storage.removePrices(s.ticker); saveUi();
          msg(`${s.ticker} verwijderd.`); renderList(); drawChart();
        };
        li.querySelector(".del-no").onclick = () => { state.pendingDelete = null; renderList(); };
      } else {
        li.querySelector(".del").onclick = () => { state.pendingDelete = s.ticker; renderList(); };
      }
      ul.appendChild(li);
    }
  }

  async function addStock(raw) {
    const ticker = raw.trim().toUpperCase();
    if (!ticker) return;
    if (state.stocks.some((s) => s.ticker === ticker)) { msg(`${ticker} staat al in de lijst.`, true); return; }
    const btn = $("#add-btn"); btn.disabled = true; msg(`${ticker} ophalen…`);
    try {
      const prov = providers.get(storage.getSettings().provider);
      const info = await prov.lookup(ticker);
      const full = await prices.loadFull(ticker);
      const entry = { ticker, name: info.name, currency: info.currency, color: freeColor(), addedAt: new Date().toISOString() };
      await commit((list) => (list.some((x) => x.ticker === ticker) ? list : [...list, entry]));
      if (state.selected.size < MAX) state.selected.add(ticker);
      saveUi();
      msg(`${ticker} toegevoegd (${full.days.length.toLocaleString("nl-NL")} koersen vanaf ${full.days[0] ?? "–"}).`);
      $("#ticker").value = "";
      renderList(); drawChart();
    } catch (e) { msg(e.message, true); }
    finally { btn.disabled = false; }
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
    await Promise.all(tickers.map(async (t) => {
      try { const r = await prices.get(t); series[t] = r.series; if (r.warning) warnings.push(r.warning); }
      catch (e) { warnings.push(`${t}: ${e.message}`); }
    }));
    if (seq !== drawSeq) return; // er is intussen opnieuw getekend
    $("#loading").hidden = true;
    $("#warnings").textContent = warnings.join(" ");
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
      const cur = state.stocks.find((s) => s.ticker === t)?.currency || "";
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
    $("#twelve-key").value = s.twelveKey || "";
    $("#twelve-row").hidden = s.provider !== "twelve";
  }
  $("#provider").onchange = (e) => {
    storage.saveSettings({ ...storage.getSettings(), provider: e.target.value });
    renderSettings(); msg("Koersbron gewijzigd. Koersen worden opnieuw opgehaald."); drawChart();
  };
  $("#twelve-key").onchange = (e) => { storage.saveSettings({ ...storage.getSettings(), twelveKey: e.target.value.trim() }); drawChart(); };
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

  $("#gh-token").value = sync.hasToken() ? "••••••••" : "";
  $("#gh-repo").value = sync.getRepo();
  $("#gh-connect").onclick = async () => {
    const t = $("#gh-token").value.trim(), r = $("#gh-repo").value.trim();
    if (!/^[\w.-]+\/[\w.-]+$/.test(r.replace(/^https:\/\/github\.com\//, "").replace(/\/$/, ""))) { msg("Vul de repository in als naam/repository, bijv. EBriai/BelegData.", true); return; }
    if (!t) { msg("Plak eerst je GitHub-token in het veld.", true); return; }
    sync.configure(t.startsWith("•") ? null : t, r);
    $("#gh-token").value = "••••••••";
    msg("Koppelen met GitHub…"); setSync("Ophalen…");
    try { await sync.checkPrivate(); }
    catch (e) { sync.configure("", ""); $("#gh-token").value = ""; setSync("Alleen op dit apparaat"); msg(e.message, true); return; }
    await pullCentral();
    if ($("#sync-status").textContent === "Gesynchroniseerd") msg(`Gekoppeld. Je lijst staat nu privé in ${sync.getRepo()} (${state.stocks.length} aandelen).`);
    renderList(); drawChart();
  };
  $("#gh-disconnect").onclick = () => {
    sync.configure("", ""); $("#gh-token").value = "";
    setSync("Alleen op dit apparaat"); msg("Ontkoppeld. Je lijst blijft op dit apparaat staan; de centrale lijst in GitHub blijft bestaan.");
  };
  document.addEventListener("visibilitychange", () => { if (!document.hidden) pullCentral(true); });

  // ---------- start ----------
  $("#add-form").onsubmit = (e) => { e.preventDefault(); addStock($("#ticker").value); };
  $("#start").onchange = () => { state.range = "custom"; renderRanges(); drawChart(); };
  darkMq.addEventListener("change", () => { renderList(); drawChart(); });
  new MutationObserver(() => { renderList(); drawChart(); }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  state.selected = new Set([...state.selected].filter((t) => state.stocks.some((s) => s.ticker === t)));
  if (window.BELEG_ARTIFACT) {
    $("#mode-tag").textContent = "Testversie";
    const b = document.createElement("p"); b.className = "banner";
    b.textContent = "Testversie op claude.ai: deze pagina mag geen koersen van internet ophalen, dus je ziet verzonnen demokoersen. Je lijst wordt alleen in deze browser bewaard. De echte versie haalt wel live koersen op.";
    $("#banner-slot").appendChild(b);
  }
  renderSettings(); renderRanges(); renderList(); drawChart();
  if (!window.BELEG_ARTIFACT) pullCentral(); else setSync("");

  if ("serviceWorker" in navigator && !window.BELEG_NO_SW) navigator.serviceWorker.register("sw.js").catch(() => {});
})();
