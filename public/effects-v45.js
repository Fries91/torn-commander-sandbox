(() => {
  "use strict";

  const VERSION = "45.0.0";
  const SESSION_KEY = "tornCommander.session.v5";
  let pollTimer = null;
  let activeChoiceId = "";
  let snapshot = null;

  function session() {
    try {
      const value = JSON.parse(localStorage.getItem(SESSION_KEY));
      return value?.roomCode && value?.playerId && value?.sessionToken ? value : null;
    } catch { return null; }
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  async function api(path, body = {}) {
    const auth = session();
    if (!auth) throw new Error("No saved room session.");
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      cache: "no-store",
      body: JSON.stringify({ ...auth, ...body })
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.success) throw new Error(payload?.error || `HTTP ${response.status}`);
    return payload;
  }

  function toast(message, type = "info") {
    const region = document.getElementById("toastRegion");
    if (!region) return;
    const item = document.createElement("div");
    item.className = `toast ${type}`;
    item.textContent = message;
    region.appendChild(item);
    setTimeout(() => item.remove(), 4200);
  }

  function closePrompt() {
    document.getElementById("v45ReplacementOverlay")?.remove();
    activeChoiceId = "";
  }

  function renderPrompt(choice) {
    if (!choice || choice.id === activeChoiceId) return;
    closePrompt();
    activeChoiceId = choice.id;
    const overlay = document.createElement("div");
    overlay.id = "v45ReplacementOverlay";
    overlay.className = "v45-replacement-overlay";
    overlay.dataset.choiceId = choice.id;
    overlay.innerHTML = `
      <section>
        <small>REPLACEMENT EFFECT</small>
        <h2>${escapeHtml(choice.sourceName)}</h2>
        <p>Pay ${choice.lifeCost} life so it enters untapped?</p>
        <div>
          <button type="button" data-v45-tapped>Do not pay — enters tapped</button>
          <button type="button" class="v45-pay-life" data-v45-pay>Pay ${choice.lifeCost} life</button>
        </div>
      </section>
    `;
    document.body.appendChild(overlay);
  }

  async function resolve(payLife) {
    const overlay = document.getElementById("v45ReplacementOverlay");
    if (!overlay) return;
    overlay.querySelectorAll("button").forEach((button) => { button.disabled = true; });
    try {
      await api("/api/effects/resolve", {
        choiceId: overlay.dataset.choiceId,
        payLife
      });
      closePrompt();
      toast(payLife ? "Life paid; permanent entered untapped." : "Permanent entered tapped.", "success");
    } catch (error) {
      overlay.querySelectorAll("button").forEach((button) => { button.disabled = false; });
      toast(error.message || "Unable to resolve replacement effect.", "error");
    }
  }

  function installEffectsButton() {
    const actions = document.querySelector(".arena-game-topbar .arena-top-actions");
    if (!actions || document.getElementById("v45EffectsButton")) return;
    const button = document.createElement("button");
    button.type = "button";
    button.id = "v45EffectsButton";
    button.className = "arena-hotfix-control v45-effects-button";
    button.innerHTML = "<span>✦</span><small>Effects</small>";
    actions.appendChild(button);
  }

  function applyHighlights() {
    document.querySelectorAll(".arena-card.v45-continuous-effect")
      .forEach((card) => card.classList.remove("v45-continuous-effect"));
    for (const entry of snapshot?.affectedCards || []) {
      if (!entry.effects?.length) continue;
      document.querySelector(
        `.arena-card[data-card-id="${CSS.escape(String(entry.cardId))}"]`
      )?.classList.add("v45-continuous-effect");
    }
  }

  function showEffects() {
    if (!snapshot) return toast("Effects are still loading.", "info");
    document.getElementById("v45EffectsSheet")?.remove();
    const overlay = document.createElement("div");
    overlay.id = "v45EffectsSheet";
    overlay.className = "v45-effects-sheet";
    overlay.innerHTML = `
      <section>
        <header><div><small>CONTINUOUS EFFECTS</small><h2>Active battlefield modifiers</h2></div><button type="button" data-v45-close>×</button></header>
        <div class="v45-effect-list">
          ${(snapshot.effects || []).map((effect) => `
            <article>
              <strong>${escapeHtml(effect.sourceName)}</strong>
              <p>${escapeHtml(effect.text)}</p>
              <small>${escapeHtml(effect.kind === "stats" ? `${effect.power >= 0 ? "+" : ""}${effect.power}/${effect.toughness >= 0 ? "+" : ""}${effect.toughness}` : effect.keyword)}</small>
            </article>
          `).join("") || "<p>No parsed continuous effects are active.</p>"}
        </div>
      </section>
    `;
    document.body.appendChild(overlay);
  }

  async function poll() {
    clearTimeout(pollTimer);
    try {
      const [pending, nextSnapshot] = await Promise.all([
        api("/api/effects/pending"),
        api("/api/effects/snapshot")
      ]);
      if (pending.choices?.[0]) renderPrompt(pending.choices[0]);
      else closePrompt();
      snapshot = nextSnapshot;
      applyHighlights();
      installEffectsButton();
    } catch {}
    pollTimer = setTimeout(poll, document.hidden ? 4000 : 1300);
  }

  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-v45-pay]")) { event.preventDefault(); resolve(true); }
    if (event.target.closest("[data-v45-tapped]")) { event.preventDefault(); resolve(false); }
    if (event.target.closest("#v45EffectsButton")) { event.preventDefault(); showEffects(); }
    if (event.target.closest("[data-v45-close]")) {
      event.preventDefault();
      document.getElementById("v45EffectsSheet")?.remove();
    }
  });

  const observer = new MutationObserver(() => {
    installEffectsButton();
    applyHighlights();
  });
  const app = document.getElementById("app");
  if (app) observer.observe(app, { childList: true, subtree: true });

  document.addEventListener("visibilitychange", poll);
  window.addEventListener("load", poll, { once: true });
  poll();

  window.ArenaCommanderEffectsV45 = { version: VERSION, refresh: poll };
})();
