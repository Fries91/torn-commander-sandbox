(() => {
  "use strict";

  const VERSION = "49.0.0";
  const SESSION_KEY = "tornCommander.session.v5";
  let pollTimer = null;
  let activeBattleChoice = "";
  let formsState = null;

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

  function clean(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
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
    return clean(card?.cardData?.name || card?.name || "Card");
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
    const element = document.createElement("div");
    element.className = `toast ${type}`;
    element.textContent = message;
    region.appendChild(element);
    setTimeout(() => element.remove(), 4300);
  }

  function optionCard(option) {
    return `
      <label class="v49-face-option">
        <input type="radio" name="v49-form-option"
          value="${escapeHtml(option.id)}"
          ${option.id === "face:0" ? "checked" : ""}>
        ${
          option.imageUrl
            ? `<img src="${escapeHtml(option.imageUrl)}" alt="">`
            : `<div class="v49-face-back">?</div>`
        }
        <strong>${escapeHtml(option.name)}</strong>
        <small>${escapeHtml(option.manaCost || "No mana cost")}</small>
        <span>${escapeHtml(option.typeLine)}</span>
      </label>
    `;
  }

  async function enhanceCastForm(form) {
    if (form.dataset.v49Forms) return;
    form.dataset.v49Forms = "loading";

    const data = new FormData(form);
    try {
      const payload = await api("/api/forms/preview", {
        cardId: data.get("cardId"),
        fromZone: data.get("fromZone") || "hand"
      });

      const interesting =
        payload.options.length > 1 ||
        payload.options.some((option) =>
          ["prototype", "face-down", "mutate"].includes(option.kind)
        );

      if (!interesting) {
        form.dataset.v49Forms = "none";
        return;
      }

      const panel = document.createElement("section");
      panel.className = "v49-forms-panel";
      panel.dataset.v49FormsPanel = "1";
      panel.innerHTML = `
        <header>
          <div>
            <small>CARD FORM</small>
            <strong>${escapeHtml(payload.cardName)}</strong>
          </div>
          <span>v49</span>
        </header>
        <div class="v49-face-grid">
          ${payload.options.map(optionCard).join("")}
        </div>
        ${
          payload.mutateTargets?.length
            ? `
              <label class="v49-mutate-target">
                <span>Mutate target</span>
                <select data-v49-mutate-target>
                  <option value="">Choose non-Human creature</option>
                  ${payload.mutateTargets
                    .map(
                      (card) =>
                        `<option value="${escapeHtml(card.id)}">${escapeHtml(
                          cardName(card)
                        )}</option>`
                    )
                    .join("")}
                </select>
              </label>
              <label class="v49-mutate-position">
                <input type="checkbox" data-v49-mutate-top checked>
                Put mutating card on top
              </label>
            `
            : ""
        }
        <button type="button" class="v49-play-form" data-v49-play-form>
          <strong>Play selected form</strong>
          <small>Use Arena rules for this face or alternate form</small>
        </button>
      `;

      const firstSubmit = form.querySelector("button[type='submit']");
      firstSubmit?.before(panel);

      form.querySelector("[data-v42-autotap-panel]")?.classList.add(
        "v49-hide-base-cast"
      );
      form.querySelector("[data-v46-mechanics-panel]")?.classList.add(
        "v49-hide-base-cast"
      );

      form.dataset.v49Forms = "ready";
    } catch {
      form.dataset.v49Forms = "error";
    }
  }

  async function playSelectedForm(form, button) {
    const data = new FormData(form);
    const optionId =
      form.querySelector("input[name='v49-form-option']:checked")?.value ||
      "face:0";
    const old = button.innerHTML;
    button.disabled = true;
    button.innerHTML =
      "<strong>Applying card form…</strong><small>Server is validating the play</small>";

    try {
      await api("/api/forms/play", {
        cardId: data.get("cardId"),
        fromZone: data.get("fromZone") || "hand",
        optionId,
        targetCardId:
          form.querySelector("[data-v49-mutate-target]")?.value || "",
        position:
          form.querySelector("[data-v49-mutate-top]")?.checked === false
            ? "bottom"
            : "top",
        xValue: Number(data.get("xValue") || 0),
        targets: data.getAll("targets").map(String),
        modes: String(data.get("modes") || "")
          .split(/\s*;\s*|\n/)
          .filter(Boolean)
      });

      document
        .querySelector("#modalBackdrop [data-action='close-modal']")
        ?.click();
      toast("Selected card form played.", "success");
    } catch (error) {
      button.disabled = false;
      button.innerHTML = old;
      toast(error.message || "Unable to play that form.", "error");
    }
  }

  function installButton() {
    const actions = document.querySelector(
      ".arena-game-topbar .arena-top-actions"
    );
    if (!actions || document.getElementById("v49FormsButton")) return;

    const button = document.createElement("button");
    button.type = "button";
    button.id = "v49FormsButton";
    button.className = "arena-hotfix-control v49-forms-button";
    button.innerHTML =
      '<span>◐</span><small>Forms</small><b data-v49-day-night>—</b>';
    actions.appendChild(button);
  }

  function statePermanent(entry) {
    const card = entry.card;
    const image = cardImage(card);

    const actions = [];
    if (entry.canTransform) {
      actions.push(
        `<button type="button" data-v49-action="forms-transform"
          data-card-id="${escapeHtml(card.id)}">Transform</button>`
      );
    }
    if (entry.canTurnFaceUp) {
      actions.push(
        `<button type="button" data-v49-action="forms-turn-face-up"
          data-card-id="${escapeHtml(card.id)}">Turn face up</button>`
      );
    }

    return `
      <article class="v49-state-card">
        ${
          image
            ? `<img src="${escapeHtml(image)}" alt="">`
            : `<div class="v49-face-back">?</div>`
        }
        <strong>${escapeHtml(cardName(card))}</strong>
        <small>
          ${
            entry.isSaga
              ? `Lore ${entry.lore}`
              : entry.isBattle
                ? `Defense ${entry.defense}`
                : entry.mutateCount
                  ? `${entry.mutateCount} merged cards`
                  : "Permanent"
          }
        </small>
        <div>${actions.join("") || "<span>No form action</span>"}</div>
      </article>
    `;
  }

  function showFormsSheet() {
    document.getElementById("v49FormsSheet")?.remove();
    const overlay = document.createElement("div");
    overlay.id = "v49FormsSheet";
    overlay.className = "v49-forms-sheet";
    overlay.innerHTML = `
      <section>
        <header>
          <div>
            <small>PERMANENT FORMS</small>
            <h2>Day/Night: ${escapeHtml(
              formsState?.dayNight || "Not active"
            )}</h2>
          </div>
          <button type="button" data-v49-close>×</button>
        </header>

        <button type="button" class="v49-manifest-button"
          data-v49-action="forms-manifest"
          ${formsState?.canManifest ? "" : "disabled"}>
          Manifest top card
        </button>

        <div class="v49-state-grid">
          ${(formsState?.permanents || []).map(statePermanent).join("") ||
            "<p>No permanents are available.</p>"}
        </div>

        <h3>Battles</h3>
        <div class="v49-battle-list">
          ${(formsState?.battles || [])
            .map(
              (entry) => `
                <article>
                  <strong>${escapeHtml(cardName(entry.card))}</strong>
                  <small>${entry.defense} defense</small>
                  <label>
                    Damage
                    <input type="number" min="0" max="99" value="1"
                      data-v49-battle-amount="${escapeHtml(entry.card.id)}">
                  </label>
                  <button type="button"
                    data-v49-damage-battle="${escapeHtml(entry.card.id)}">
                    Deal damage
                  </button>
                </article>
              `
            )
            .join("") || "<p>No Battles are on the battlefield.</p>"}
        </div>
      </section>
    `;
    document.body.appendChild(overlay);
  }

  async function runAction(type, data = {}) {
    try {
      await api("/api/forms/action", { type, ...data });
      document.getElementById("v49FormsSheet")?.remove();
      toast("Permanent-form action completed.", "success");
      setTimeout(poll, 40);
    } catch (error) {
      toast(error.message || "That form action failed.", "error");
    }
  }

  function closeBattlePrompt() {
    document.getElementById("v49BattleOverlay")?.remove();
    activeBattleChoice = "";
  }

  function renderBattlePrompt(choice) {
    if (!choice || choice.id === activeBattleChoice) return;
    closeBattlePrompt();
    activeBattleChoice = choice.id;

    const overlay = document.createElement("div");
    overlay.id = "v49BattleOverlay";
    overlay.className = "v49-battle-overlay";
    overlay.dataset.choiceId = choice.id;
    overlay.innerHTML = `
      <section>
        <small>BATTLE DEFEATED</small>
        <h2>${escapeHtml(choice.battleName)}</h2>
        <p>
          ${
            choice.canCastBackFace
              ? `Cast ${escapeHtml(
                  choice.backFaceName
                )} from exile without paying its mana cost?`
              : "This Battle has no loaded back face."
          }
        </p>
        <div>
          <button type="button" data-v49-battle-decline>Leave in exile</button>
          ${
            choice.canCastBackFace
              ? `<button type="button" class="v49-cast-battle"
                   data-v49-battle-cast>Make back face playable</button>`
              : ""
          }
        </div>
      </section>
    `;
    document.body.appendChild(overlay);
  }

  async function resolveBattle(castBackFace) {
    const overlay = document.getElementById("v49BattleOverlay");
    if (!overlay) return;

    overlay.querySelectorAll("button").forEach((button) => {
      button.disabled = true;
    });

    try {
      await api("/api/forms/resolve-battle", {
        choiceId: overlay.dataset.choiceId,
        castBackFace
      });
      closeBattlePrompt();
      toast(
        castBackFace
          ? "The Battle back face is now playable from exile."
          : "The defeated Battle remains in exile.",
        "success"
      );
    } catch (error) {
      overlay.querySelectorAll("button").forEach((button) => {
        button.disabled = false;
      });
      toast(error.message || "Unable to resolve the Battle.", "error");
    }
  }

  function updateDayNight() {
    const badge = document.querySelector("[data-v49-day-night]");
    if (badge) {
      badge.textContent =
        formsState?.dayNight === "day"
          ? "DAY"
          : formsState?.dayNight === "night"
            ? "NIGHT"
            : "—";
    }
  }

  async function poll() {
    clearTimeout(pollTimer);
    try {
      const [state, pending] = await Promise.all([
        api("/api/forms/state"),
        api("/api/forms/pending")
      ]);
      formsState = state;
      installButton();
      updateDayNight();

      if (pending.battleChoice) {
        renderBattlePrompt(pending.battleChoice);
      } else {
        closeBattlePrompt();
      }
    } catch {}

    pollTimer = setTimeout(poll, document.hidden ? 3800 : 1200);
  }

  document.addEventListener("click", (event) => {
    const play = event.target.closest("[data-v49-play-form]");
    if (play) {
      event.preventDefault();
      playSelectedForm(play.closest("#castCardForm"), play);
      return;
    }

    if (event.target.closest("#v49FormsButton")) {
      event.preventDefault();
      showFormsSheet();
      return;
    }

    if (event.target.closest("[data-v49-close]")) {
      event.preventDefault();
      document.getElementById("v49FormsSheet")?.remove();
      return;
    }

    const action = event.target.closest("[data-v49-action]");
    if (action) {
      event.preventDefault();
      runAction(action.dataset.v49Action, {
        cardId: action.dataset.cardId || ""
      });
      return;
    }

    const damage = event.target.closest("[data-v49-damage-battle]");
    if (damage) {
      event.preventDefault();
      const cardId = damage.dataset.v49DamageBattle;
      const amount = Number(
        document.querySelector(
          `[data-v49-battle-amount="${CSS.escape(cardId)}"]`
        )?.value || 0
      );
      runAction("forms-damage-battle", {
        battleCardId: cardId,
        amount
      });
      return;
    }

    if (event.target.closest("[data-v49-battle-cast]")) {
      event.preventDefault();
      resolveBattle(true);
      return;
    }

    if (event.target.closest("[data-v49-battle-decline]")) {
      event.preventDefault();
      resolveBattle(false);
    }
  });

  const observer = new MutationObserver(() => {
    installButton();
    const form = document.getElementById("castCardForm");
    if (form) enhanceCastForm(form);
  });

  const app = document.getElementById("app");
  if (app) observer.observe(app, { childList: true, subtree: true });
  const modalBody = document.getElementById("modalBody");
  if (modalBody) {
    observer.observe(modalBody, { childList: true, subtree: true });
  }

  document.addEventListener("visibilitychange", poll);
  window.addEventListener("load", poll, { once: true });
  poll();

  window.ArenaCommanderFormsV49 = {
    version: VERSION,
    refresh: poll
  };
})();
