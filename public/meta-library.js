(() => {
  "use strict";

  const STORAGE = {
    decks: "tornCommander.decks.v5",
    session: "tornCommander.session.v5",
    playerName: "tornCommander.playerName.v5",
    favourites: "tornCommander.metaFavourites.v38"
  };

  const state = {
    open: false,
    loading: false,
    decks: [],
    total: 0,
    filters: { categories: [], sources: [], archetypes: [] },
    query: { category: "", source: "", archetype: "", color: "", search: "" },
    selected: null,
    selectedDetail: null,
    favourites: loadJson(STORAGE.favourites, []),
    adminToken: sessionStorage.getItem("arenaCommander.metaAdminToken") || ""
  };

  function loadJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
    catch { return fallback; }
  }

  function saveJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function formatDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
  }

  function difficultyOptions(selected = "expert") {
    return ["beginner", "skilled", "competitive", "expert"]
      .map((value) => `<option value="${value}" ${value === selected ? "selected" : ""}>${value[0].toUpperCase()}${value.slice(1)}</option>`)
      .join("");
  }

  function savedDecks() {
    return loadJson(STORAGE.decks, []);
  }

  function playerName() {
    try { return localStorage.getItem(STORAGE.playerName) || "Fries91"; }
    catch { return "Fries91"; }
  }

  function ensureShell() {
    if (document.getElementById("metaLibraryOverlay")) return;
    document.body.insertAdjacentHTML("beforeend", `
      <div id="metaLibraryOverlay" class="meta-library-overlay is-hidden" aria-hidden="true">
        <section class="meta-library-shell" role="dialog" aria-modal="true" aria-labelledby="metaLibraryTitle">
          <header class="meta-library-header">
            <div><small>AI TEST LAB</small><h1 id="metaLibraryTitle">Meta Opponents</h1></div>
            <div class="meta-header-actions">
              <button type="button" class="meta-icon-button" data-meta-action="admin" title="Meta manager">⚙</button>
              <button type="button" class="meta-icon-button" data-meta-action="close" aria-label="Close">×</button>
            </div>
          </header>
          <div id="metaLibraryBody" class="meta-library-body"></div>
        </section>
      </div>
    `);
  }

  function injectLauncher() {
    if (document.getElementById("metaLibraryLauncher")) return;
    const app = document.getElementById("app");
    if (!app || document.body.classList.contains("in-game")) return;
    const looksLikeHome = app.querySelector("#createCommanderRoomForm, #createBrawlRoomForm, #createCustomRoomForm, .format-choice-grid, .home-action-grid");
    if (!looksLikeHome) return;
    const launcher = document.createElement("section");
    launcher.id = "metaLibraryLauncher";
    launcher.className = "meta-library-launcher panel";
    launcher.innerHTML = `
      <div class="meta-launcher-art">♜</div>
      <div class="meta-launcher-copy">
        <p class="eyebrow">Always refreshed</p>
        <h2>Play Against Meta Decks</h2>
        <p>Choose a trending Commander or competitive cEDH list, then pick the bot difficulty.</p>
      </div>
      <button type="button" class="primary-button" data-meta-action="open">Browse Meta Opponents</button>
    `;
    const firstPanel = app.querySelector("section");
    if (firstPanel?.nextSibling) app.insertBefore(launcher, firstPanel.nextSibling);
    else app.prepend(launcher);
  }

  function renderFilterOptions(values, selected, blank) {
    return `<option value="">${escapeHtml(blank)}</option>${(values || []).sort().map((value) => `<option value="${escapeHtml(value)}" ${value === selected ? "selected" : ""}>${escapeHtml(value)}</option>`).join("")}`;
  }

  function renderDeckCard(deck) {
    const favourite = state.favourites.includes(deck.id);
    return `
      <article class="meta-deck-card" data-meta-id="${escapeHtml(deck.id)}">
        <div class="meta-deck-art" ${deck.commanderImage ? `style="background-image:url('${escapeHtml(deck.commanderImage)}')"` : ""}>
          <span class="meta-category meta-${escapeHtml(deck.category)}">${escapeHtml(deck.category)}</span>
          <button type="button" class="meta-favourite ${favourite ? "is-active" : ""}" data-meta-action="favourite" data-meta-id="${escapeHtml(deck.id)}" aria-label="Favourite">★</button>
        </div>
        <div class="meta-deck-content">
          <h3>${escapeHtml(deck.title)}</h3>
          <p class="meta-commanders">${escapeHtml((deck.commanders || []).join(" / "))}</p>
          <div class="meta-tags">
            <span>${escapeHtml(deck.archetype || "Midrange")}</span>
            <span>${escapeHtml(deck.powerTier || "High power")}</span>
            <span>AI ${Number(deck.aiSupportScore || 0)}%</span>
          </div>
          <div class="meta-source-row"><small>${escapeHtml(deck.sourceLabel)}</small><small>Updated ${escapeHtml(formatDate(deck.importedAt || deck.lastSeenAt))}</small></div>
          <button type="button" class="secondary-button wide-button" data-meta-action="preview" data-meta-id="${escapeHtml(deck.id)}">Preview & Play</button>
        </div>
      </article>
    `;
  }

  function renderLibrary() {
    const body = document.getElementById("metaLibraryBody");
    if (!body) return;
    body.innerHTML = `
      <section class="meta-library-intro">
        <div><p class="eyebrow">Choose the opponent deck</p><h2>Trending and competitive Commander lists</h2><p>Deck snapshots are saved by version, so updates never change an active match.</p></div>
        <button class="ghost-button" type="button" data-meta-action="refresh">↻ Refresh</button>
      </section>
      <form id="metaFilterForm" class="meta-filter-bar">
        <label><span>Search</span><input name="search" value="${escapeHtml(state.query.search)}" placeholder="Commander, deck or archetype"></label>
        <label><span>Category</span><select name="category">${renderFilterOptions(state.filters.categories, state.query.category, "All categories")}</select></label>
        <label><span>Source</span><select name="source">${renderFilterOptions(state.filters.sources, state.query.source, "All sources")}</select></label>
        <label><span>Archetype</span><select name="archetype">${renderFilterOptions(state.filters.archetypes, state.query.archetype, "All archetypes")}</select></label>
        <label><span>Colour</span><select name="color"><option value="">Any colour</option>${["W","U","B","R","G"].map((color) => `<option value="${color}" ${state.query.color === color ? "selected" : ""}>${color}</option>`).join("")}</select></label>
        <button class="primary-button" type="submit">Apply</button>
      </form>
      <div class="meta-library-count"><strong>${state.total}</strong> available opponents ${state.favourites.length ? `• ${state.favourites.length} favourites` : ""}</div>
      ${state.loading ? `<div class="meta-loading"><span></span><p>Loading meta decks…</p></div>` : state.decks.length ? `<section class="meta-deck-grid">${state.decks.map(renderDeckCard).join("")}</section>` : `<div class="meta-empty"><h3>No decks found</h3><p>Run the first Meta sync from the manager or change the filters.</p></div>`}
    `;
  }

  function renderPreview(detail) {
    const body = document.getElementById("metaLibraryBody");
    const deck = detail.playableDeck;
    const summary = detail.deck;
    const profile = detail.aiProfile || {};
    const ownDecks = savedDecks();
    const cardRows = (deck.cards || []).map((entry) => `<li><b>${Number(entry.quantity || 1)}×</b><span>${escapeHtml(entry.name)}</span></li>`).join("");
    body.innerHTML = `
      <button type="button" class="meta-back-button" data-meta-action="back">← Back to Meta Library</button>
      <section class="meta-preview-hero">
        <div class="meta-preview-art" ${summary.commanderImage ? `style="background-image:url('${escapeHtml(summary.commanderImage)}')"` : ""}></div>
        <div class="meta-preview-copy">
          <span class="meta-category meta-${escapeHtml(summary.category)}">${escapeHtml(summary.category)}</span>
          <h2>${escapeHtml(summary.title)}</h2>
          <p>${escapeHtml((summary.commanders || []).join(" / "))}</p>
          <div class="meta-tags"><span>${escapeHtml(summary.archetype)}</span><span>${escapeHtml(summary.powerTier)}</span><span>AI ${Number(detail.aiSupportScore || 0)}%</span><span>${escapeHtml(detail.legalityStatus)}</span></div>
          <p class="meta-strategy"><strong>Bot plan:</strong> ${escapeHtml(profile.primaryPlan || profile.archetype || "Build resources, interact with threats and advance the deck's main engine.")}</p>
          ${summary.sourceUrl ? `<a class="meta-source-link" href="${escapeHtml(summary.sourceUrl)}" target="_blank" rel="noopener noreferrer">View credited source ↗</a>` : ""}
        </div>
      </section>
      <section class="meta-play-panel">
        <div><p class="eyebrow">Start a match</p><h3>Your deck vs this meta deck</h3></div>
        ${ownDecks.length ? `
          <form id="metaPlayForm" data-meta-id="${escapeHtml(summary.id)}">
            <label>Your deck<select name="playerDeckId" required><option value="">Choose your deck…</option>${ownDecks.map((own) => `<option value="${escapeHtml(own.id)}">${escapeHtml(own.name)} — ${escapeHtml((own.commanders || []).join(" / "))}</option>`).join("")}</select></label>
            <label>Bot difficulty<select name="difficulty">${difficultyOptions("expert")}</select></label>
            <label>Starting player<select name="startingPlayer"><option value="random">Random</option><option value="human">You</option><option value="bot">Bot</option></select></label>
            <button class="primary-button" type="submit">Play Against This Deck</button>
          </form>
        ` : `<div class="meta-empty compact"><p>Import your own Commander deck first.</p><button type="button" class="primary-button" data-meta-action="copy" data-meta-id="${escapeHtml(summary.id)}">Copy this deck to My Decks</button></div>`}
        <button type="button" class="ghost-button" data-meta-action="copy" data-meta-id="${escapeHtml(summary.id)}">Copy to My Decks</button>
      </section>
      <details class="meta-decklist" open><summary>Deck list — ${Number(deck.totalCards || 100)} cards</summary><ul>${cardRows}</ul></details>
      <details class="meta-version-panel"><summary>Saved version information</summary><p>Version ${escapeHtml(detail.versionId)} • Imported ${escapeHtml(formatDate(detail.importedAt))}. Active games keep this exact snapshot even after future syncs.</p></details>
      ${state.adminToken ? `<section class="meta-admin-inline"><button class="ghost-button" data-meta-action="feature" data-meta-id="${escapeHtml(summary.id)}">Feature Deck</button><button class="danger-button" data-meta-action="hide" data-meta-id="${escapeHtml(summary.id)}">Hide Deck</button></section>` : ""}
    `;
  }

  async function fetchDecks() {
    state.loading = true;
    renderLibrary();
    const params = new URLSearchParams({ limit: "60" });
    for (const [key, value] of Object.entries(state.query)) if (value) params.set(key, value);
    try {
      const response = await fetch(`/api/meta/decks?${params}`);
      const payload = await response.json();
      if (!payload.success) throw new Error(payload.error || "Meta library failed.");
      state.decks = payload.decks || [];
      state.total = payload.total || 0;
      state.filters = payload.filters || state.filters;
    } catch (error) {
      state.decks = [];
      state.total = 0;
      toast(error.message, "error");
    } finally {
      state.loading = false;
      renderLibrary();
    }
  }

  async function fetchDetail(id) {
    const response = await fetch(`/api/meta/decks/${encodeURIComponent(id)}`);
    const payload = await response.json();
    if (!payload.success) throw new Error(payload.error || "Deck could not be loaded.");
    state.selected = id;
    state.selectedDetail = payload;
    renderPreview(payload);
  }

  function toast(message, type = "info") {
    const region = document.getElementById("toastRegion") || document.body;
    const node = document.createElement("div");
    node.className = `toast ${type}`;
    node.textContent = message;
    region.appendChild(node);
    setTimeout(() => node.remove(), 4000);
  }

  function openLibrary() {
    ensureShell();
    state.open = true;
    const overlay = document.getElementById("metaLibraryOverlay");
    overlay.classList.remove("is-hidden");
    overlay.setAttribute("aria-hidden", "false");
    document.body.classList.add("meta-library-open");
    fetchDecks();
  }

  function closeLibrary() {
    state.open = false;
    document.getElementById("metaLibraryOverlay")?.classList.add("is-hidden");
    document.body.classList.remove("meta-library-open");
  }

  function toggleFavourite(id) {
    state.favourites = state.favourites.includes(id) ? state.favourites.filter((value) => value !== id) : [...state.favourites, id];
    saveJson(STORAGE.favourites, state.favourites);
    renderLibrary();
  }

  async function copyDeck(id) {
    const detail = state.selectedDetail?.deck?.id === id ? state.selectedDetail : await (await fetch(`/api/meta/decks/${encodeURIComponent(id)}`)).json();
    if (!detail.success) throw new Error(detail.error || "Deck could not be copied.");
    const deck = globalThis.structuredClone ? structuredClone(detail.playableDeck) : JSON.parse(JSON.stringify(detail.playableDeck));
    deck.id = `meta-copy-${id}-${Date.now()}`;
    deck.name = `${deck.name} [Meta]`;
    deck.meta = { ...(deck.meta || {}), metaDeckId: id, metaVersionId: detail.versionId };
    const decks = savedDecks();
    decks.unshift(deck);
    saveJson(STORAGE.decks, decks.slice(0, 100));
    toast("Meta deck copied to My Decks.", "success");
  }

  async function playAgainstMeta(form) {
    const data = new FormData(form);
    const ownDeck = savedDecks().find((deck) => deck.id === data.get("playerDeckId"));
    if (!ownDeck) throw new Error("Choose one of your decks.");
    const detail = state.selectedDetail;
    if (!detail?.playableDeck) throw new Error("Opponent deck is not loaded.");
    const socket = window.io({ transports: ["websocket", "polling"] });
    const payload = {
      playerName: playerName(),
      playerDeck: ownDeck,
      botDeck: detail.playableDeck,
      format: "commander",
      formatRules: null,
      difficulty: data.get("difficulty") || "expert",
      startingLife: 40,
      startingPlayer: data.get("startingPlayer") || "random",
      speedMs: 900
    };
    const response = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ success: false, error: "The game server did not respond." }), 15000);
      socket.emit("create-test-lab", payload, (result) => { clearTimeout(timer); resolve(result || { success: false, error: "No response." }); });
    });
    socket.close();
    if (!response.success) throw new Error(response.error || "Test Lab could not start.");
    saveJson(STORAGE.session, {
      roomCode: response.room.code,
      playerId: response.playerId,
      sessionToken: response.sessionToken
    });
    sessionStorage.setItem("arenaCommander.metaActive", JSON.stringify({ metaDeckId: detail.deck.id, versionId: detail.versionId, difficulty: payload.difficulty }));
    location.reload();
  }

  function adminHeaders() {
    return { "Content-Type": "application/json", "X-Meta-Admin-Token": state.adminToken };
  }

  function openAdmin() {
    ensureShell();
    const body = document.getElementById("metaLibraryBody");
    body.innerHTML = `
      <button type="button" class="meta-back-button" data-meta-action="back">← Back to Meta Library</button>
      <section class="meta-admin-panel">
        <p class="eyebrow">Host tools</p><h2>Meta Deck Manager</h2>
        <form id="metaAdminTokenForm"><label>Admin token<input name="token" type="password" value="${escapeHtml(state.adminToken)}" autocomplete="off"></label><button class="secondary-button" type="submit">Save token</button></form>
        <div class="meta-admin-actions"><button class="primary-button" type="button" data-meta-action="sync">Sync Meta Now</button><button class="ghost-button" type="button" data-meta-action="status">Check Sync Status</button></div>
        <form id="metaImportForm">
          <h3>Add a curated public deck</h3>
          <label>Public Moxfield or Archidekt URL<input name="url" type="url" placeholder="https://www.moxfield.com/decks/..."></label>
          <div class="meta-two"><label>Category<select name="category"><option value="curated">Curated</option><option value="competitive">Competitive</option><option value="trending">Trending</option></select></label><label>Power tier<select name="powerTier"><option value="high-power">High power</option><option value="cedh">cEDH</option><option value="casual">Casual</option></select></label></div>
          <label class="check-row"><input type="checkbox" name="featured"> Feature this deck</label>
          <button class="secondary-button" type="submit">Import and Build AI Profile</button>
        </form>
        <pre id="metaAdminOutput" class="meta-admin-output">Manager ready.</pre>
      </section>
    `;
  }

  async function adminRequest(url, options = {}) {
    if (!state.adminToken) throw new Error("Enter META_ADMIN_TOKEN first.");
    const response = await fetch(url, { ...options, headers: { ...adminHeaders(), ...(options.headers || {}) } });
    const payload = await response.json();
    if (!payload.success) throw new Error(payload.error || "Admin action failed.");
    return payload;
  }

  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-meta-action]");
    if (!button) return;
    const action = button.dataset.metaAction;
    try {
      if (action === "open") return openLibrary();
      if (action === "close") return closeLibrary();
      if (action === "back") { state.selected = null; state.selectedDetail = null; renderLibrary(); return; }
      if (action === "refresh") return fetchDecks();
      if (action === "preview") return fetchDetail(button.dataset.metaId);
      if (action === "favourite") return toggleFavourite(button.dataset.metaId);
      if (action === "copy") return await copyDeck(button.dataset.metaId);
      if (action === "admin") return openAdmin();
      if (action === "sync") {
        const output = document.getElementById("metaAdminOutput");
        output.textContent = "Syncing sources and building deck profiles…";
        const payload = await adminRequest("/api/meta/admin/sync", { method: "POST", body: "{}" });
        output.textContent = JSON.stringify(payload.result, null, 2);
        return;
      }
      if (action === "status") {
        const payload = await (await fetch("/api/meta/status")).json();
        document.getElementById("metaAdminOutput").textContent = JSON.stringify(payload, null, 2);
        return;
      }
      if (["feature", "hide"].includes(action)) {
        await adminRequest(`/api/meta/admin/decks/${encodeURIComponent(button.dataset.metaId)}`, {
          method: "PATCH",
          body: JSON.stringify(action === "feature" ? { featured: true } : { status: "hidden" })
        });
        toast(action === "hide" ? "Deck hidden." : "Deck featured.", "success");
        return fetchDecks();
      }
    } catch (error) {
      toast(error.message, "error");
    }
  });

  document.addEventListener("submit", async (event) => {
    const form = event.target;
    if (!["metaFilterForm", "metaPlayForm", "metaAdminTokenForm", "metaImportForm"].includes(form.id)) return;
    event.preventDefault();
    try {
      const data = new FormData(form);
      if (form.id === "metaFilterForm") {
        state.query = Object.fromEntries(["search", "category", "source", "archetype", "color"].map((key) => [key, String(data.get(key) || "")]));
        return fetchDecks();
      }
      if (form.id === "metaPlayForm") return await playAgainstMeta(form);
      if (form.id === "metaAdminTokenForm") {
        state.adminToken = String(data.get("token") || "").trim();
        sessionStorage.setItem("arenaCommander.metaAdminToken", state.adminToken);
        toast("Admin token saved for this browser session.", "success");
        return;
      }
      if (form.id === "metaImportForm") {
        const payload = await adminRequest("/api/meta/admin/import", {
          method: "POST",
          body: JSON.stringify({
            url: data.get("url"),
            category: data.get("category"),
            powerTier: data.get("powerTier"),
            featured: data.get("featured") === "on"
          })
        });
        document.getElementById("metaAdminOutput").textContent = JSON.stringify(payload.result, null, 2);
        return;
      }
    } catch (error) {
      toast(error.message, "error");
    }
  });

  const observer = new MutationObserver(() => injectLauncher());
  observer.observe(document.getElementById("app") || document.body, { childList: true, subtree: true });
  ensureShell();
  injectLauncher();
})();
