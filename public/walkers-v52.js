(() => {
  "use strict";

  const VERSION = "52.0.0";
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
      card?.cardData?.faces?.[card?.activeFaceIndex || 0]?.imageUrl ||
      card?.cardData?.faces?.[0]?.imageUrl ||
      ""
    );
  }

  async function api(path, body = {}) {
    const auth = session();
    if (!auth) throw new Error("No saved room session.");

    const response = await fetch(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
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
    if (!actions || document.getElementById("v52WalkerButton")) return;

    const button = document.createElement("button");
    button.type = "button";
    button.id = "v52WalkerButton";
    button.className = "arena-hotfix-control v52-walker-button";
    button.innerHTML =
      '<span>✦</span><small>Walkers</small><b data-v52-count>0</b>';
    actions.appendChild(button);
  }

  function targetLabel(target) {
    if (target.kind === "player") return `${target.name} — player`;
    if (target.kind === "planeswalker") {
      return `${target.name} — ${target.counters} loyalty`;
    }
    return `${target.name} — ${target.counters} defense, protected by ${target.protectorName}`;
  }

  function attackPanel() {
    const active =
      state?.activePlayerId === session()?.playerId &&
      state?.phase === "Declare Attackers";

    return `
      <section class="v52-section">
        <h3>Attack player, planeswalker, or Battle</h3>
        <div class="v52-attack-form">
          <select data-v52-attacker ${active ? "" : "disabled"}>
            <option value="">Choose attacker</option>
            ${(state?.legalAttackers || [])
              .map(
                (card) =>
                  `<option value="${escapeHtml(card.id)}">${escapeHtml(
                    cardName(card)
                  )}</option>`
              )
              .join("")}
          </select>
          <select data-v52-attack-target ${active ? "" : "disabled"}>
            <option value="">Choose attack target</option>
            ${(state?.attackTargets || [])
              .map(
                (target) =>
                  `<option value="${escapeHtml(
                    target.targetKey
                  )}">${escapeHtml(targetLabel(target))}</option>`
              )
              .join("")}
          </select>
          <button type="button" data-v52-attack ${
            active ? "" : "disabled"
          }>Declare attack</button>
        </div>
        <small>
          ${
            active
              ? "The Battle protector or planeswalker controller becomes the defending player."
              : "This control becomes available during your Declare Attackers step."
          }
        </small>
      </section>
    `;
  }

  function targetControls(planeswalker, ability) {
    const requirement = ability.targetRequirement;
    if (!requirement.maximum) return "";

    const inputType = requirement.maximum === 1 ? "radio" : "checkbox";
    return `
      <div class="v52-targets"
        data-v52-targets="${escapeHtml(planeswalker.card.id)}:${ability.index}"
        data-min="${requirement.minimum}"
        data-max="${requirement.maximum}">
        <strong>Targets</strong>
        ${(ability.targetCandidates || [])
          .map(
            (candidate) => `
              <label>
                <input type="${inputType}"
                  name="v52-target-${escapeHtml(
                    planeswalker.card.id
                  )}-${ability.index}"
                  value="${escapeHtml(candidate.target)}">
                <span>${escapeHtml(candidate.name)}</span>
                <small>${escapeHtml(candidate.kind)}</small>
              </label>
            `
          )
          .join("") || "<small>No legal target is currently available.</small>"}
      </div>
    `;
  }

  function loyaltyAbility(planeswalker, ability) {
    return `
      <article class="v52-loyalty-ability"
        data-v52-ability-card="${escapeHtml(planeswalker.card.id)}"
        data-v52-ability-index="${ability.index}"
        data-variable="${ability.variable ? "1" : "0"}">
        <span class="v52-loyalty-cost">${escapeHtml(ability.costLabel)}</span>
        <div>
          <p>${escapeHtml(ability.text)}</p>
          ${targetControls(planeswalker, ability)}
          ${
            ability.variable
              ? `<label class="v52-x-value">X
                   <input type="number" min="0"
                     max="${planeswalker.loyalty}" value="0"
                     data-v52-x>
                 </label>`
              : ""
          }
        </div>
        <button type="button" data-v52-activate-loyalty
          ${
            ability.canPay &&
            planeswalker.activationsUsed < planeswalker.activationsMaximum
              ? ""
              : "disabled"
          }>
          Activate
        </button>
      </article>
    `;
  }

  function planeswalkerCard(entry) {
    return `
      <article class="v52-walker-card">
        ${
          cardImage(entry.card)
            ? `<img src="${escapeHtml(cardImage(entry.card))}" alt="">`
            : '<div class="v52-card-back">✦</div>'
        }
        <header>
          <strong>${escapeHtml(cardName(entry.card))}</strong>
          <span>${entry.loyalty} loyalty</span>
          <small>
            Activations: ${entry.activationsUsed}/${entry.activationsMaximum}
          </small>
        </header>
        <div class="v52-ability-list">
          ${(entry.abilities || [])
            .map((ability) => loyaltyAbility(entry, ability))
            .join("") || "<small>No loyalty abilities were parsed.</small>"}
        </div>
      </article>
    `;
  }

  function battleCard(entry) {
    return `
      <article class="v52-battle-card">
        ${
          cardImage(entry.card)
            ? `<img src="${escapeHtml(cardImage(entry.card))}" alt="">`
            : '<div class="v52-card-back">⚔</div>'
        }
        <strong>${escapeHtml(cardName(entry.card))}</strong>
        <span>${entry.defense} defense</span>
        <small>Controller: ${escapeHtml(entry.controllerName)}</small>
        <small>Protector: ${escapeHtml(entry.protectorName || "Pending")}</small>
        <div class="v52-damage-helper">
          <input type="number" min="0" max="999" value="1"
            data-v52-damage-amount="${escapeHtml(entry.card.id)}">
          <button type="button"
            data-v52-damage-target="${escapeHtml(entry.card.id)}">
            Apply damage
          </button>
        </div>
      </article>
    `;
  }

  function showSheet() {
    document.getElementById("v52WalkerSheet")?.remove();

    const overlay = document.createElement("div");
    overlay.id = "v52WalkerSheet";
    overlay.className = "v52-walker-sheet";
    overlay.innerHTML = `
      <section>
        <header class="v52-sheet-header">
          <div>
            <small>PLANESWALKERS & BATTLES</small>
            <h2>${escapeHtml(state?.phase || "Game")}</h2>
          </div>
          <button type="button" data-v52-close>×</button>
        </header>

        ${
          state?.lastError
            ? `<div class="v52-error">${escapeHtml(state.lastError)}</div>`
            : ""
        }

        ${attackPanel()}

        <section class="v52-section">
          <h3>Your planeswalkers</h3>
          <div class="v52-walker-list">
            ${(state?.planeswalkers || [])
              .map(planeswalkerCard)
              .join("") || "<p>You control no planeswalkers.</p>"}
          </div>
        </section>

        <section class="v52-section">
          <h3>Battles in the game</h3>
          <div class="v52-battle-grid">
            ${(state?.battles || [])
              .map(battleCard)
              .join("") || "<p>No Battles are on the battlefield.</p>"}
          </div>
        </section>
      </section>
    `;
    document.body.appendChild(overlay);
  }

  async function runAction(body, successMessage) {
    try {
      await api("/api/combat-v52/action", body);
      document.getElementById("v52WalkerSheet")?.remove();
      toast(successMessage, "success");
      setTimeout(poll, 40);
    } catch (error) {
      toast(error.message || "v52 action failed.", "error");
    }
  }

  function selectedAbilityTargets(ability) {
    return [
      ...ability.querySelectorAll(".v52-targets input:checked")
    ].map((input) => input.value);
  }

  function abilityTargetsValid(ability) {
    const box = ability.querySelector(".v52-targets");
    if (!box) return true;
    const count = box.querySelectorAll("input:checked").length;
    return count >= Number(box.dataset.min || 0) &&
      count <= Number(box.dataset.max || 0);
  }

  function closeProtector() {
    document.getElementById("v52ProtectorOverlay")?.remove();
    activeChoiceId = "";
  }

  function renderProtector(choice) {
    if (!choice || activeChoiceId === choice.id) return;
    closeProtector();
    activeChoiceId = choice.id;

    const overlay = document.createElement("div");
    overlay.id = "v52ProtectorOverlay";
    overlay.className = "v52-protector-overlay";
    overlay.dataset.choiceId = choice.id;
    overlay.innerHTML = `
      <section>
        <small>BATTLE PROTECTOR</small>
        <h2>${escapeHtml(choice.sourceName)}</h2>
        <p>Choose the opponent who will protect this Battle.</p>
        <div class="v52-protector-grid">
          ${(choice.candidates || [])
            .map(
              (player) => `
                <button type="button"
                  data-v52-protector="${escapeHtml(player.id)}">
                  <strong>${escapeHtml(player.name)}</strong>
                  <small>${player.life} life</small>
                </button>
              `
            )
            .join("")}
        </div>
      </section>
    `;
    document.body.appendChild(overlay);
  }

  async function resolveProtector(playerId) {
    const overlay = document.getElementById("v52ProtectorOverlay");
    if (!overlay) return;

    overlay.querySelectorAll("button").forEach((button) => {
      button.disabled = true;
    });

    try {
      await api("/api/combat-v52/resolve-protector", {
        choiceId: overlay.dataset.choiceId,
        protectorPlayerId: playerId
      });
      closeProtector();
      toast("Battle protector selected.", "success");
      setTimeout(poll, 40);
    } catch (error) {
      overlay.querySelectorAll("button").forEach((button) => {
        button.disabled = false;
      });
      toast(error.message || "Unable to choose that protector.", "error");
    }
  }

  function updateBadge() {
    const badge = document.querySelector("[data-v52-count]");
    if (badge) {
      badge.textContent = String(
        (state?.planeswalkers?.length || 0) +
        (state?.battles?.length || 0)
      );
    }
  }

  async function poll() {
    clearTimeout(pollTimer);

    try {
      const [nextState, pending] = await Promise.all([
        api("/api/combat-v52/state"),
        api("/api/combat-v52/pending")
      ]);
      state = nextState;
      installButton();
      updateBadge();

      if (pending.choice) renderProtector(pending.choice);
      else closeProtector();
    } catch {}

    pollTimer = setTimeout(poll, document.hidden ? 3800 : 1100);
  }

  document.addEventListener("click", (event) => {
    if (event.target.closest("#v52WalkerButton")) {
      event.preventDefault();
      showSheet();
      return;
    }

    if (event.target.closest("[data-v52-close]")) {
      event.preventDefault();
      document.getElementById("v52WalkerSheet")?.remove();
      return;
    }

    if (event.target.closest("[data-v52-attack]")) {
      event.preventDefault();
      const sheet = document.getElementById("v52WalkerSheet");
      runAction(
        {
          type: "combat-v52-declare-attack",
          cardId: sheet.querySelector("[data-v52-attacker]")?.value || "",
          targetKey:
            sheet.querySelector("[data-v52-attack-target]")?.value || ""
        },
        "Attack declared."
      );
      return;
    }

    const activate = event.target.closest("[data-v52-activate-loyalty]");
    if (activate) {
      event.preventDefault();
      const ability = activate.closest(".v52-loyalty-ability");
      if (!abilityTargetsValid(ability)) {
        toast("Choose the required loyalty-ability targets.", "warning");
        return;
      }

      runAction(
        {
          type: "combat-v52-activate-loyalty",
          cardId: ability.dataset.v52AbilityCard,
          abilityIndex: Number(ability.dataset.v52AbilityIndex),
          xValue: Number(ability.querySelector("[data-v52-x]")?.value || 0),
          targets: selectedAbilityTargets(ability)
        },
        "Loyalty ability placed on the stack."
      );
      return;
    }

    const damage = event.target.closest("[data-v52-damage-target]");
    if (damage) {
      event.preventDefault();
      const cardId = damage.dataset.v52DamageTarget;
      const amount = Number(
        document.querySelector(
          `[data-v52-damage-amount="${CSS.escape(cardId)}"]`
        )?.value || 0
      );

      runAction(
        {
          type: "combat-v52-damage-permanent",
          targetCardId: cardId,
          amount
        },
        "Damage applied."
      );
      return;
    }

    const protector = event.target.closest("[data-v52-protector]");
    if (protector) {
      event.preventDefault();
      resolveProtector(protector.dataset.v52Protector);
    }
  });

  const observer = new MutationObserver(installButton);
  const app = document.getElementById("app");
  if (app) observer.observe(app, { childList: true, subtree: true });

  document.addEventListener("visibilitychange", poll);
  window.addEventListener("load", poll, { once: true });
  poll();

  window.ArenaCommanderWalkersV52 = {
    version: VERSION,
    refresh: poll
  };
})();
