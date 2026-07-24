(() => {
  "use strict";

  const VERSION = "53.0.0";
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
    if (!actions || document.getElementById("v53AttachmentButton")) return;

    const button = document.createElement("button");
    button.type = "button";
    button.id = "v53AttachmentButton";
    button.className = "arena-hotfix-control v53-attachment-button";
    button.innerHTML =
      '<span>🔗</span><small>Attach</small><b data-v53-count>0</b>';
    actions.appendChild(button);
  }

  async function enhanceAuraForm(form) {
    if (form.dataset.v53Aura) return;
    form.dataset.v53Aura = "loading";

    const data = new FormData(form);

    try {
      const payload = await api("/api/attachments-v53/preview", {
        cardId: data.get("cardId"),
        fromZone: data.get("fromZone") || "hand"
      });

      if (!payload.isAura || !payload.restriction) {
        form.dataset.v53Aura = "none";
        return;
      }

      const panel = document.createElement("section");
      panel.className = "v53-aura-panel";
      panel.innerHTML = `
        <header>
          <div>
            <small>AURA TARGET</small>
            <strong>${escapeHtml(cardName(payload.card))}</strong>
          </div>
          <span>v53</span>
        </header>

        <p>Enchant ${escapeHtml(payload.restriction.phrase)}</p>

        <select data-v53-aura-target>
          <option value="">Choose legal Aura target</option>
          ${(payload.candidates || [])
            .map(
              (candidate) =>
                `<option value="${escapeHtml(candidate.targetKey)}">${escapeHtml(
                  candidate.name
                )}${candidate.typeLine ? ` — ${escapeHtml(candidate.typeLine)}` : ""}</option>`
            )
            .join("")}
        </select>

        <button type="button" data-v53-cast-aura
          ${payload.candidates?.length ? "" : "disabled"}>
          <strong>Auto-Tap & Cast Aura</strong>
          <small>The server will attach it only if the target remains legal</small>
        </button>
      `;

      form.querySelector("button[type='submit']")?.before(panel);
      form.querySelector("[data-v42-autotap-panel]")?.classList.add(
        "v53-hide-base"
      );
      form.querySelector("[data-v46-mechanics-panel]")?.classList.add(
        "v53-hide-base"
      );
      form.dataset.v53Aura = "ready";
    } catch {
      form.dataset.v53Aura = "error";
    }
  }

  async function castAura(form, button) {
    const data = new FormData(form);
    const targetKey =
      form.querySelector("[data-v53-aura-target]")?.value || "";

    if (!targetKey) {
      toast("Choose a legal Aura target.", "warning");
      return;
    }

    const old = button.innerHTML;
    button.disabled = true;
    button.innerHTML =
      "<strong>Casting Aura…</strong><small>Checking enchant legality</small>";

    try {
      await api("/api/attachments-v53/action", {
        type: "attachments-v53-cast-aura",
        cardId: data.get("cardId"),
        fromZone: data.get("fromZone") || "hand",
        targetKey,
        xValue: Number(data.get("xValue") || 0),
        modes: String(data.get("modes") || "")
          .split(/\s*;\s*|\n/)
          .filter(Boolean)
      });

      document
        .querySelector("#modalBackdrop [data-action='close-modal']")
        ?.click();
      toast("Aura cast with a legal attachment target.", "success");
    } catch (error) {
      button.disabled = false;
      button.innerHTML = old;
      toast(error.message || "Unable to cast that Aura.", "error");
    }
  }

  function attachmentCard(entry) {
    const card = entry.card;

    return `
      <article class="v53-attachment-card">
        ${
          cardImage(card)
            ? `<img src="${escapeHtml(cardImage(card))}" alt="">`
            : '<div class="v53-card-back">🔗</div>'
        }
        <strong>${escapeHtml(cardName(card))}</strong>
        <small>
          ${escapeHtml(entry.mode)} ${escapeHtml(entry.manaCost)}
          ${entry.qualifier ? ` — ${escapeHtml(entry.qualifier)}` : ""}
        </small>
        <span>
          ${
            entry.target
              ? `Attached to ${escapeHtml(cardName(entry.target))}`
              : "Unattached"
          }
        </span>

        <select data-v53-target>
          <option value="">Choose legal target</option>
          ${(entry.candidates || [])
            .map(
              (target) =>
                `<option value="${escapeHtml(target.id)}">${escapeHtml(
                  cardName(target)
                )}</option>`
            )
            .join("")}
        </select>

        <button type="button"
          data-v53-activate="${escapeHtml(entry.card.id)}"
          data-v53-mode="${escapeHtml(entry.mode)}">
          Activate ${escapeHtml(entry.mode)}
        </button>

        ${
          entry.canDetach
            ? `<button type="button"
                 data-v53-detach="${escapeHtml(entry.card.id)}">
                 Reconfigure — unattach
               </button>`
            : ""
        }
      </article>
    `;
  }

  function powerChoice(entry, sourceId, kind) {
    return `
      <label>
        <input type="checkbox"
          data-v53-${kind}-creature="${escapeHtml(sourceId)}"
          value="${escapeHtml(entry.card.id)}">
        <span>${escapeHtml(cardName(entry.card))}</span>
        <small>${entry.power} power</small>
      </label>
    `;
  }

  function vehicleCard(entry) {
    return `
      <article class="v53-power-card">
        ${
          cardImage(entry.card)
            ? `<img src="${escapeHtml(cardImage(entry.card))}" alt="">`
            : '<div class="v53-card-back">🚙</div>'
        }
        <strong>${escapeHtml(cardName(entry.card))}</strong>
        <span>
          Crew ${entry.crew?.power ?? "?"}
          ${entry.crewed ? " · CREWED" : ""}
        </span>
        <div class="v53-power-choices">
          ${(entry.candidates || [])
            .map((candidate) =>
              powerChoice(candidate, entry.card.id, "crew")
            )
            .join("") || "<small>No untapped creatures are available.</small>"}
        </div>
        <button type="button"
          data-v53-crew="${escapeHtml(entry.card.id)}">
          Activate Crew
        </button>
      </article>
    `;
  }

  function mountCard(entry) {
    return `
      <article class="v53-power-card">
        ${
          cardImage(entry.card)
            ? `<img src="${escapeHtml(cardImage(entry.card))}" alt="">`
            : '<div class="v53-card-back">🐎</div>'
        }
        <strong>${escapeHtml(cardName(entry.card))}</strong>
        <span>
          Saddle ${entry.saddle?.power ?? "?"}
          ${entry.saddled ? " · SADDLED" : ""}
        </span>
        <div class="v53-power-choices">
          ${(entry.candidates || [])
            .map((candidate) =>
              powerChoice(candidate, entry.card.id, "saddle")
            )
            .join("") || "<small>No untapped creatures are available.</small>"}
        </div>
        <button type="button"
          data-v53-saddle="${escapeHtml(entry.card.id)}">
          Activate Saddle
        </button>
      </article>
    `;
  }

  function showSheet() {
    document.getElementById("v53AttachmentSheet")?.remove();

    const overlay = document.createElement("div");
    overlay.id = "v53AttachmentSheet";
    overlay.className = "v53-attachment-sheet";
    overlay.innerHTML = `
      <section>
        <header>
          <div>
            <small>ATTACHMENTS, VEHICLES & MOUNTS</small>
            <h2>${escapeHtml(state?.phase || "Game")}</h2>
          </div>
          <button type="button" data-v53-close>×</button>
        </header>

        <h3>Equipment, Fortifications & Reconfigure</h3>
        <div class="v53-attachment-grid">
          ${(state?.attachments || [])
            .map(attachmentCard)
            .join("") || "<p>No activated attachments are available.</p>"}
        </div>

        <h3>Vehicles</h3>
        <div class="v53-power-grid">
          ${(state?.vehicles || [])
            .map(vehicleCard)
            .join("") || "<p>No Vehicles are on your battlefield.</p>"}
        </div>

        <h3>Mounts</h3>
        <div class="v53-power-grid">
          ${(state?.mounts || [])
            .map(mountCard)
            .join("") || "<p>No Saddle Mounts are on your battlefield.</p>"}
        </div>

        <h3>All current attachments</h3>
        <div class="v53-current-list">
          ${(state?.attached || [])
            .map(
              (entry) => `
                <article>
                  <strong>${escapeHtml(cardName(entry.card))}</strong>
                  <span>→ ${escapeHtml(entry.targetName)}</span>
                  <small>${escapeHtml(entry.controllerName)}</small>
                </article>
              `
            )
            .join("") || "<p>Nothing is currently attached.</p>"}
        </div>
      </section>
    `;
    document.body.appendChild(overlay);
  }

  async function runAction(body, message) {
    try {
      await api("/api/attachments-v53/action", body);
      document.getElementById("v53AttachmentSheet")?.remove();
      toast(message, "success");
      setTimeout(poll, 40);
    } catch (error) {
      toast(error.message || "Attachment action failed.", "error");
    }
  }

  function selectedPowerCreatures(sourceId, kind) {
    return [
      ...document.querySelectorAll(
        `[data-v53-${kind}-creature="${CSS.escape(sourceId)}"]:checked`
      )
    ].map((input) => input.value);
  }

  function closeAuraChoice() {
    document.getElementById("v53AuraChoiceOverlay")?.remove();
    activeChoiceId = "";
  }

  function renderAuraChoice(choice) {
    if (!choice || choice.id === activeChoiceId) return;
    closeAuraChoice();
    activeChoiceId = choice.id;

    const overlay = document.createElement("div");
    overlay.id = "v53AuraChoiceOverlay";
    overlay.className = "v53-aura-choice-overlay";
    overlay.dataset.choiceId = choice.id;
    overlay.innerHTML = `
      <section>
        <small>AURA ENTERS THE BATTLEFIELD</small>
        <h2>${escapeHtml(choice.sourceName)}</h2>
        <p>Choose a legal object for this Aura to enter attached to.</p>
        <div class="v53-aura-choice-grid">
          ${(choice.candidates || [])
            .map(
              (candidate) => `
                <button type="button"
                  data-v53-aura-choice="${escapeHtml(candidate.targetKey)}">
                  <strong>${escapeHtml(candidate.name)}</strong>
                  <small>${escapeHtml(candidate.typeLine || candidate.kind)}</small>
                </button>
              `
            )
            .join("")}
        </div>
      </section>
    `;
    document.body.appendChild(overlay);
  }

  async function resolveAuraChoice(targetKey) {
    const overlay = document.getElementById("v53AuraChoiceOverlay");
    if (!overlay) return;

    overlay.querySelectorAll("button").forEach((button) => {
      button.disabled = true;
    });

    try {
      await api("/api/attachments-v53/resolve-aura", {
        choiceId: overlay.dataset.choiceId,
        targetKey
      });
      closeAuraChoice();
      toast("Aura attached.", "success");
      setTimeout(poll, 40);
    } catch (error) {
      overlay.querySelectorAll("button").forEach((button) => {
        button.disabled = false;
      });
      toast(error.message || "Unable to attach that Aura.", "error");
    }
  }

  function updateBadge() {
    const badge = document.querySelector("[data-v53-count]");
    if (badge) {
      badge.textContent = String(
        (state?.attachments?.length || 0) +
        (state?.vehicles?.length || 0) +
        (state?.mounts?.length || 0)
      );
    }
  }

  async function poll() {
    clearTimeout(pollTimer);

    try {
      const [nextState, pending] = await Promise.all([
        api("/api/attachments-v53/state"),
        api("/api/attachments-v53/pending")
      ]);

      state = nextState;
      installButton();
      updateBadge();

      if (pending.choice) renderAuraChoice(pending.choice);
      else closeAuraChoice();
    } catch {}

    pollTimer = setTimeout(poll, document.hidden ? 3800 : 1100);
  }

  document.addEventListener("click", (event) => {
    const cast = event.target.closest("[data-v53-cast-aura]");
    if (cast) {
      event.preventDefault();
      castAura(cast.closest("#castCardForm"), cast);
      return;
    }

    if (event.target.closest("#v53AttachmentButton")) {
      event.preventDefault();
      showSheet();
      return;
    }

    if (event.target.closest("[data-v53-close]")) {
      event.preventDefault();
      document.getElementById("v53AttachmentSheet")?.remove();
      return;
    }

    const activate = event.target.closest("[data-v53-activate]");
    if (activate) {
      event.preventDefault();
      const card = activate.closest(".v53-attachment-card");
      const targetCardId =
        card.querySelector("[data-v53-target]")?.value || "";

      runAction(
        {
          type: "attachments-v53-activate",
          mode: activate.dataset.v53Mode,
          attachmentCardId: activate.dataset.v53Activate,
          targetCardId
        },
        "Attachment ability placed on the stack."
      );
      return;
    }

    const detach = event.target.closest("[data-v53-detach]");
    if (detach) {
      event.preventDefault();
      runAction(
        {
          type: "attachments-v53-activate",
          mode: "reconfigure",
          attachmentCardId: detach.dataset.v53Detach,
          targetCardId: ""
        },
        "Reconfigure unattach ability placed on the stack."
      );
      return;
    }

    const crew = event.target.closest("[data-v53-crew]");
    if (crew) {
      event.preventDefault();
      const sourceCardId = crew.dataset.v53Crew;
      runAction(
        {
          type: "attachments-v53-crew",
          sourceCardId,
          creatureCardIds: selectedPowerCreatures(
            sourceCardId,
            "crew"
          )
        },
        "Crew ability placed on the stack."
      );
      return;
    }

    const saddle = event.target.closest("[data-v53-saddle]");
    if (saddle) {
      event.preventDefault();
      const sourceCardId = saddle.dataset.v53Saddle;
      runAction(
        {
          type: "attachments-v53-saddle",
          sourceCardId,
          creatureCardIds: selectedPowerCreatures(
            sourceCardId,
            "saddle"
          )
        },
        "Saddle ability placed on the stack."
      );
      return;
    }

    const auraChoice = event.target.closest("[data-v53-aura-choice]");
    if (auraChoice) {
      event.preventDefault();
      resolveAuraChoice(auraChoice.dataset.v53AuraChoice);
    }
  });

  const observer = new MutationObserver(() => {
    installButton();
    const form = document.getElementById("castCardForm");
    if (form) enhanceAuraForm(form);
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

  window.ArenaCommanderAttachmentsV53 = {
    version: VERSION,
    refresh: poll
  };
})();
