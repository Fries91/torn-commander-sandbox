(() => {
  "use strict";

  const app = document.getElementById("app");
  if (!app) return;

  const SESSION_KEY = "tornCommander.session.v5";
  const state = {
    syncQueued: false,
    joinOpened: false,
    hostCacheKey: "",
    hostAllowed: false,
    directory: null,
    loadingHost: false
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function readSession() {
    try {
      const value = JSON.parse(localStorage.getItem(SESSION_KEY));
      return value && typeof value === "object" ? value : null;
    } catch {
      return null;
    }
  }

  function requestedJoinCode() {
    try {
      return String(new URLSearchParams(location.search).get("join") || "")
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "")
        .slice(0, 6);
    } catch {
      return "";
    }
  }

  function queueSync() {
    if (state.syncQueued) return;
    state.syncQueued = true;
    requestAnimationFrame(() => {
      state.syncQueued = false;
      syncInterface();
    });
  }

  function syncDirectJoin() {
    if (state.joinOpened) return;
    const code = requestedJoinCode();
    const form = app.querySelector("#joinRoomForm");
    if (!code || !form) return;

    const input = form.elements.roomCode;
    if (input) input.value = code;
    const panel = form.closest("[data-home-panel]");
    if (panel?.hidden) app.querySelector('[data-home-panel-target="join"]')?.click();
    state.joinOpened = true;
  }

  function ensureHomePromo() {
    if (!app.querySelector(".format-home-hero") || app.querySelector("[data-notifier-promo]")) return;
    const section = document.createElement("section");
    section.className = "panel notifier-promo-card";
    section.dataset.notifierPromo = "1";
    section.innerHTML = `
      <div class="notifier-promo-icon" aria-hidden="true">♛</div>
      <div class="notifier-promo-copy">
        <p class="eyebrow">Torn game alerts</p>
        <h2>Know when a table is ready</h2>
        <p>Add a lightweight crown to Torn's header. It checks for listed games and opens the selected room code directly.</p>
      </div>
      <a class="primary-button notifier-promo-link" href="/notifier-install.html">Install Torn Notifier</a>`;
    app.appendChild(section);
  }

  async function postJson(url, payload) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      cache: "no-store",
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.success) throw new Error(data?.error || `Request failed (${response.status}).`);
    return data;
  }

  function currentLobbyCode() {
    return String(app.querySelector(".lobby-top .room-code")?.textContent || "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 6);
  }

  function panelHtml(directory, roomCode) {
    const listed = Boolean(directory?.listed);
    return `
      <div class="section-heading">
        <div><p class="eyebrow">Torn header notifier</p><h2>List this waiting room</h2><p>Only public waiting rooms with an open seat appear in the Torn notifier.</p></div>
        <span class="badge ${listed ? "success" : "warning"}">${listed ? "Listed" : "Private"}</span>
      </div>
      <form id="notifierLobbyForm" class="notifier-lobby-form" data-room-code="${escapeHtml(roomCode)}">
        <label class="check-row notifier-list-toggle"><input type="checkbox" name="listed" ${listed ? "checked" : ""}> Show this room in the Torn notifier</label>
        <div class="form-grid two">
          <label>Listing title<input name="title" maxlength="80" value="${escapeHtml(directory?.title || "")}" placeholder="Faction Commander game"></label>
          <label>Short note<input name="notes" maxlength="180" value="${escapeHtml(directory?.notes || "")}" placeholder="Need two more players"></label>
        </div>
        <div class="button-row"><button class="secondary-button" type="submit">Save notifier listing</button><a class="ghost-button" href="/notifier-install.html">Notifier install page</a></div>
      </form>`;
  }

  function injectHostPanel(roomCode) {
    let panel = app.querySelector("[data-lobby-notifier-panel]");
    if (!state.hostAllowed) {
      panel?.remove();
      return;
    }
    if (!panel) {
      panel = document.createElement("section");
      panel.className = "panel notifier-lobby-panel";
      panel.dataset.lobbyNotifierPanel = "1";
      const botPanel = app.querySelector(".lobby-bot-panel");
      if (botPanel) botPanel.before(panel);
      else app.querySelector(".lobby-grid")?.after(panel);
    }
    panel.innerHTML = panelHtml(state.directory, roomCode);
  }

  async function loadHostStatus(roomCode, session) {
    const key = `${roomCode}:${session.playerId}:${session.sessionToken}`;
    if (state.loadingHost || state.hostCacheKey === key) {
      injectHostPanel(roomCode);
      return;
    }
    state.hostCacheKey = key;
    state.hostAllowed = false;
    state.directory = null;
    state.loadingHost = true;
    try {
      const result = await postJson("/api/lobbies/host-status", {
        roomCode,
        playerId: session.playerId,
        sessionToken: session.sessionToken
      });
      state.hostAllowed = true;
      state.directory = result.directory || {};
    } catch {
      state.hostAllowed = false;
    } finally {
      state.loadingHost = false;
      injectHostPanel(roomCode);
    }
  }

  function syncLobbyNotifier() {
    const roomCode = currentLobbyCode();
    const session = readSession();
    if (!roomCode || !session || session.roomCode !== roomCode) {
      app.querySelector("[data-lobby-notifier-panel]")?.remove();
      return;
    }
    loadHostStatus(roomCode, session);
  }

  function syncInterface() {
    syncDirectJoin();
    ensureHomePromo();
    syncLobbyNotifier();
  }

  app.addEventListener("submit", async (event) => {
    const form = event.target.closest("#notifierLobbyForm");
    if (!form) return;
    event.preventDefault();
    const session = readSession();
    if (!session) return;
    const button = event.submitter || form.querySelector("button[type='submit']");
    const originalText = button?.textContent;
    if (button) { button.disabled = true; button.textContent = "Saving…"; }
    try {
      const data = new FormData(form);
      const result = await postJson("/api/lobbies/settings", {
        roomCode: session.roomCode,
        playerId: session.playerId,
        sessionToken: session.sessionToken,
        listed: data.get("listed") === "on",
        title: data.get("title"),
        notes: data.get("notes")
      });
      state.directory = result.directory || {};
      injectHostPanel(session.roomCode);
    } catch (error) {
      const message = document.createElement("div");
      message.className = "notice warning";
      message.textContent = error.message;
      form.prepend(message);
      setTimeout(() => message.remove(), 5000);
    } finally {
      if (button) { button.disabled = false; button.textContent = originalText || "Save notifier listing"; }
    }
  });

  const observer = new MutationObserver(queueSync);
  observer.observe(app, { childList: true, subtree: false });
  window.addEventListener("popstate", () => { state.joinOpened = false; queueSync(); });
  queueSync();
})();
