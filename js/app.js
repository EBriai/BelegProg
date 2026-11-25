// Gebruikersinterface: verbindt opslag, koersen en grafiek.
(() => {
  const { storage, prices, analysis, providers, sync } = Beleg;
  const PALETTE = {
    light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"],
    dark: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#0ca30c", "#9085e9", "#e66767"],
  };
  const MAX = 20;
  const DASHES = ["solid", "dash", "dot"];
  const NGROUPS = 5, GSIZE = 10;
  const normGroups = (g) => Array.from({ length: NGROUPS }, (_, i) => String(g?.[i] ?? "").trim().slice(0, 24) || `Groep ${i + 1}`);
  const groupOf = (s) => (Number.isInteger(s.group) && s.group >= 0 && s.group < NGROUPS ? s.group : null);
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
    groups: normGroups(storage.getGroups()),
    range: ui.range && ui.range !== "custom" ? ui.range : "1J",
    pendingDelete: null,
    highlight: null,
    assigning: null,   // ticker waarvoor de knoppen "Naar groep" open staan
    waiting: false,   // wacht op GitHub Actions
  };
  // Beurzen: Yahoo-achtervoegsel, afkortingen (de eerste wordt getoond) en volledige naam.
  const EXCHANGES = [
    [".AS", ["AMS", "AEB", "EAM", "AEX"], "Euronext Amsterdam"], [".BR", ["BRU", "EBR", "ENEXT.BE"], "Euronext Brussel"],
    [".PA", ["PAR", "SBF", "EPA"], "Euronext Parijs"], [".LS", ["LIS", "ELI"], "Euronext Lissabon"], [".IR", ["ISE", "EDU"], "Euronext Dublin"],
    [".DE", ["XETRA", "IBIS", "XETR", "ETR", "GER"], "Xetra (elektronisch handelsplatform van de Deutsche Börse)"],
    [".F", ["FWB", "FRA", "FSE"], "Frankfurter Wertpapierbörse (parkethandel)"],
    [".BE", ["BER"], "Börse Berlin"], [".DU", ["DUS"], "Börse Düsseldorf"], [".HM", ["HAM"], "Börse Hamburg"],
    [".MU", ["MUN"], "Börse München"], [".SG", ["SWB", "STU"], "Börse Stuttgart"],
    [".L", ["LSE", "LON", "LSEETF"], "London Stock Exchange"], [".MI", ["MIL", "BVME", "BIT"], "Borsa Italiana, Milaan"], [".MC", ["BME", "MCE", "BM"], "Bolsa de Madrid"],
    [".SW", ["SIX", "EBS", "SWX", "VTX"], "SIX Swiss Exchange, Zürich"], [".VI", ["VIE", "WBAG"], "Wiener Börse"], [".WA", ["WSE", "GPW"], "Warschau"],
    [".ST", ["STO", "OMX"], "Nasdaq Stockholm"], [".CO", ["CPH"], "Nasdaq Kopenhagen"], [".HE", ["HEL"], "Nasdaq Helsinki"], [".OL", ["OSL", "OSE"], "Oslo Børs"],
    ["=US", ["NYSE", "NASDAQ", "ARCA", "AMEX", "US", "NMS", "NYQ"], "Verenigde Staten"],
    // TSE = Toronto, zoals bij Interactive Brokers (Tokio = TSEJ)
    [".TO", ["TSX", "TSE", "TOR"], "Toronto Stock Exchange"], [".V", ["TSXV", "VENTURE", "CDNX"], "TSX Venture Exchange"],
    [".CN", ["CSE"], "Canadian Securities Exchange"],
    [".T", ["TYO", "TSEJ", "JPX"], "Tokyo Stock Exchange"], [".HK", ["HKEX", "SEHK", "HKG"], "Hong Kong Exchange"], [".AX", ["ASX"], "Australian Securities Exchange"],
  ];
  // "NASDAQ.NMS" en "NYSE.ARCA" (Interactive Brokers) tellen als NASDAQ/NYSE
  const exchByCode = (code) => {
    const c = code.toUpperCase();
    return EXCHANGES.find(([, codes]) => codes.includes(c)) || EXCHANGES.find(([, codes]) => codes.includes(c.split(".")[0]) && /^(NASDAQ|NYSE)\./.test(c));
  };
  const exchCodes = (e) => (e[0] === "=US" ? "NYSE / NASDAQ" : e[1].slice(0, 2).join(" / "));

  /** Begrijpt "RHM FWB", "RHM.FWB", "FWB:RHM" en "RHM" + gekozen beurs. */
  function parseInput(raw, suffix) {
    let t = raw.trim().toUpperCase().replace(/\s+/g, " ");
    let m = /^([A-Z.]{2,10}):(.+)$/.exec(t) || null;                       // FWB:RHM (zoals op Google)
    if (m && exchByCode(m[1])) { suffix = exchByCode(m[1])[0]; t = m[2]; }
    else if ((m = /^(.+?) ([A-Z][A-Z.]{1,10})$/.exec(t)) && exchByCode(m[2])) { suffix = exchByCode(m[2])[0]; t = m[1]; } // RHM FWB, RGTI NASDAQ.SCM
    else if ((m = /^(.+?)\.([A-Z]{2,6})$/.exec(t)) && exchByCode(m[2]) && !EXCHANGES.some(([suf]) => suf === "." + m[2])) { suffix = exchByCode(m[2])[0]; t = m[1]; } // RHM.FWB
    if (suffix === ".HK" && /^\d{1,4}$/.test(t)) t = t.padStart(4, "0");   // Yahoo: 2618.HK, 0005.HK
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
    return PALETTE[isDark() ? "dark" : "light"][(s?.color ?? 0) % 8];
  };
  // na 8 kleuren volgt dezelfde kleur gestreept, daarna gestippeld: 24 unieke lijnen
  const dashOf = (t) => DASHES[Math.floor((state.stocks.find((x) => x.ticker === t)?.color ?? 0) / 8) % 3];
  const swatch = (t, on = true) => {
    const c = colorOf(t), d = { solid: "", dash: 'stroke-dasharray="5 3"', dot: 'stroke-dasharray="1.5 2.5"' }[dashOf(t)];
    return `<svg class="swatch" viewBox="0 0 22 10" aria-hidden="true"><line x1="2" y1="5" x2="20" y2="5" stroke="${c}" stroke-width="${on ? 3 : 1.5}" stroke-linecap="round" ${d} opacity="${on ? 1 : .5}"/></svg>`;
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
  async function commit(mutate, mutateGroups) {
    const mg = mutateGroups && ((g) => normGroups(mutateGroups(normGroups(g))));
    if (sync.enabled()) {
      setSync("Opslaan…");
      try { state.stocks = fixColors(await sync.change(mutate, mg)); state.groups = normGroups(sync.groups() || state.groups); setSync("Gesynchroniseerd"); }
      catch (e) { setSync("Niet gesynchroniseerd", true); throw new Error(`Opslaan mislukt: ${e.message}`); }
    } else {
      state.stocks = fixColors(mutate(state.stocks.map((s) => ({ ...s }))));
      if (mg) state.groups = mg(state.groups);
    }
    storage.saveStocks(state.stocks); storage.saveGroups(state.groups);
  }

  async function pullCentral(quiet = false) {
    if (!sync.enabled()) return;
    if (!quiet) setSync("Ophalen…");
    try { applyCentral(await sync.pull()); setSync("Gesynchroniseerd"); }
    catch (e) { setSync("Niet gesynchroniseerd", true); if (!quiet) msg(e.message, true); }
  }

  function applyCentral(list) {
    const before = JSON.stringify(state.stocks.map((s) => s.ticker).sort());
    const layout = () => JSON.stringify([state.groups, state.stocks.map((s) => [s.ticker, groupOf(s)]).sort()]);
    const beforeLayout = layout();
    state.stocks = fixColors(list);
    if (sync.groups()) state.groups = normGroups(sync.groups());
    storage.saveGroups(state.groups);
    // nieuw apparaat: zet de eerste aandelen meteen aan in de grafiek
    if (!storage.getUi().selected) { state.selected = new Set(state.stocks.slice(0, MAX).map((s) => s.ticker)); saveUi(); }
    storage.saveStocks(state.stocks);
    if (JSON.stringify(state.stocks.map((s) => s.ticker).sort()) !== before) {
      const known = new Set(state.stocks.map((s) => s.ticker));
      state.selected = new Set([...state.selected].filter((t) => known.has(t)));
      renderList(); drawChart();
    } else if (layout() !== beforeLayout && !document.activeElement?.classList.contains("gname")) renderList();
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
  const byTicker = (a, b) => a.ticker.localeCompare(b.ticker);
  function renderList() {
    renderGroups();
    const ul = $("#stocks");
    ul.innerHTML = "";
    $("#h-main").hidden = !state.stocks.length;
    if (!state.stocks.length) {
      ul.innerHTML = '<li class="empty-list">Nog geen aandelen. Voeg er hierboven een toe, bijvoorbeeld <b>ASML.AS</b>.</li>';
      return;
    }
    const main = state.stocks.filter((s) => groupOf(s) === null).sort(byTicker);
    if (!main.length) ul.innerHTML = '<li class="drop-hint">Alle aandelen zitten in een groep. Sleep er een hierheen om hem uit zijn groep te halen.</li>';
    for (const s of main) ul.appendChild(stockLi(s));
  }

  function renderGroups() {
    const box = $("#groups");
    box.hidden = !state.stocks.length;
    box.innerHTML = "";
    state.groups.forEach((name, g) => {
      const members = state.stocks.filter((s) => groupOf(s) === g).sort(byTicker);
      const nOn = members.filter((s) => state.selected.has(s.ticker)).length;
      const sec = document.createElement("section");
      sec.className = "group"; sec.dataset.drop = g;
      sec.innerHTML = `
        <div class="group-head">
          <input type="checkbox" class="gchk" aria-label="Groep ${esc(name)} in de grafiek" ${members.length && nOn === members.length ? "checked" : ""} ${members.length ? "" : "disabled"}>
          <input class="gname" value="${esc(name)}" maxlength="24" aria-label="Naam van groep ${g + 1}" enterkeyhint="done" spellcheck="false">
          <span class="gcount">${members.length}/${GSIZE}</span>
        </div>
        <ul class="glist"></ul>`;
      const chk = sec.querySelector(".gchk");
      chk.indeterminate = nOn > 0 && nOn < members.length;
      chk.onchange = () => {
        if (chk.checked) {
          const add = members.map((s) => s.ticker).filter((t) => !state.selected.has(t));
          const room = MAX - state.selected.size;
          add.slice(0, room).forEach((t) => state.selected.add(t));
          if (add.length > room) msg(`De grafiek toont maximaal ${MAX} aandelen. Niet getoond uit ${name}: ${add.slice(Math.max(room, 0)).join(", ")}. Zet eerst een andere groep of losse aandelen uit.`, true);
        } else members.forEach((s) => state.selected.delete(s.ticker));
        saveUi(); renderList(); drawChart();
      };
      const nameIn = sec.querySelector(".gname");
      nameIn.onkeydown = (e) => { if (e.key === "Enter") nameIn.blur(); if (e.key === "Escape") { nameIn.value = name; nameIn.blur(); } };
      nameIn.onchange = async () => {
        const v = nameIn.value.trim().slice(0, 24) || `Groep ${g + 1}`;
        nameIn.value = v;
        if (v === state.groups[g]) return;
        try { await commit((list) => list, (gr) => { gr[g] = v; return gr; }); msg(`Groepsnaam opgeslagen: ${v}.`); }
        catch (e) { msg(e.message, true); renderList(); }
      };
      const ul = sec.querySelector(".glist");
      if (!members.length) ul.innerHTML = `<li class="drop-hint">Sleep hier aandelen naartoe (max. ${GSIZE})</li>`;
      for (const s of members) ul.appendChild(stockLi(s));
      box.appendChild(sec);
    });
  }

  // Verplaats een aandeel naar groep g (0–4) of terug naar de hoofdgroep ("main").
  async function moveToGroup(ticker, dest) {
    state.assigning = null;
    const g = dest === "main" ? null : Number(dest);
    const s = state.stocks.find((x) => x.ticker === ticker);
    if (!s || groupOf(s) === g) { renderList(); return; }
    if (g !== null && state.stocks.filter((x) => groupOf(x) === g).length >= GSIZE) {
      msg(`${state.groups[g]} is vol (maximaal ${GSIZE} aandelen). Haal er eerst een uit.`, true); renderList(); return;
    }
    try {
      await commit((list) => list.map((x) => {
        if (x.ticker !== ticker) return x;
        const y = { ...x }; if (g === null) delete y.group; else y.group = g; return y;
      }));
      msg(g === null ? `${ticker} staat weer in de hoofdgroep.` : `${ticker} zit nu in ${state.groups[g]}.`);
    } catch (e) { msg(e.message, true); }
    renderList();
  }

  // Slepen met muis én vinger (pointer events; HTML5 drag-and-drop werkt niet op Android).
  function startDrag(e, s, li) {
    if (e.button > 0) return;
    e.preventDefault();
    const x0 = e.clientX, y0 = e.clientY;
    let ghost = null, target = null, lastY = y0, raf = 0;
    const findTarget = (x, y) => document.elementFromPoint(x, y)?.closest("[data-drop]") || null;
    const scroll = () => {
      const edge = 70;
      if (lastY < edge) scrollBy(0, -Math.ceil((edge - lastY) / 4));
      else if (lastY > innerHeight - edge) scrollBy(0, Math.ceil((lastY - innerHeight + edge) / 4));
      raf = requestAnimationFrame(scroll);
    };
    const move = (ev) => {
      lastY = ev.clientY;
      if (!ghost) {
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
        ghost = document.createElement("div"); ghost.className = "drag-ghost"; ghost.innerHTML = `${swatch(s.ticker)}<b>${esc(s.ticker)}</b>`;
        document.body.appendChild(ghost); li.classList.add("dragging"); document.body.classList.add("dragging-stock");
        raf = requestAnimationFrame(scroll);
      }
      ghost.style.transform = `translate(${ev.clientX + 10}px, ${ev.clientY - 18}px)`;
      const t = findTarget(ev.clientX, ev.clientY);
      if (t !== target) { target?.classList.remove("over"); target = t; target?.classList.add("over"); }
    };
    const end = (ev) => {
      removeEventListener("pointermove", move); removeEventListener("pointerup", end); removeEventListener("pointercancel", end);
      cancelAnimationFrame(raf);
      document.body.classList.remove("dragging-stock");
      if (!ghost) { // alleen getikt: toon de knoppen om een groep te kiezen
        if (ev.type === "pointerup") { state.assigning = state.assigning === s.ticker ? null : s.ticker; renderList(); }
        return;
      }
      ghost.remove(); li.classList.remove("dragging"); target?.classList.remove("over");
      if (ev.type === "pointerup" && target) moveToGroup(s.ticker, target.dataset.drop);
    };
    addEventListener("pointermove", move); addEventListener("pointerup", end); addEventListener("pointercancel", end);
  }

  function stockLi(s) {
    {
      const on = state.selected.has(s.ticker);
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
        <button type="button" class="grip" aria-label="${esc(s.ticker)} naar een groep verplaatsen" title="Slepen naar een groep, of tikken om te kiezen"><svg viewBox="0 0 10 16" aria-hidden="true"><g fill="currentColor"><circle cx="2.5" cy="3" r="1.4"/><circle cx="7.5" cy="3" r="1.4"/><circle cx="2.5" cy="8" r="1.4"/><circle cx="7.5" cy="8" r="1.4"/><circle cx="2.5" cy="13" r="1.4"/><circle cx="7.5" cy="13" r="1.4"/></g></svg></button>
        <label class="stock">
          <input type="checkbox" ${on ? "checked" : ""}>
          ${swatch(s.ticker, on)}
          <span class="name"><strong>${esc(s.ticker)}</strong><small class="${subClass}">${esc(sub)}</small></span>
        </label>
        ${confirming
          ? '<button class="del-yes">Verwijderen</button><button class="del-no">Annuleer</button>'
          : `<button class="del" aria-label="${esc(s.ticker)} verwijderen">×</button>`}
        </div>
        ${alts ? `<select class="alt" aria-label="Andere beurs voor ${esc(s.ticker)}"><option value="">${it.error ? "Kies de juiste notering…" : "Andere beurs kiezen…"}</option>${alts.map((a) => `<option value="${esc(a.symbol)}">${esc(a.symbol)} · ${esc(exchLabel(a.symbol, a.exchange))}</option>`).join("")}</select>` : ""}`;
      if (state.assigning === s.ticker) {
        const cur = groupOf(s);
        const opts = state.groups.map((n, g) => [g, n, state.stocks.filter((x) => groupOf(x) === g).length]).filter(([g]) => g !== cur);
        const row = document.createElement("div"); row.className = "assign";
        row.innerHTML = '<span>Naar:</span>' + opts.map(([g, n, k]) => `<button type="button" data-g="${g}" ${k >= GSIZE ? "disabled" : ""}>${esc(n)} <small>${k}/${GSIZE}</small></button>`).join("")
          + (cur !== null ? '<button type="button" data-g="main">Hoofdgroep</button>' : "");
        row.onclick = (e) => { const b = e.target.closest("button[data-g]"); if (b) moveToGroup(s.ticker, b.dataset.g); };
        li.appendChild(row);
      }
      li.querySelector(".grip").onpointerdown = (e) => startDrag(e, s, li);
      li.querySelector(".grip").onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); state.assigning = state.assigning === s.ticker ? null : s.ticker; renderList(); } };
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
      return li;
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
      else await dropFailedImports();
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

  /** Meerdere aandelen in één keer, bijv. geplakt uit je broker:
   *  één per regel ("LDO BVME"), of gescheiden door komma's/puntkomma's. */
  /** Na "meerdere tegelijk": wat Yahoo niet kent weer weghalen en alleen dat melden. */
  async function dropFailedImports() {
    const failed = state.stocks.filter((s) => s.batch && item(s.ticker)?.error).map((s) => s.ticker);
    const ok = state.stocks.filter((s) => s.batch && item(s.ticker) && !item(s.ticker).error).map((s) => s.ticker);
    if (!failed.length && !ok.length) return;
    try {
      await commit((list) => list.filter((x) => !failed.includes(x.ticker)).map(({ batch, ...x }) => x));
      failed.forEach((t) => state.selected.delete(t)); saveUi();
      renderList(); drawChart();
      if (failed.length) msg(`Niet toegevoegd, Yahoo kent ${failed.length === 1 ? "deze" : "deze"} niet: ${failed.join(", ")}. Controleer de schrijfwijze of voeg ze los toe.`, true);
      else msg(`Klaar: alle ${ok.length} aandelen zijn toegevoegd.`);
    } catch (e) { msg(e.message, true); }
  }

  async function addMany(text) {
    const lines = text.split(/[\n,;]+/).map((l) => l.replace(/\t/g, " ").trim()).filter(Boolean);
    const wanted = [...new Set(lines.map((l) => parseInput(l, "")).filter(Boolean))];
    const known = new Set(state.stocks.map((s) => s.ticker));
    const fresh = wanted.filter((t) => !known.has(t));
    if (!fresh.length) { msg(wanted.length ? "Die staan allemaal al in je lijst." : "Plak eerst je tickers.", true); return; }
    if (storage.getSettings().provider === "github" && !sync.enabled()) { msg("Stel eerst de centrale lijst in (of open hem met je wachtwoord).", true); return; }
    const btn = $("#bulk-btn"); btn.disabled = true; msg(`${fresh.length} aandelen toevoegen…`);
    try {
      const now = new Date().toISOString();
      await commit((list) => {
        const have = new Set(list.map((x) => x.ticker)), out = [...list];
        for (const t of fresh) if (!have.has(t)) out.push({ ticker: t, addedAt: now, batch: now });
        return out;
      });
      for (const t of fresh) if (state.selected.size < MAX) state.selected.add(t);
      saveUi(); $("#bulk").value = "";
      msg(`${fresh.length} aandelen toegevoegd${wanted.length > fresh.length ? ` (${wanted.length - fresh.length} stonden er al)` : ""}. GitHub haalt nu de koersen op, dat duurt een tot twee minuten. Wat Yahoo niet kent, haal ik daarna weer weg en meld ik hier.`);
      renderList(); drawChart(); if (storage.getSettings().provider === "demo") await Beleg.prices.snapshot(state.stocks.map((s) => s.ticker), 0); else waitForPrices();
    } catch (e) { msg(e.message, true); }
    finally { btn.disabled = false; }
  }

  // ---------- schermafbeelding van je broker ----------
  /** Herkende regels -> "TICKER BEURS". Een slecht gelezen beurscode wordt
   *  gekoppeld aan de dichtstbijzijnde bekende code (bijv. AE8 -> AEB). */
  const lev = (a, b) => {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  };
  const ALL_CODES = [...EXCHANGES.flatMap(([, c]) => c), "NASDAQ.NMS", "NASDAQ.SCM", "NASDAQ.NGS", "NYSE.ARCA"];
  function matchCode(raw) {
    const x = raw.toUpperCase().replace(/[^A-Z.]/g, "");
    if (!x) return null;
    if (exchByCode(x)) return x;
    let best = null, bestD = 99;
    for (const c of ALL_CODES) { const dd = lev(x, c); if (dd < bestD) { best = c; bestD = dd; } }
    return bestD <= Math.max(1, Math.floor(best.length / 3)) ? best : null;
  }
  function parseOcrRows(rows) {
    const out = [];
    const withCode = rows.filter((r) => r.code && matchCode(r.code)).length;
    for (const r of rows) {
      const t = r.ticker.toUpperCase().replace(/[^A-Z0-9.]/g, "");
      if (!/^[A-Z0-9][A-Z0-9.]{0,7}$/.test(t)) continue;
      const code = r.code ? matchCode(r.code) || matchCode(r.raw || "") : null;
      if (code) out.push(`${t} ${code}`);
      // regels zonder beurscode alleen als de hele afbeelding geen beurscodes heeft (geen kopjes en saldi)
      else if (withCode < 2 && t.length >= 2 && t.length <= 6 && !["INSTRUMENT", "SYMBOL", "TICKER"].includes(t)) out.push(t);
    }
    return [...new Set(out)];
  }

  async function readScreenshot(file) {
    if (!file) return;
    $("#bulk-box").open = true;
    const status = (t, err) => msg(t, err);
    status("Afbeelding lezen… (de eerste keer duurt dit wat langer)");
    try {
      const rows = await Beleg.ocr.read(file, (p) => status(`Afbeelding lezen… ${p}%`));
      const found = parseOcrRows(rows);
      if (!found.length) { status("Ik kon geen tickers in deze afbeelding vinden. Typ ze liever in.", true); return; }
      await addMany(found.join("\n"));
    } catch (e) { status(e.message, true); }
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
    $("#summary tbody").innerHTML = ""; $("#hl-hint").hidden = true; $("#warnings").textContent = ""; $("#base-day").textContent = "";
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

    // beste rendement bovenaan, zodat legenda, tooltip en tabel dezelfde volgorde hebben
    const shown = tickers.filter((t) => data.series[t]).sort((a, b) => data.series[b].at(-1) - data.series[a].at(-1));
    if (state.highlight && !shown.includes(state.highlight)) state.highlight = null;
    const hl = state.highlight;
    const many = shown.length > 8;
    const traces = shown.map((t) => ({
      x: data.dates, y: data.series[t], name: t, type: "scatter", mode: "lines",
      opacity: hl && hl !== t ? 0.18 : 1,
      line: { color: colorOf(t), dash: dashOf(t), width: hl === t ? 3.5 : many ? 1.6 : 2 }, customdata: data.closes[t],
      hovertemplate: `<b>${esc(t)}</b> %{y:.1f}  (koers %{customdata:.2f})<extra></extra>`,
    }));
    const text = css("--muted"), grid = css("--grid");
    const narrow = innerWidth < 640;
    Plotly.react("chart", traces, {
      paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",
      font: { family: css("--font-body"), color: text, size: 12 },
      margin: { l: 40, r: 8, t: 8, b: 30 }, hovermode: "x unified", dragmode: narrow ? false : "zoom",
      hoverlabel: { bgcolor: css("--surface"), bordercolor: css("--line"), font: { color: css("--ink"), size: many ? 11 : 12 } },
      // op de telefoon is de tabel onder de grafiek de legenda
      showlegend: !narrow, legend: { orientation: "h", y: -0.14, x: 0, itemclick: false, itemdoubleclick: false },
      xaxis: { gridcolor: grid, hoverformat: "%d-%m-%Y", showspikes: true, spikemode: "across", spikethickness: 1, spikecolor: text, spikedash: "solid", fixedrange: narrow },
      yaxis: { gridcolor: grid, zeroline: false, fixedrange: narrow },
      shapes: [{ type: "line", xref: "paper", x0: 0, x1: 1, y0: 100, y1: 100, line: { color: text, width: 1, dash: "dot" } }],
    }, { responsive: true, displaylogo: false, displayModeBar: !narrow });
    const chartEl = $("#chart");
    chartEl.removeAllListeners?.("plotly_legendclick");
    chartEl.on?.("plotly_legendclick", (ev) => { toggleHighlight(shown[ev.curveNumber]); return false; });

    const tbody = $("#summary tbody");
    for (const t of shown) {
      const c = data.closes[t], ret = data.series[t].at(-1) - 100;
      const cur = item(t)?.currency || "";
      const tr = document.createElement("tr");
      tr.dataset.t = t; tr.tabIndex = 0; tr.title = "Tik om deze lijn uit te lichten";
      if (hl === t) tr.classList.add("hl"); else if (hl) tr.classList.add("dim");
      tr.onclick = () => toggleHighlight(t);
      tr.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleHighlight(t); } };
      const nm = item(t)?.name || "";
      tr.innerHTML = `<td>${swatch(t)}${esc(t)}<small class="nm2">${esc(nm)}</small></td><td class="nm" title="${esc(nm)}">${esc(nm)}</td>
        <td>${fmt(c[0])}</td><td>${fmt(c.at(-1))} <span class="cur">${esc(cur)}</span></td>
        <td class="${ret >= 0 ? "up" : "down"}">${ret >= 0 ? "+" : "−"}${fmt(Math.abs(ret), 1)}%</td>`;
      tbody.appendChild(tr);
    }
    $("#hl-hint").hidden = shown.length < 3;
  }

  // alleen de stijl aanpassen: snel, en zonder koersen opnieuw op te halen
  function toggleHighlight(t) {
    const hl = state.highlight = state.highlight === t ? null : t;
    const el = $("#chart"), shown = (el.data || []).map((tr) => tr.name), many = shown.length > 8;
    if (shown.length) Plotly.restyle(el, {
      opacity: shown.map((x) => (hl && hl !== x ? 0.18 : 1)),
      "line.width": shown.map((x) => (hl === x ? 3.5 : many ? 1.6 : 2)),
    });
    for (const tr of $("#summary tbody").children) {
      tr.classList.toggle("hl", hl === tr.dataset.t);
      tr.classList.toggle("dim", !!hl && hl !== tr.dataset.t);
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
  $("#bulk-btn").onclick = () => addMany($("#bulk").value);
  $("#shot").onchange = (e) => { readScreenshot(e.target.files[0]); e.target.value = ""; };
  // slepen naar de pagina en plakken (Ctrl+V) van een afbeelding
  const firstImage = (list) => [...(list || [])].find((f) => f.type?.startsWith("image/"));
  addEventListener("dragover", (e) => { if ([...e.dataTransfer.types].includes("Files")) { e.preventDefault(); document.body.classList.add("dragging"); } });
  addEventListener("dragleave", (e) => { if (!e.relatedTarget) document.body.classList.remove("dragging"); });
  addEventListener("drop", (e) => {
    document.body.classList.remove("dragging");
    const f = firstImage(e.dataTransfer?.files); if (!f) return;
    e.preventDefault(); readScreenshot(f);
  });
  addEventListener("paste", (e) => {
    const f = firstImage([...(e.clipboardData?.items || [])].map((i) => i.getAsFile()).filter(Boolean));
    if (f) { e.preventDefault(); readScreenshot(f); }
  });
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
