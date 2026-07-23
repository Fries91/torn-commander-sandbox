// ==UserScript==
// @name         Arena Commander - Torn Game Notifier
// @namespace    https://torn-commander-sandbox.onrender.com/
// @version      1.1.0
// @description  Adds a small Arena Commander icon to Torn and alerts you when a listed game has an open seat.
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

  const SCRIPT_VERSION = "1.1.0";
  const API_ROOT = "https://torn-commander-sandbox.onrender.com";
  const OPEN_GAMES_URL = `${API_ROOT}/api/lobbies/open`;
  const VERSION_URL = `${API_ROOT}/api/notifier/version`;
  const INSTALL_URL = `${API_ROOT}/notifier-install.html`;
  const SCRIPT_URL = `${API_ROOT}/arena-commander-notifier.user.js`;
  const APP_URL = API_ROOT;
  const STORAGE_KEY = "arenaCommanderTornNotifier.v1";
  const SEEN_TTL_MS = 24 * 60 * 60 * 1000;
  const POLL_VISIBLE_MS = 45 * 1000;
  const POLL_HIDDEN_MS = 3 * 60 * 1000;
  const POLL_ERROR_MAX_MS = 5 * 60 * 1000;
  const ICON_GUARD_VISIBLE_MS = 5 * 1000;
  const ICON_GUARD_HIDDEN_MS = 20 * 1000;
  const VERSION_CHECK_MS = 6 * 60 * 60 * 1000;

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
    compact: false,
    seen: {},
    lastVersionCheck: 0,
    updateAvailable: false
  });

  const state = {
    settings: { ...DEFAULTS },
    games: [],
    loading: false,
    lastCheckedAt: null,
    error: "",
    pollTimer: null,
    ensureTimer: null,
    errorCount: 0,
    iconButton: null,
    badge: null,
    popup: null,
    open: false,
    interacted: false,
    audioContext: null
  };

  function safeParse(value, fallback) {
    try { return JSON.parse(value); } catch { return fallback; }
  }

  function gmGet(key, fallback) {
    try {
      if (typeof GM_getValue === "function") return GM_getValue(key, fallback);
    } catch {}
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : safeParse(raw, fallback);
    } catch { return fallback; }
  }

  function gmSet(key, value) {
    try {
      if (typeof GM_setValue === "function") return GM_setValue(key, value);
    } catch {}
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
    return undefined;
  }

  function loadSettings() {
    const stored = gmGet(STORAGE_KEY, {});
    state.settings = { ...DEFAULTS, ...(stored && typeof stored === "object" ? stored : {}) };
    if (!state.settings.seen || typeof state.settings.seen !== "object") state.settings.seen = {};
    pruneSeen();
  }

  function saveSettings() {
    pruneSeen();
    gmSet(STORAGE_KEY, state.settings);
  }

  function pruneSeen() {
    const cutoff = Date.now() - SEEN_TTL_MS;
    const output = {};
    for (const [code, time] of Object.entries(state.settings.seen || {})) {
      if (Number(time) >= cutoff) output[code] = Number(time);
    }
    state.settings.seen = output;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function normalizeGames(payload) {
    const games = Array.isArray(payload?.games) ? payload.games : [];
    return games.filter((game) => {
      if (!game || !game.roomCode || Number(game.openSeats || 0) < Number(state.settings.minimumSeats || 1)) return false;
      if (!state.settings.showBots && Number(game.bots || 0) > 0) return false;
      if (game.format === "commander" && !state.settings.commander) return false;
      if (game.format === "brawl" && !state.settings.brawl) return false;
      if (game.format === "custom" && !state.settings.custom) return false;
      return true;
    });
  }

  function requestJson(url) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest === "function") {
        GM_xmlhttpRequest({
          method: "GET",
          url,
          timeout: 15000,
          headers: { Accept: "application/json" },
          onload(response) {
            if (response.status < 200 || response.status >= 300) return reject(new Error(`Server returned ${response.status}.`));
            try { resolve(JSON.parse(response.responseText)); }
            catch { reject(new Error("The notifier server returned invalid data.")); }
          },
          onerror: () => reject(new Error("Could not reach Arena Commander.")),
          ontimeout: () => reject(new Error("Arena Commander took too long to respond."))
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

  function formatName(game) {
    if (game.format === "brawl") return "Official Brawl";
    if (game.format === "custom") return "Custom Rule Zero";
    return "Official Commander";
  }

  function playSound() {
    if (!state.settings.sound || !state.interacted) return;
    try {
      state.audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
      const ctx = state.audioContext;
      const now = ctx.currentTime;
      [520, 720].forEach((frequency, index) => {
        const oscillator = ctx.createOscillator();
        const gain = ctx.createGain();
        oscillator.type = "sine";
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0.0001, now + index * 0.12);
        gain.gain.exponentialRampToValueAtTime(0.14, now + index * 0.12 + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + index * 0.12 + 0.16);
        oscillator.connect(gain).connect(ctx.destination);
        oscillator.start(now + index * 0.12);
        oscillator.stop(now + index * 0.12 + 0.18);
      });
    } catch {}
  }

  function vibrate() {
    if (!state.settings.vibration) return;
    try { navigator.vibrate?.([100, 60, 140]); } catch {}
  }

  function openJoin(game) {
    const url = game?.joinUrl || `${APP_URL}/?join=${encodeURIComponent(game.roomCode)}`;
    try {
      if (typeof GM_openInTab === "function") {
        GM_openInTab(url, { active: true, insert: true, setParent: true });
        return;
      }
    } catch {}
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function showSystemNotification(game) {
    if (!state.settings.desktop) return;
    const title = "Arena Commander game ready";
    const text = `${formatName(game)} — ${game.players}/${game.maxPlayers} players, ${game.openSeats} open seat${game.openSeats === 1 ? "" : "s"}.`;
    try {
      if (typeof GM_notification === "function") {
        GM_notification({
          title,
          text,
          image: `${API_ROOT}/notifier-icon.svg`,
          timeout: 12000,
          onclick: () => openJoin(game)
        });
        return;
      }
    } catch {}
    try {
      if (Notification.permission === "granted") {
        const notification = new Notification(title, { body: text, icon: `${API_ROOT}/notifier-icon.svg`, tag: `arena-${game.roomCode}` });
        notification.onclick = () => openJoin(game);
      }
    } catch {}
  }

  function notifyNewGames(games) {
    const now = Date.now();
    const newGames = games.filter((game) => !state.settings.seen[game.roomCode]);
    if (!newGames.length) return;
    for (const game of newGames) state.settings.seen[game.roomCode] = now;
    saveSettings();
    playSound();
    vibrate();
    showSystemNotification(newGames[0]);
    state.iconButton?.classList.add("acn-pulse");
    setTimeout(() => state.iconButton?.classList.remove("acn-pulse"), 5000);
  }

  async function checkVersion(force = false) {
    if (!force && Date.now() - Number(state.settings.lastVersionCheck || 0) < VERSION_CHECK_MS) return;
    state.settings.lastVersionCheck = Date.now();
    try {
      const payload = await requestJson(`${VERSION_URL}?t=${Date.now()}`);
      state.settings.updateAvailable = Boolean(payload?.scriptVersion && compareVersions(payload.scriptVersion, SCRIPT_VERSION) > 0);
    } catch {}
    saveSettings();
  }

  function compareVersions(a, b) {
    const pa = String(a).split(".").map((part) => Number(part) || 0);
    const pb = String(b).split(".").map((part) => Number(part) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
      if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0) ? 1 : -1;
    }
    return 0;
  }

  async function refresh({ notify = true } = {}) {
    if (state.loading || !state.settings.enabled) return;
    state.loading = true;
    state.error = "";
    updateIcon();
    if (state.open) renderPopup();
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
      if (state.open) renderPopup();
      schedulePoll();
    }
    checkVersion(false).then(renderPopup);
  }

  function schedulePoll() {
    clearTimeout(state.pollTimer);
    if (!state.settings.enabled) return;
    const normalDelay = document.hidden ? POLL_HIDDEN_MS : POLL_VISIBLE_MS;
    const errorDelay = state.errorCount ? Math.min(POLL_ERROR_MAX_MS, normalDelay * (2 ** state.errorCount)) : normalDelay;
    state.pollTimer = setTimeout(() => refresh(), errorDelay);
  }

  function statusClass() {
    if (!state.settings.enabled) return "acn-disabled";
    if (state.loading) return "acn-checking";
    if (state.error) return "acn-error";
    if (state.games.length) return "acn-ready";
    return "acn-idle";
  }

  function updateIcon() {
    if (!state.iconButton) return;
    state.iconButton.classList.remove("acn-disabled", "acn-checking", "acn-error", "acn-ready", "acn-idle");
    state.iconButton.classList.add(statusClass());
    const count = state.games.length;
    state.badge.textContent = count > 99 ? "99+" : String(count);
    state.badge.hidden = count === 0;
    state.iconButton.title = state.error ? `Arena Commander: ${state.error}` : count ? `${count} game${count === 1 ? "" : "s"} ready to join` : "Arena Commander — no games waiting";
    state.iconButton.setAttribute("aria-label", state.iconButton.title);
  }

  function iconMarkup() {
    return `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M13 23 21 39h22l8-16-10 7-9-17-9 17-10-7Z"/><path d="M21 44h22v7H21z"/><circle cx="13" cy="20" r="4"/><circle cx="32" cy="9" r="4"/><circle cx="51" cy="20" r="4"/></svg>`;
  }

  function findHeaderHost() {
    const selectors = [
      "#header-root [class*='header'] [class*='right']",
      "#header-root [class*='header'] [class*='icons']",
      "#header-root header nav",
      "#header-root header",
      "header [class*='right']",
      "header nav",
      "#header-root"
    ];
    for (const selector of selectors) {
      const node = document.querySelector(selector);
      if (node && node.clientWidth > 80) return node;
    }
    return null;
  }

  function injectIcon() {
    let button = document.getElementById("arena-commander-notifier-button");
    if (!button) {
      button = document.createElement("button");
      button.id = "arena-commander-notifier-button";
      button.className = "acn-header-button acn-idle";
      button.type = "button";
      button.innerHTML = `<span class="acn-icon">${iconMarkup()}</span><span class="acn-badge" hidden>0</span>`;
      button.addEventListener("click", () => {
        state.interacted = true;
        togglePopup();
        if (!state.lastCheckedAt) refresh({ notify: false });
      });
    }
    const host = findHeaderHost();
    if (host && button.parentElement !== host) {
      button.classList.remove("acn-floating");
      button.classList.add("acn-in-header");
      host.appendChild(button);
    } else if (!host && !button.isConnected) {
      button.classList.remove("acn-in-header");
      button.classList.add("acn-floating");
      document.body.appendChild(button);
    } else if (!host && button.isConnected && !button.classList.contains("acn-floating")) {
      button.classList.remove("acn-in-header");
      button.classList.add("acn-floating");
      document.body.appendChild(button);
    }
    state.iconButton = button;
    state.badge = button.querySelector(".acn-badge");
    updateIcon();
  }

  function popupShell() {
    const popup = document.createElement("section");
    popup.id = "arena-commander-notifier-popup";
    popup.className = "acn-popup";
    popup.hidden = true;
    popup.addEventListener("click", handlePopupClick);
    popup.addEventListener("change", handlePopupChange);
    document.body.appendChild(popup);
    state.popup = popup;
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
    if (!state.popup || !state.open) return;
    const gamesHtml = state.games.length
      ? state.games.map(renderGame).join("")
      : `<div class="acn-empty"><strong>${state.error ? "Connection problem" : "No games waiting right now"}</strong><p>${escapeHtml(state.error || "The crown will glow green when somebody lists a room with an open seat.")}</p></div>`;
    state.popup.innerHTML = `<header class="acn-popup-header">
      <div><span class="acn-mini-icon">${iconMarkup()}</span><div><strong>Arena Commander</strong><small>Torn Game Notifier v${SCRIPT_VERSION}</small></div></div>
      <button type="button" data-acn-action="close" aria-label="Close">×</button>
    </header>
    ${state.settings.updateAvailable ? `<button type="button" class="acn-update" data-acn-action="update">Notifier update available — install now</button>` : ""}
    <div class="acn-status-row"><span class="${statusClass()}">${state.loading ? "Checking…" : state.error ? "Offline" : state.games.length ? `${state.games.length} ready` : "Watching"}</span><small>${state.lastCheckedAt ? `Checked ${state.lastCheckedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Not checked yet"}</small><button type="button" data-acn-action="refresh">Refresh</button></div>
    <div class="acn-games">${gamesHtml}</div>
    <details class="acn-settings">
      <summary>Notifier settings</summary>
      <label><input type="checkbox" data-setting="enabled" ${state.settings.enabled ? "checked" : ""}> Enable checking</label>
      <label><input type="checkbox" data-setting="commander" ${state.settings.commander ? "checked" : ""}> Official Commander</label>
      <label><input type="checkbox" data-setting="brawl" ${state.settings.brawl ? "checked" : ""}> Official Brawl</label>
      <label><input type="checkbox" data-setting="custom" ${state.settings.custom ? "checked" : ""}> Custom games</label>
      <label><input type="checkbox" data-setting="showBots" ${state.settings.showBots ? "checked" : ""}> Include rooms with bots</label>
      <label><input type="checkbox" data-setting="sound" ${state.settings.sound ? "checked" : ""}> Sound</label>
      <label><input type="checkbox" data-setting="vibration" ${state.settings.vibration ? "checked" : ""}> Vibration</label>
      <label><input type="checkbox" data-setting="desktop" ${state.settings.desktop ? "checked" : ""}> System notification</label>
      <label class="acn-select">Minimum open seats<select data-setting="minimumSeats"><option value="1" ${Number(state.settings.minimumSeats) === 1 ? "selected" : ""}>1</option><option value="2" ${Number(state.settings.minimumSeats) === 2 ? "selected" : ""}>2</option><option value="3" ${Number(state.settings.minimumSeats) === 3 ? "selected" : ""}>3</option></select></label>
      <div class="acn-setting-buttons"><button type="button" data-acn-action="install">Install / update page</button><button type="button" data-acn-action="mark-unseen">Reset alerts</button></div>
    </details>`;
  }

  function togglePopup(force) {
    if (!state.popup) popupShell();
    state.open = typeof force === "boolean" ? force : !state.open;
    state.popup.hidden = !state.open;
    if (state.open) renderPopup();
  }

  function handlePopupClick(event) {
    const button = event.target.closest("[data-acn-action]");
    if (!button) return;
    const action = button.dataset.acnAction;
    if (action === "close") return togglePopup(false);
    if (action === "refresh") return refresh({ notify: false });
    if (action === "install") return window.open(INSTALL_URL, "_blank", "noopener,noreferrer");
    if (action === "update") return window.open(SCRIPT_URL, "_blank", "noopener,noreferrer");
    if (action === "mark-unseen") {
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

  function handlePopupChange(event) {
    const input = event.target.closest("[data-setting]");
    if (!input) return;
    const key = input.dataset.setting;
    state.settings[key] = input.type === "checkbox" ? input.checked : Number(input.value);
    saveSettings();
    if (key === "enabled") state.settings.enabled ? refresh({ notify: false }) : schedulePoll();
    else refresh({ notify: false });
    updateIcon();
  }

  function addStyles(css) {
    try {
      if (typeof GM_addStyle === "function") return GM_addStyle(css);
    } catch {}
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
    return style;
  }

  function installStyles() {
    addStyles(`
      #arena-commander-notifier-button{box-sizing:border-box;border:1px solid rgba(103,232,193,.32);background:#10211f;color:#bfffea;width:38px;height:38px;border-radius:10px;display:inline-flex;align-items:center;justify-content:center;position:relative;cursor:pointer;z-index:100001;padding:0;box-shadow:0 6px 18px rgba(0,0,0,.34);transition:.18s ease;font:inherit}
      #arena-commander-notifier-button.acn-in-header{margin-left:7px;vertical-align:middle;flex:0 0 38px}
      #arena-commander-notifier-button.acn-floating{position:fixed;right:12px;top:76px}
      #arena-commander-notifier-button:hover{transform:translateY(-1px);border-color:#5ef1bd}
      #arena-commander-notifier-button .acn-icon{width:23px;height:23px;display:block}
      #arena-commander-notifier-button svg{width:100%;height:100%;fill:currentColor}
      #arena-commander-notifier-button.acn-idle{color:#92a9a3}
      #arena-commander-notifier-button.acn-checking{color:#66bfff;animation:acn-spin-pulse 1.2s ease-in-out infinite}
      #arena-commander-notifier-button.acn-ready{color:#5ff3a9;border-color:#5ff3a9;box-shadow:0 0 0 3px rgba(95,243,169,.12),0 0 22px rgba(95,243,169,.38)}
      #arena-commander-notifier-button.acn-error{color:#ffca5a;border-color:#ffca5a}
      #arena-commander-notifier-button.acn-disabled{opacity:.5}
      #arena-commander-notifier-button.acn-pulse{animation:acn-ready-pulse .85s ease-in-out infinite}
      .acn-badge{position:absolute;right:-6px;top:-7px;min-width:18px;height:18px;padding:0 4px;border-radius:999px;background:#ef4444;color:white;border:2px solid #0b1514;font:bold 10px/14px Arial,sans-serif;text-align:center;box-sizing:border-box}
      .acn-popup{position:fixed;right:12px;top:72px;width:min(380px,calc(100vw - 24px));max-height:min(690px,calc(100vh - 90px));overflow:auto;z-index:1000000;color:#eaf8f4;background:linear-gradient(180deg,#122321,#081210);border:1px solid rgba(91,239,187,.45);border-radius:16px;box-shadow:0 24px 70px rgba(0,0,0,.72);font:13px/1.4 Arial,sans-serif;text-align:left}
      .acn-popup[hidden]{display:none!important}
      .acn-popup *{box-sizing:border-box}
      .acn-popup-header{position:sticky;top:0;z-index:2;display:flex;align-items:center;justify-content:space-between;padding:12px 13px;background:rgba(12,28,25,.98);border-bottom:1px solid rgba(91,239,187,.2)}
      .acn-popup-header>div{display:flex;gap:9px;align-items:center}.acn-popup-header strong{font-size:15px;display:block}.acn-popup-header small{color:#92aaa4}.acn-popup-header>button{border:0;background:transparent;color:#d9eee8;font-size:25px;cursor:pointer}
      .acn-mini-icon{display:block;width:31px;height:31px;padding:5px;border-radius:9px;background:linear-gradient(135deg,#55e7a7,#57b7ff);color:#06130f}.acn-mini-icon svg{width:100%;height:100%;fill:currentColor}
      .acn-update{display:block;width:calc(100% - 22px);margin:10px 11px 0;padding:9px;border:1px solid #ffc857;border-radius:9px;background:rgba(255,200,87,.12);color:#ffe09a;font-weight:700;cursor:pointer}
      .acn-status-row{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:8px;padding:10px 12px;color:#9eb5af;border-bottom:1px solid rgba(255,255,255,.07)}.acn-status-row>span{font-weight:700;color:#a8bbb6}.acn-status-row>.acn-ready{color:#5ff3a9}.acn-status-row>.acn-error{color:#ffca5a}.acn-status-row>button{border:0;border-radius:7px;background:#1e3a35;color:#cffff0;padding:6px 8px;cursor:pointer}
      .acn-games{padding:10px;display:grid;gap:9px}.acn-game{border:1px solid rgba(255,255,255,.12);border-left:3px solid #67e8b6;border-radius:12px;padding:10px;background:rgba(255,255,255,.035)}.acn-game.acn-brawl{border-left-color:#61bfff}.acn-game.acn-custom{border-left-color:#c98cff}.acn-game-top{display:flex;justify-content:space-between;gap:8px}.acn-game-top small{color:#8fa8a2;display:block}.acn-game-top strong{font-size:14px}.acn-game-top>span{white-space:nowrap;color:#5ff3a9;font-weight:700}.acn-game p{margin:6px 0;color:#b8cbc6}.acn-game-stats{display:flex;gap:5px;flex-wrap:wrap}.acn-game-stats span{padding:3px 6px;border-radius:999px;background:#172c28;color:#bfe0d7;font-size:11px}.acn-join{width:100%;margin-top:9px;padding:9px;border:1px solid #5ff3a9;border-radius:9px;background:linear-gradient(135deg,#1d7656,#13533e);color:white;font-weight:800;cursor:pointer}
      .acn-empty{padding:30px 18px;text-align:center;color:#a9bcb7}.acn-empty strong{display:block;color:#e8f6f2;font-size:15px}.acn-empty p{margin:7px 0 0}
      .acn-settings{margin:0 10px 12px;border:1px solid rgba(255,255,255,.1);border-radius:11px;padding:8px 10px;background:#091614}.acn-settings summary{cursor:pointer;font-weight:700;color:#cfe5df}.acn-settings[open] summary{margin-bottom:8px}.acn-settings label{display:flex;align-items:center;gap:8px;padding:5px 0;color:#b8cec8}.acn-settings input{accent-color:#55e7a7}.acn-settings .acn-select{justify-content:space-between}.acn-settings select{background:#132722;color:#dff7ef;border:1px solid #31554c;border-radius:7px;padding:5px}.acn-setting-buttons{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:7px}.acn-setting-buttons button{padding:7px;border:1px solid #31554c;border-radius:7px;background:#142722;color:#cbe9e0;cursor:pointer}
      @keyframes acn-ready-pulse{50%{transform:scale(1.08);box-shadow:0 0 0 7px rgba(95,243,169,.08),0 0 30px rgba(95,243,169,.48)}}
      @keyframes acn-spin-pulse{50%{opacity:.45}}
      @media(max-width:650px){.acn-popup{top:62px;right:8px;width:calc(100vw - 16px);max-height:calc(100vh - 74px)}#arena-commander-notifier-button.acn-floating{top:68px;right:8px}}
    `);
  }

  function runIconGuard() {
    clearTimeout(state.ensureTimer);
    const work = () => {
      injectIcon();
      state.ensureTimer = setTimeout(runIconGuard, document.hidden ? ICON_GUARD_HIDDEN_MS : ICON_GUARD_VISIBLE_MS);
    };
    if (typeof requestIdleCallback === "function") requestIdleCallback(work, { timeout: 900 });
    else setTimeout(work, 80);
  }

  function registerMenus() {
    try {
      if (typeof GM_registerMenuCommand !== "function") return;
      GM_registerMenuCommand("Arena Commander: Check for games", () => refresh({ notify: false }));
      GM_registerMenuCommand("Arena Commander: Open notifier", () => togglePopup(true));
      GM_registerMenuCommand("Arena Commander: Install/update page", () => window.open(INSTALL_URL, "_blank", "noopener,noreferrer"));
    } catch {}
  }

  function initialize() {
    loadSettings();
    installStyles();
    injectIcon();
    popupShell();
    runIconGuard();
    registerMenus();
    document.addEventListener("visibilitychange", () => { schedulePoll(); runIconGuard(); });
    document.addEventListener("click", (event) => {
      state.interacted = true;
      if (state.open && !event.target.closest("#arena-commander-notifier-popup") && !event.target.closest("#arena-commander-notifier-button")) togglePopup(false);
    }, true);
    window.addEventListener("pagehide", () => {
      clearTimeout(state.pollTimer);
      clearTimeout(state.ensureTimer);
    }, { once: true });
    refresh({ notify: false });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize, { once: true });
  else initialize();
})();
