// ==UserScript==
// @name         Arena Commander - Torn Game Notifier
// @namespace    https://torn-commander-sandbox.onrender.com/
// @version      1.2.0
// @description  Adds a lightweight Arena Commander game notifier inside Torn's real header icon row.
// @author       Fries91
// @homepageURL  https://torn-commander-sandbox.onrender.com/notifier-install.html
// @supportURL   https://torn-commander-sandbox.onrender.com/notifier-install.html
// @updateURL    https://torn-commander-sandbox.onrender.com/arena-commander-notifier.user.js
// @downloadURL  https://torn-commander-sandbox.onrender.com/arena-commander-notifier.user.js
// @icon         https://torn-commander-sandbox.onrender.com/notifier-icon.svg
// @match        https://www.torn.com/*
// @match        https://torn.com/*
// @connect      torn-commander-sandbox.onrender.com
// @run-at       document-idle
// @noframes
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_notification
// @grant        GM_openInTab
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// ==/UserScript==

(() => {
  "use strict";

  const SCRIPT_VERSION = "1.2.0";
  const API_ROOT = "https://torn-commander-sandbox.onrender.com";
  const OPEN_GAMES_URL = `${API_ROOT}/api/lobbies/open`;
  const INSTALL_URL = `${API_ROOT}/notifier-install.html`;
  const STORAGE_KEY = "arenaCommanderTornNotifier.v1";

  const POLL_VISIBLE_MS = 45_000;
  const POLL_HIDDEN_MS = 180_000;
  const POLL_ERROR_MAX_MS = 300_000;
  const HEADER_RETRY_VISIBLE_MS = 5_000;
  const HEADER_RETRY_HIDDEN_MS = 20_000;
  const REQUEST_TIMEOUT_MS = 15_000;
  const SEEN_TTL_MS = 86_400_000;

  const DEFAULTS = Object.freeze({
    enabled: true,
    sound: true,
    vibration: true,
    desktop: true,
    commander: true,
    brawl: true,
    custom: true,
    showBots: true,
    minimumSeats: 1,
    seen: {}
  });

  const state = {
    settings: { ...DEFAULTS },
    games: [],
    loading: false,
    error: "",
    lastCheckedAt: null,
    errorCount: 0,
    interacted: false,
    pollTimer: null,
    headerTimer: null,
    slot: null,
    button: null,
    badge: null,
    popup: null,
    popupOpen: false,
    audioContext: null
  };

  function safeParse(value, fallback) {
    try { return JSON.parse(value); } catch { return fallback; }
  }

  function getStored(key, fallback) {
    try {
      if (typeof GM_getValue === "function") return GM_getValue(key, fallback);
    } catch {}
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : safeParse(raw, fallback);
    } catch { return fallback; }
  }

  function setStored(key, value) {
    try {
      if (typeof GM_setValue === "function") {
        GM_setValue(key, value);
        return;
      }
    } catch {}
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  }

  function loadSettings() {
    const stored = getStored(STORAGE_KEY, {});
    state.settings = { ...DEFAULTS, ...(stored && typeof stored === "object" ? stored : {}) };
    if (!state.settings.seen || typeof state.settings.seen !== "object") state.settings.seen = {};
    pruneSeen();
  }

  function saveSettings() {
    pruneSeen();
    setStored(STORAGE_KEY, state.settings);
  }

  function pruneSeen() {
    const cutoff = Date.now() - SEEN_TTL_MS;
    state.settings.seen = Object.fromEntries(
      Object.entries(state.settings.seen || {}).filter(([, time]) => Number(time) >= cutoff)
    );
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function visible(element) {
    if (!(element instanceof Element)) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 8 && rect.height > 8 && style.display !== "none" && style.visibility !== "hidden";
  }

  function actionNode(element) {
    return element?.closest?.("a, button, li") || element || null;
  }

  function commonParentForActions(actions) {
    const counts = new Map();
    for (const action of actions) {
      let node = action;
      for (let depth = 0; node && depth < 4; depth += 1, node = node.parentElement) {
        if (!(node instanceof HTMLElement)) continue;
        counts.set(node, (counts.get(node) || 0) + 1);
      }
    }
    return [...counts.entries()]
      .filter(([node, count]) => count >= 3 && visible(node))
      .sort((a, b) => b[1] - a[1] || a[0].getBoundingClientRect().height - b[0].getBoundingClientRect().height)
      .map(([node]) => node)[0] || null;
  }

  function scoreHeaderRow(node, rootRect) {
    if (!(node instanceof HTMLElement) || !visible(node)) return -Infinity;
    const rect = node.getBoundingClientRect();
    if (rect.height < 24 || rect.height > 85 || rect.width < 120) return -Infinity;
    if (rect.bottom < rootRect.top || rect.top > rootRect.bottom + 25) return -Infinity;

    const actions = [...node.querySelectorAll(":scope > a, :scope > button, :scope > li, :scope > div > a, :scope > div > button")]
      .filter(visible);
    if (actions.length < 3 || actions.length > 14) return -Infinity;

    const centers = actions.map((item) => {
      const itemRect = item.getBoundingClientRect();
      return { x: itemRect.left + itemRect.width / 2, y: itemRect.top + itemRect.height / 2 };
    });
    const ySpread = Math.max(...centers.map((item) => item.y)) - Math.min(...centers.map((item) => item.y));
    if (ySpread > 22) return -Infinity;

    let score = actions.length * 10;
    if (rect.left > innerWidth * 0.25) score += 20;
    if (rect.right > innerWidth * 0.7) score += 20;
    if (node.querySelector("img")) score += 25;
    if (/icon|menu|link|nav|right|action|user/i.test(node.className || "")) score += 15;
    if (node.tagName === "UL" || node.tagName === "NAV") score += 10;
    score -= Math.abs(rect.height - 44);
    return score;
  }

  function locateTornHeaderRow() {
    const root = document.querySelector("#header-root") || document.querySelector("header") || null;
    if (!root || !visible(root)) return null;
    const rootRect = root.getBoundingClientRect();

    // Best signal: Torn's small profile/avatar at the far-right side of the icon row.
    const avatarImages = [...root.querySelectorAll("img")]
      .filter((image) => {
        if (!visible(image)) return false;
        const rect = image.getBoundingClientRect();
        const hint = `${image.alt || ""} ${image.className || ""} ${image.src || ""}`.toLowerCase();
        return rect.width >= 22 && rect.width <= 68 && rect.height >= 22 && rect.height <= 68 &&
          (rect.left > innerWidth * 0.45 || /avatar|profile|user|image/i.test(hint));
      })
      .sort((a, b) => b.getBoundingClientRect().left - a.getBoundingClientRect().left);

    for (const image of avatarImages) {
      const avatarAction = actionNode(image);
      const host = avatarAction?.parentElement;
      if (!host || !visible(host)) continue;
      const directActions = [...host.children].filter(visible);
      if (directActions.length >= 3 && directActions.length <= 14) {
        return { host, before: avatarAction, mode: host.tagName === "UL" || directActions.some((item) => item.tagName === "LI") ? "list" : "plain" };
      }
    }

    // Second signal: group Torn's known top-header controls and locate their common row.
    const knownActions = [...root.querySelectorAll("a[href], button[aria-label], [role='button']")]
      .filter((element) => {
        if (!visible(element)) return false;
        const text = `${element.getAttribute("href") || ""} ${element.getAttribute("aria-label") || ""} ${element.title || ""} ${element.textContent || ""}`.toLowerCase();
        return /search|item|event|award|city|bazaar|profile|clock|job|company|travel|inventory/.test(text);
      })
      .map(actionNode)
      .filter(Boolean);

    const common = commonParentForActions(knownActions);
    if (common && scoreHeaderRow(common, rootRect) > 0) {
      const avatar = avatarImages[0] ? actionNode(avatarImages[0]) : null;
      return { host: common, before: avatar?.parentElement === common ? avatar : null, mode: common.tagName === "UL" ? "list" : "plain" };
    }

    // Final safe search: score horizontal clickable rows inside #header-root.
    const candidates = [...root.querySelectorAll("nav, ul, [class*='icon'], [class*='menu'], [class*='link'], [class*='right'], [class*='action']")];
    const best = candidates
      .map((node) => ({ node, score: scoreHeaderRow(node, rootRect) }))
      .filter((entry) => entry.score > 25)
      .sort((a, b) => b.score - a.score)[0]?.node || null;

    if (!best) return null;
    const bestAvatar = [...best.querySelectorAll("img")].filter(visible).at(-1);
    const before = bestAvatar ? actionNode(bestAvatar) : null;
    return { host: best, before: before?.parentElement === best ? before : null, mode: best.tagName === "UL" ? "list" : "plain" };
  }

  function crownMarkup() {
    return `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M13 23 21 39h22l8-16-10 7-9-17-9 17-10-7Z"/><path d="M21 44h22v7H21z"/><circle cx="13" cy="20" r="4"/><circle cx="32" cy="9" r="4"/><circle cx="51" cy="20" r="4"/></svg>`;
  }

  function buildHeaderSlot(mode) {
    const slot = document.createElement(mode === "list" ? "li" : "span");
    slot.id = "arena-commander-notifier-slot";
    slot.className = "acn-header-slot";

    const button = document.createElement("button");
    button.id = "arena-commander-notifier-button";
    button.type = "button";
    button.className = "acn-header-button acn-idle";
    button.innerHTML = `<span class="acn-icon">${crownMarkup()}</span><span class="acn-badge" hidden>0</span>`;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      state.interacted = true;
      togglePopup();
      if (!state.lastCheckedAt) refresh({ notify: false });
    });

    slot.appendChild(button);
    state.slot = slot;
    state.button = button;
    state.badge = button.querySelector(".acn-badge");
    return slot;
  }

  function ensureHeaderIcon() {
    const location = locateTornHeaderRow();
    if (!location) {
      // Never float over the Torn page. Wait until the real icon row is available.
      state.slot?.remove();
      state.slot = null;
      state.button = null;
      state.badge = null;
      closePopup();
      scheduleHeaderRetry();
      return;
    }

    if (!state.slot || state.slot.tagName !== (location.mode === "list" ? "LI" : "SPAN")) {
      state.slot?.remove();
      buildHeaderSlot(location.mode);
    }

    if (state.slot.parentElement !== location.host) {
      if (location.before && location.before.parentElement === location.host) location.host.insertBefore(state.slot, location.before);
      else location.host.appendChild(state.slot);
    } else if (location.before && state.slot.nextSibling !== location.before) {
      location.host.insertBefore(state.slot, location.before);
    }

    updateIcon();
    if (state.popupOpen) positionPopup();
    scheduleHeaderRetry();
  }

  function scheduleHeaderRetry() {
    clearTimeout(state.headerTimer);
    state.headerTimer = setTimeout(ensureHeaderIcon, document.hidden ? HEADER_RETRY_HIDDEN_MS : HEADER_RETRY_VISIBLE_MS);
  }

  function requestJson(url) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest === "function") {
        GM_xmlhttpRequest({
          method: "GET",
          url,
          timeout: REQUEST_TIMEOUT_MS,
          headers: { Accept: "application/json" },
          onload(response) {
            if (response.status < 200 || response.status >= 300) return reject(new Error(`Server returned ${response.status}.`));
            try { resolve(JSON.parse(response.responseText)); }
            catch { reject(new Error("Invalid notifier response.")); }
          },
          onerror: () => reject(new Error("Could not reach Arena Commander.")),
          ontimeout: () => reject(new Error("Arena Commander timed out."))
        });
        return;
      }
      fetch(url, { cache: "no-store", headers: { Accept: "application/json" } })
        .then((response) => {
          if (!response.ok) throw new Error(`Server returned ${response.status}.`);
          return response.json();
        })
        .then(resolve, reject);
    });
  }

  function normalizeGames(payload) {
    const games = Array.isArray(payload?.games) ? payload.games : [];
    return games.filter((game) => {
      if (!game?.roomCode || Number(game.openSeats || 0) < Number(state.settings.minimumSeats || 1)) return false;
      if (!state.settings.showBots && Number(game.bots || 0) > 0) return false;
      if (game.format === "commander" && !state.settings.commander) return false;
      if (game.format === "brawl" && !state.settings.brawl) return false;
      if (game.format === "custom" && !state.settings.custom) return false;
      return true;
    });
  }

  function formatName(game) {
    if (game.format === "brawl") return "Official Brawl";
    if (game.format === "custom") return "Custom Rule Zero";
    return "Official Commander";
  }

  function openJoin(game) {
    const url = game?.joinUrl || `${API_ROOT}/?join=${encodeURIComponent(game.roomCode)}`;
    try {
      if (typeof GM_openInTab === "function") {
        GM_openInTab(url, { active: true, insert: true, setParent: true });
        return;
      }
    } catch {}
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function playSound() {
    if (!state.settings.sound || !state.interacted) return;
    try {
      state.audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
      const context = state.audioContext;
      const start = context.currentTime;
      [520, 720].forEach((frequency, index) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0.0001, start + index * 0.12);
        gain.gain.exponentialRampToValueAtTime(0.12, start + index * 0.12 + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + index * 0.12 + 0.16);
        oscillator.connect(gain).connect(context.destination);
        oscillator.start(start + index * 0.12);
        oscillator.stop(start + index * 0.12 + 0.18);
      });
    } catch {}
  }

  function notifyGame(game) {
    const text = `${formatName(game)} — ${game.players}/${game.maxPlayers} players, ${game.openSeats} open.`;
    if (state.settings.desktop) {
      try {
        if (typeof GM_notification === "function") {
          GM_notification({
            title: "Arena Commander game ready",
            text,
            image: `${API_ROOT}/notifier-icon.svg`,
            timeout: 12_000,
            onclick: () => openJoin(game)
          });
        }
      } catch {}
    }
    playSound();
    if (state.settings.vibration) {
      try { navigator.vibrate?.([100, 60, 140]); } catch {}
    }
  }

  function notifyNewGames(games) {
    const newGames = games.filter((game) => !state.settings.seen[game.roomCode]);
    if (!newGames.length) return;
    const now = Date.now();
    newGames.forEach((game) => { state.settings.seen[game.roomCode] = now; });
    saveSettings();
    notifyGame(newGames[0]);
    state.button?.classList.add("acn-pulse");
    setTimeout(() => state.button?.classList.remove("acn-pulse"), 4_000);
  }

  function statusClass() {
    if (!state.settings.enabled) return "acn-disabled";
    if (state.loading) return "acn-checking";
    if (state.error) return "acn-error";
    if (state.games.length) return "acn-ready";
    return "acn-idle";
  }

  function updateIcon() {
    if (!state.button || !state.badge) return;
    state.button.classList.remove("acn-disabled", "acn-checking", "acn-error", "acn-ready", "acn-idle");
    state.button.classList.add(statusClass());
    const count = state.games.length;
    state.badge.textContent = count > 99 ? "99+" : String(count);
    state.badge.hidden = count === 0;
    const title = state.error
      ? `Arena Commander: ${state.error}`
      : count
        ? `${count} game${count === 1 ? "" : "s"} ready to join`
        : "Arena Commander — no games waiting";
    state.button.title = title;
    state.button.setAttribute("aria-label", title);
  }

  async function refresh({ notify = true } = {}) {
    if (state.loading || !state.settings.enabled) return;
    state.loading = true;
    state.error = "";
    updateIcon();
    try {
      const payload = await requestJson(`${OPEN_GAMES_URL}?t=${Date.now()}`);
      if (!payload?.success) throw new Error(payload?.error || "Lobby lookup failed.");
      const games = normalizeGames(payload);
      if (notify) notifyNewGames(games);
      state.games = games;
      state.lastCheckedAt = new Date();
      state.errorCount = 0;
    } catch (error) {
      state.error = error?.message || "Unable to check open games.";
      state.errorCount = Math.min(6, state.errorCount + 1);
    } finally {
      state.loading = false;
      updateIcon();
      if (state.popupOpen) renderPopup();
      schedulePoll();
    }
  }

  function schedulePoll() {
    clearTimeout(state.pollTimer);
    if (!state.settings.enabled) return;
    const base = document.hidden ? POLL_HIDDEN_MS : POLL_VISIBLE_MS;
    const delay = state.errorCount ? Math.min(POLL_ERROR_MAX_MS, base * (2 ** state.errorCount)) : base;
    state.pollTimer = setTimeout(() => refresh(), delay);
  }

  function createPopup() {
    const popup = document.createElement("section");
    popup.id = "arena-commander-notifier-popup";
    popup.className = "acn-popup";
    popup.hidden = true;
    popup.addEventListener("click", onPopupClick);
    popup.addEventListener("change", onPopupChange);
    document.body.appendChild(popup);
    state.popup = popup;
  }

  function positionPopup() {
    if (!state.popupOpen || !state.popup || !state.button) return;
    const iconRect = state.button.getBoundingClientRect();
    const width = Math.min(380, innerWidth - 16);
    state.popup.style.width = `${width}px`;
    const left = Math.max(8, Math.min(innerWidth - width - 8, iconRect.right - width));
    state.popup.style.left = `${left}px`;
    state.popup.style.right = "auto";
    state.popup.style.top = `${Math.max(8, iconRect.bottom + 8)}px`;
    requestAnimationFrame(() => {
      if (!state.popupOpen || !state.popup) return;
      const popupRect = state.popup.getBoundingClientRect();
      if (popupRect.bottom > innerHeight - 8) {
        state.popup.style.top = `${Math.max(8, iconRect.top - popupRect.height - 8)}px`;
      }
    });
  }

  function renderGame(game) {
    const formatClass = game.format === "brawl" ? "brawl" : game.format === "custom" ? "custom" : "commander";
    return `<article class="acn-game acn-${formatClass}">
      <div class="acn-game-top"><div><small>${escapeHtml(formatName(game))}</small><strong>${escapeHtml(game.title || `${formatName(game)} game`)}</strong></div><span>${Number(game.openSeats)} open</span></div>
      <p>${escapeHtml(game.notes || `${game.hostName} is hosting`)}</p>
      <div class="acn-game-stats"><span>${escapeHtml(game.hostName)}</span><span>${game.players}/${game.maxPlayers} players</span><span>${game.startingLife} life</span>${game.bots ? `<span>${game.bots} bot${game.bots === 1 ? "" : "s"}</span>` : ""}</div>
      <button type="button" class="acn-join" data-acn-action="join" data-room-code="${escapeHtml(game.roomCode)}">Join ${escapeHtml(game.roomCode)}</button>
    </article>`;
  }

  function renderPopup() {
    if (!state.popupOpen || !state.popup) return;
    const gamesHtml = state.games.length
      ? state.games.map(renderGame).join("")
      : `<div class="acn-empty"><strong>${state.error ? "Connection problem" : "No games waiting"}</strong><p>${escapeHtml(state.error || "The crown turns green when a listed game has an open seat.")}</p></div>`;

    state.popup.innerHTML = `<header class="acn-popup-header">
      <div><span class="acn-mini-icon">${crownMarkup()}</span><div><strong>Arena Commander</strong><small>Torn Notifier v${SCRIPT_VERSION}</small></div></div>
      <button type="button" data-acn-action="close" aria-label="Close">×</button>
    </header>
    <div class="acn-status-row"><span class="${statusClass()}">${state.loading ? "Checking…" : state.error ? "Offline" : state.games.length ? `${state.games.length} ready` : "Watching"}</span><small>${state.lastCheckedAt ? `Checked ${state.lastCheckedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Not checked yet"}</small><button type="button" data-acn-action="refresh">Refresh</button></div>
    <div class="acn-games">${gamesHtml}</div>
    <details class="acn-settings"><summary>Notifier settings</summary>
      <label><input type="checkbox" data-setting="enabled" ${state.settings.enabled ? "checked" : ""}> Enable checking</label>
      <label><input type="checkbox" data-setting="commander" ${state.settings.commander ? "checked" : ""}> Official Commander</label>
      <label><input type="checkbox" data-setting="brawl" ${state.settings.brawl ? "checked" : ""}> Official Brawl</label>
      <label><input type="checkbox" data-setting="custom" ${state.settings.custom ? "checked" : ""}> Custom games</label>
      <label><input type="checkbox" data-setting="showBots" ${state.settings.showBots ? "checked" : ""}> Include bot rooms</label>
      <label><input type="checkbox" data-setting="sound" ${state.settings.sound ? "checked" : ""}> Sound</label>
      <label><input type="checkbox" data-setting="vibration" ${state.settings.vibration ? "checked" : ""}> Vibration</label>
      <label><input type="checkbox" data-setting="desktop" ${state.settings.desktop ? "checked" : ""}> System notification</label>
      <label class="acn-select">Minimum open seats<select data-setting="minimumSeats"><option value="1" ${Number(state.settings.minimumSeats) === 1 ? "selected" : ""}>1</option><option value="2" ${Number(state.settings.minimumSeats) === 2 ? "selected" : ""}>2</option><option value="3" ${Number(state.settings.minimumSeats) === 3 ? "selected" : ""}>3</option></select></label>
      <div class="acn-setting-buttons"><button type="button" data-acn-action="install">Install / update page</button><button type="button" data-acn-action="reset-alerts">Reset alerts</button></div>
    </details>`;
    positionPopup();
  }

  function togglePopup(force) {
    if (!state.popup) createPopup();
    state.popupOpen = typeof force === "boolean" ? force : !state.popupOpen;
    state.popup.hidden = !state.popupOpen;
    if (state.popupOpen) {
      renderPopup();
      addEventListener("resize", positionPopup, { passive: true });
      addEventListener("scroll", positionPopup, { passive: true, capture: true });
    } else {
      removeEventListener("resize", positionPopup);
      removeEventListener("scroll", positionPopup, true);
    }
  }

  function closePopup() {
    if (state.popupOpen) togglePopup(false);
  }

  function onPopupClick(event) {
    const button = event.target.closest("[data-acn-action]");
    if (!button) return;
    const action = button.dataset.acnAction;
    if (action === "close") return togglePopup(false);
    if (action === "refresh") return refresh({ notify: false });
    if (action === "install") return window.open(INSTALL_URL, "_blank", "noopener,noreferrer");
    if (action === "reset-alerts") {
      state.settings.seen = {};
      saveSettings();
      renderPopup();
      return;
    }
    if (action === "join") {
      const game = state.games.find((entry) => entry.roomCode === button.dataset.roomCode);
      if (game) openJoin(game);
    }
  }

  function onPopupChange(event) {
    const input = event.target.closest("[data-setting]");
    if (!input) return;
    const key = input.dataset.setting;
    state.settings[key] = input.type === "checkbox" ? input.checked : Number(input.value);
    saveSettings();
    updateIcon();
    if (state.settings.enabled) refresh({ notify: false });
    else schedulePoll();
  }

  function installStyles() {
    const css = `
      #arena-commander-notifier-slot.acn-header-slot{display:inline-flex!important;align-items:center!important;justify-content:center!important;flex:0 0 auto!important;width:34px!important;height:40px!important;margin:0 2px!important;padding:0!important;list-style:none!important;position:relative!important;background:transparent!important;border:0!important;float:none!important;clear:none!important;transform:none!important}
      #arena-commander-notifier-button.acn-header-button{all:unset;box-sizing:border-box!important;width:32px!important;height:36px!important;display:flex!important;align-items:center!important;justify-content:center!important;position:relative!important;cursor:pointer!important;color:#aeb4b7!important;background:transparent!important;border:0!important;border-radius:5px!important;padding:0!important;margin:0!important;box-shadow:none!important;line-height:1!important}
      #arena-commander-notifier-button:hover{color:#e7ecee!important;background:rgba(255,255,255,.06)!important}
      #arena-commander-notifier-button .acn-icon{display:block!important;width:22px!important;height:22px!important}
      #arena-commander-notifier-button svg{display:block!important;width:100%!important;height:100%!important;fill:currentColor!important}
      #arena-commander-notifier-button.acn-idle{color:#9ba2a5!important}
      #arena-commander-notifier-button.acn-checking{color:#62b9ef!important}
      #arena-commander-notifier-button.acn-ready{color:#61e9a0!important;filter:drop-shadow(0 0 5px rgba(97,233,160,.7))}
      #arena-commander-notifier-button.acn-error{color:#ffc45f!important}
      #arena-commander-notifier-button.acn-disabled{opacity:.45!important}
      #arena-commander-notifier-button.acn-pulse{animation:acn-header-pulse .8s ease-in-out infinite}
      .acn-badge{position:absolute!important;right:-3px!important;top:1px!important;min-width:15px!important;height:15px!important;padding:0 3px!important;border-radius:10px!important;background:#e53935!important;color:#fff!important;border:1px solid #222!important;font:700 9px/13px Arial,sans-serif!important;text-align:center!important;box-sizing:border-box!important}
      .acn-popup{position:fixed!important;z-index:2147483646!important;max-height:calc(100vh - 24px)!important;overflow:auto!important;color:#eaf8f4!important;background:linear-gradient(180deg,#152321,#08110f)!important;border:1px solid rgba(91,239,187,.45)!important;border-radius:13px!important;box-shadow:0 18px 55px rgba(0,0,0,.78)!important;font:13px/1.4 Arial,sans-serif!important;text-align:left!important;overscroll-behavior:contain!important}
      .acn-popup[hidden]{display:none!important}.acn-popup *{box-sizing:border-box!important}
      .acn-popup-header{position:sticky!important;top:0!important;z-index:2!important;display:flex!important;align-items:center!important;justify-content:space-between!important;padding:11px 12px!important;background:#10201d!important;border-bottom:1px solid rgba(91,239,187,.18)!important}
      .acn-popup-header>div{display:flex!important;gap:8px!important;align-items:center!important}.acn-popup-header strong{display:block!important;font-size:15px!important}.acn-popup-header small{color:#96aaa5!important}.acn-popup-header>button{border:0!important;background:transparent!important;color:#e8f5f1!important;font-size:24px!important;cursor:pointer!important}
      .acn-mini-icon{display:block!important;width:30px!important;height:30px!important;padding:5px!important;border-radius:8px!important;background:linear-gradient(135deg,#55e7a7,#57b7ff)!important;color:#06130f!important}.acn-mini-icon svg{width:100%!important;height:100%!important;fill:currentColor!important}
      .acn-status-row{display:grid!important;grid-template-columns:auto 1fr auto!important;align-items:center!important;gap:7px!important;padding:9px 11px!important;color:#9eb5af!important;border-bottom:1px solid rgba(255,255,255,.07)!important}.acn-status-row>span{font-weight:700!important}.acn-status-row>.acn-ready{color:#5ff3a9!important}.acn-status-row>.acn-error{color:#ffca5a!important}.acn-status-row>button{border:0!important;border-radius:7px!important;background:#1e3a35!important;color:#d7fff2!important;padding:6px 8px!important;cursor:pointer!important}
      .acn-games{padding:10px!important;display:grid!important;gap:9px!important}.acn-game{border:1px solid rgba(255,255,255,.12)!important;border-left:3px solid #67e8b6!important;border-radius:11px!important;padding:10px!important;background:rgba(255,255,255,.035)!important}.acn-game.acn-brawl{border-left-color:#61bfff!important}.acn-game.acn-custom{border-left-color:#c98cff!important}.acn-game-top{display:flex!important;justify-content:space-between!important;gap:8px!important}.acn-game-top small{color:#8fa8a2!important;display:block!important}.acn-game-top strong{font-size:14px!important}.acn-game-top>span{white-space:nowrap!important;color:#5ff3a9!important;font-weight:700!important}.acn-game p{margin:6px 0!important;color:#b8cbc6!important}.acn-game-stats{display:flex!important;gap:5px!important;flex-wrap:wrap!important}.acn-game-stats span{padding:3px 6px!important;border-radius:999px!important;background:#172c28!important;color:#bfe0d7!important;font-size:11px!important}.acn-join{width:100%!important;margin-top:9px!important;padding:9px!important;border:1px solid #5ff3a9!important;border-radius:8px!important;background:#176247!important;color:#fff!important;font-weight:800!important;cursor:pointer!important}
      .acn-empty{padding:28px 17px!important;text-align:center!important;color:#a9beb8!important}.acn-empty strong{display:block!important;color:#e4f4ef!important;font-size:15px!important}.acn-settings{border-top:1px solid rgba(255,255,255,.08)!important;padding:10px 12px 13px!important}.acn-settings summary{cursor:pointer!important;font-weight:700!important;color:#d5e8e2!important}.acn-settings label{display:flex!important;align-items:center!important;gap:8px!important;padding:5px 0!important;color:#bad0ca!important}.acn-settings input{width:auto!important}.acn-select{justify-content:space-between!important}.acn-select select{background:#132a25!important;color:#e4f6f1!important;border:1px solid #315148!important;border-radius:6px!important;padding:4px!important}.acn-setting-buttons{display:flex!important;gap:7px!important;margin-top:8px!important}.acn-setting-buttons button{flex:1!important;border:1px solid #315148!important;border-radius:7px!important;background:#172d28!important;color:#d5eee7!important;padding:7px!important;cursor:pointer!important}
      @keyframes acn-header-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.16)}}
      @media(max-width:520px){#arena-commander-notifier-slot.acn-header-slot{width:31px!important;margin:0!important}#arena-commander-notifier-button.acn-header-button{width:30px!important}.acn-popup{font-size:12px!important}}
    `;
    try {
      if (typeof GM_addStyle === "function") GM_addStyle(css);
      else {
        const style = document.createElement("style");
        style.textContent = css;
        document.head.appendChild(style);
      }
    } catch {}
  }

  function registerMenu() {
    try {
      if (typeof GM_registerMenuCommand !== "function") return;
      GM_registerMenuCommand("Arena Commander: refresh games", () => refresh({ notify: false }));
      GM_registerMenuCommand("Arena Commander: install/update page", () => window.open(INSTALL_URL, "_blank", "noopener,noreferrer"));
      GM_registerMenuCommand("Arena Commander: reset notified rooms", () => {
        state.settings.seen = {};
        saveSettings();
      });
    } catch {}
  }

  function start() {
    loadSettings();
    installStyles();
    registerMenu();
    ensureHeaderIcon();
    if (state.settings.enabled) refresh({ notify: false });

    document.addEventListener("visibilitychange", () => {
      scheduleHeaderRetry();
      schedulePoll();
      if (!document.hidden) ensureHeaderIcon();
    });

    // Torn uses client-side navigation. A very small interval is safer than observing the whole page.
    addEventListener("hashchange", () => setTimeout(ensureHeaderIcon, 250));
    addEventListener("popstate", () => setTimeout(ensureHeaderIcon, 250));
  }

  start();
})();
