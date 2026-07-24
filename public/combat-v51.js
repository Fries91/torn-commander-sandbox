(() => {
  "use strict";

  const VERSION = "51.0.0";
  const SESSION_KEY = "tornCommander.session.v5";
  let state = null;
  let pollTimer = null;
  let activeChoiceId = "";

  function session() {
    try {
      const value = JSON.parse(localStorage.getItem(SESSION_KEY));
      return value?.roomCode && value?.playerId && value?.sessionToken
        ? value
        : null;
    } catch {
      return null;
    }
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function cardName(card) {
    return String(card?.cardData?.name || card?.name || "Card").trim();
  }

  function cardImage(card) {
    return (
      card?.cardData?.imageUrl ||
      card?.imageUrl ||
      card?.cardData?.faces?.[0]?.imageUrl ||
      ""
    );
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
    if (!response.ok || !payload?.success) {
      throw new Error(payload?.error || `HTTP ${response.status}`);
    }
    return payload;
  }

  function toast(message, type = "info") {
    const region = document.getElementById("toastRegion");
    if (!region) return;
    const item = document.createElement("div");
    item.className = `toast ${type}`;
    item.textContent = message;
    region.appendChild(item);
    setTimeout(() => item.remove(), 4300);
  }

  function installButton() {
    const actions = document.querySelector(
      ".arena-game-topbar .arena-top-actions"
    );
    if (!actions || document.getElementById("v51CombatButton")) return;
    const button = document.createElement("button");
    button.type = "button";
    button.id = "v51CombatButton";
    button.className = "arena-hotfix-control v51-combat-button";
    button.innerHTML = '<span>⚔</span><small>Combat+</small><b data-v51-phase>—</b>';
    actions.appendChild(button);
  }

  function attackerCard(entry) {
    const card = entry.card;
    return `
      <article class="v51-attacker" data-attacker-id="${escapeHtml(card.id)}">
        ${cardImage(card) ? `<img src="${escapeHtml(cardImage(card))}" alt="">` : '<div class="v51-card-back">⚔</div>'}
        <div>
          <strong>${escapeHtml(cardName(card))}</strong>
          <small>Defending: ${escapeHtml(entry.defenderId || "Unknown")}</small>
          <span>${[
            entry.firstStrike ? "First strike" : "",
            entry.doubleStrike ? "Double strike" : "",
            entry.trample ? "Trample" : "",
            entry.deathtouch ? "Deathtouch" : "",
            entry.menace ? "Menace" : ""
          ].filter(Boolean).join(" · ") || "Normal combat"}</span>
        </div>
        <div class="v51-blocker-order">
          ${(entry.blockers || []).map((blocker, index) => `
            <div data-blocker-id="${escapeHtml(blocker.id)}">
              <span>${index + 1}. ${escapeHtml(cardName(blocker))}</span>
              <button type="button" data-v51-up>↑</button>
              <button type="button" data-v51-down>↓</button>
            </div>
          `).join("") || '<small>Unblocked</small>'}
          ${(entry.blockers || []).length > 1 ? '<button type="button" data-v51-save-order>Save blocker order</button>' : ""}
        </div>
      </article>
    `;
  }

  function ninjaOption(entry) {
    return `<option value="${escapeHtml(entry.card.id)}">${escapeHtml(cardName(entry.card))} — ${escapeHtml(entry.manaCost)}</option>`;
  }

  function unblockedOption(card) {
    return `<option value="${escapeHtml(card.id)}">${escapeHtml(cardName(card))}</option>`;
  }

  function showCombat() {
    document.getElementById("v51CombatSheet")?.remove();
    const overlay = document.createElement("div");
    overlay.id = "v51CombatSheet";
    overlay.className = "v51-combat-sheet";
    overlay.innerHTML = `
      <section>
        <header>
          <div><small>COMPLETE COMBAT</small><h2>${escapeHtml(state?.phase || "Combat")}</h2></div>
          <button type="button" data-v51-close>×</button>
        </header>

        ${state?.lastError ? `<div class="v51-error">${escapeHtml(state.lastError)}</div>` : ""}

        <div class="v51-damage-buttons">
          <button type="button" data-v51-damage="first">Resolve first-strike damage</button>
          <button type="button" data-v51-damage="normal">Resolve regular damage</button>
        </div>

        <h3>Attackers and blocker order</h3>
        <div class="v51-attacker-list">
          ${(state?.attackers || []).map(attackerCard).join("") || "<p>No creatures are attacking.</p>"}
        </div>

        <h3>Ninjutsu</h3>
        <div class="v51-ninjutsu-box">
          <select data-v51-ninja>
            <option value="">Choose Ninja</option>
            ${(state?.ninjutsu || []).map(ninjaOption).join("")}
          </select>
          <select data-v51-return-attacker>
            <option value="">Choose unblocked attacker to return</option>
            ${(state?.unblockedAttackers || []).map(unblockedOption).join("")}
          </select>
          <button type="button" data-v51-ninjutsu>Use Ninjutsu</button>
        </div>

        <h3>Goad helper</h3>
        <div class="v51-goad-box">
          <select data-v51-goad-card>
            <option value="">Choose visible creature</option>
            ${(state?.attackers || []).map((entry) => `<option value="${escapeHtml(entry.card.id)}">${escapeHtml(cardName(entry.card))}</option>`).join("")}
          </select>
          <button type="button" data-v51-goad>Mark goaded</button>
          <small>Use this helper when a card effect says to goad a creature.</small>
        </div>
      </section>
    `;
    document.body.appendChild(overlay);
  }

  function moveBlocker(button, direction) {
    const row = button.closest("[data-blocker-id]");
    const sibling = direction === "up" ? row.previousElementSibling : row.nextElementSibling;
    if (!sibling?.hasAttribute("data-blocker-id")) return;
    if (direction === "up") row.parentNode.insertBefore(row, sibling);
    else row.parentNode.insertBefore(sibling, row);
    [...row.parentNode.querySelectorAll("[data-blocker-id]")].forEach((entry, index) => {
      const span = entry.querySelector("span");
      span.textContent = `${index + 1}. ${span.textContent.replace(/^\d+\.\s*/, "")}`;
    });
  }

  async function saveOrder(button) {
    const attacker = button.closest("[data-attacker-id]");
    try {
      await api("/api/combat-v51/action", {
        type: "combat-v51-set-order",
        attackerCardId: attacker.dataset.attackerId,
        blockerIds: [...attacker.querySelectorAll("[data-blocker-id]")].map((entry) => entry.dataset.blockerId)
      });
      toast("Blocker damage order saved.", "success");
    } catch (error) {
      toast(error.message || "Unable to save blocker order.", "error");
    }
  }

  async function combatAction(body, successMessage) {
    try {
      await api("/api/combat-v51/action", body);
      document.getElementById("v51CombatSheet")?.remove();
      toast(successMessage, "success");
      setTimeout(poll, 40);
    } catch (error) {
      toast(error.message || "Combat action failed.", "error");
    }
  }

  function closeChoice() {
    document.getElementById("v51ChoiceOverlay")?.remove();
    activeChoiceId = "";
  }

  function renderChoice(choice) {
    if (!choice || choice.id === activeChoiceId) return;
    closeChoice();
    activeChoiceId = choice.id;
    const overlay = document.createElement("div");
    overlay.id = "v51ChoiceOverlay";
    overlay.className = "v51-choice-overlay";
    overlay.dataset.choiceId = choice.id;
    overlay.dataset.amount = choice.amount;
    overlay.innerHTML = `
      <section>
        <small>ANNIHILATOR ${choice.amount}</small>
        <h2>${escapeHtml(choice.sourceName)}</h2>
        <p>Choose exactly ${choice.amount} permanent${choice.amount === 1 ? "" : "s"} to sacrifice.</p>
        <div class="v51-choice-grid">
          ${(choice.candidates || []).map((card) => `
            <label>
              <input type="checkbox" data-v51-sacrifice value="${escapeHtml(card.id)}">
              ${cardImage(card) ? `<img src="${escapeHtml(cardImage(card))}" alt="">` : '<div class="v51-card-back">?</div>'}
              <span>${escapeHtml(cardName(card))}</span>
            </label>
          `).join("")}
        </div>
        <button type="button" class="v51-confirm-choice" data-v51-confirm-choice disabled>Confirm sacrifices</button>
      </section>
    `;
    document.body.appendChild(overlay);
  }

  function updateChoiceButton() {
    const overlay = document.getElementById("v51ChoiceOverlay");
    if (!overlay) return;
    const selected = overlay.querySelectorAll("[data-v51-sacrifice]:checked").length;
    overlay.querySelector("[data-v51-confirm-choice]").disabled = selected !== Number(overlay.dataset.amount || 0);
  }

  async function resolveChoice() {
    const overlay = document.getElementById("v51ChoiceOverlay");
    if (!overlay) return;
    const cardIds = [...overlay.querySelectorAll("[data-v51-sacrifice]:checked")].map((input) => input.value);
    try {
      await api("/api/combat-v51/resolve-choice", {
        choiceId: overlay.dataset.choiceId,
        cardIds
      });
      closeChoice();
      toast("Annihilator sacrifices completed.", "success");
    } catch (error) {
      toast(error.message || "Unable to complete Annihilator.", "error");
    }
  }

  function updatePhase() {
    const badge = document.querySelector("[data-v51-phase]");
    if (badge) badge.textContent = String(state?.phase || "—").replace(" Damage", "");
  }

  async function poll() {
    clearTimeout(pollTimer);
    try {
      const [nextState, pending] = await Promise.all([
        api("/api/combat-v51/state"),
        api("/api/combat-v51/pending")
      ]);
      state = nextState;
      installButton();
      updatePhase();
      if (pending.choice) renderChoice(pending.choice);
      else closeChoice();
    } catch {}
    pollTimer = setTimeout(poll, document.hidden ? 3800 : 1100);
  }

  document.addEventListener("click", (event) => {
    if (event.target.closest("#v51CombatButton")) {
      event.preventDefault();
      showCombat();
      return;
    }
    if (event.target.closest("[data-v51-close]")) {
      event.preventDefault();
      document.getElementById("v51CombatSheet")?.remove();
      return;
    }
    const up = event.target.closest("[data-v51-up]");
    if (up) { event.preventDefault(); moveBlocker(up, "up"); return; }
    const down = event.target.closest("[data-v51-down]");
    if (down) { event.preventDefault(); moveBlocker(down, "down"); return; }
    const save = event.target.closest("[data-v51-save-order]");
    if (save) { event.preventDefault(); saveOrder(save); return; }
    const damage = event.target.closest("[data-v51-damage]");
    if (damage) {
      event.preventDefault();
      combatAction({ type: "combat-v51-resolve-damage", pass: damage.dataset.v51Damage }, "Combat damage resolved.");
      return;
    }
    if (event.target.closest("[data-v51-ninjutsu]")) {
      event.preventDefault();
      const sheet = document.getElementById("v51CombatSheet");
      combatAction({
        type: "combat-v51-ninjutsu",
        cardId: sheet.querySelector("[data-v51-ninja]")?.value || "",
        attackerCardId: sheet.querySelector("[data-v51-return-attacker]")?.value || ""
      }, "Ninjutsu completed.");
      return;
    }
    if (event.target.closest("[data-v51-goad]")) {
      event.preventDefault();
      const cardId = document.querySelector("[data-v51-goad-card]")?.value || "";
      combatAction({ type: "combat-v51-goad", cardId }, "Creature marked goaded.");
      return;
    }
    if (event.target.closest("[data-v51-confirm-choice]")) {
      event.preventDefault();
      resolveChoice();
    }
  });

  document.addEventListener("change", (event) => {
    if (event.target.closest("[data-v51-sacrifice]")) updateChoiceButton();
  });

  const observer = new MutationObserver(installButton);
  const app = document.getElementById("app");
  if (app) observer.observe(app, { childList: true, subtree: true });

  document.addEventListener("visibilitychange", poll);
  window.addEventListener("load", poll, { once: true });
  poll();

  window.ArenaCommanderCombatV51 = { version: VERSION, refresh: poll };
})();
