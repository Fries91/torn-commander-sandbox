(() => {
  "use strict";

  const VERSION = "50.0.0";
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

  function mechanicPresent(mechanics) {
    return Boolean(
      mechanics.casualty ||
      mechanics.bargain ||
      mechanics.cleave ||
      mechanics.entwine ||
      mechanics.escalate ||
      mechanics.splice ||
      mechanics.affinity ||
      mechanics.offering ||
      mechanics.emerge
    );
  }

  function candidateSelect(title, attribute, cards) {
    if (!cards?.length) return "";
    return `
      <label class="v50-select">
        <span>${escapeHtml(title)}</span>
        <select ${attribute}>
          <option value="">Do not use</option>
          ${cards
            .map(
              (card) =>
                `<option value="${escapeHtml(card.id)}">${escapeHtml(
                  cardName(card)
                )}</option>`
            )
            .join("")}
        </select>
      </label>
    `;
  }

  function spliceOptions(entries) {
    if (!entries?.length) return "";
    return `
      <fieldset class="v50-splice-list">
        <legend>Splice cards</legend>
        ${entries
          .map(
            (entry) => `
              <label>
                <input type="checkbox" data-v50-splice
                  value="${escapeHtml(entry.card.id)}">
                <span>${escapeHtml(cardName(entry.card))}</span>
                <small>${escapeHtml(entry.splice.manaCost)}</small>
              </label>
            `
          )
          .join("")}
      </fieldset>
    `;
  }

  function escalateDiscard(cards) {
    if (!cards?.length) return "";
    return `
      <fieldset class="v50-splice-list">
        <legend>Escalate discard cards</legend>
        ${cards
          .map(
            (card) => `
              <label>
                <input type="checkbox" data-v50-escalate-discard
                  value="${escapeHtml(card.id)}">
                <span>${escapeHtml(cardName(card))}</span>
              </label>
            `
          )
          .join("")}
      </fieldset>
    `;
  }

  async function enhanceCastForm(form) {
    if (form.dataset.v50Casting) return;
    form.dataset.v50Casting = "loading";

    const data = new FormData(form);
    try {
      const payload = await api("/api/casting-v50/preview", {
        cardId: data.get("cardId"),
        fromZone: data.get("fromZone") || "hand"
      });

      if (!mechanicPresent(payload.mechanics)) {
        form.dataset.v50Casting = "none";
        return;
      }

      const m = payload.mechanics;
      const c = payload.candidates;
      const panel = document.createElement("section");
      panel.className = "v50-casting-panel";
      panel.innerHTML = `
        <header>
          <div>
            <small>REMAINING CASTING MECHANICS</small>
            <strong>${escapeHtml(cardName(payload.card))}</strong>
          </div>
          <span>v50</span>
        </header>

        <div class="v50-toggle-grid">
          ${
            m.cleave
              ? `<label><input type="checkbox" data-v50-cleave>
                   Cleave ${escapeHtml(m.cleave.manaCost)}</label>`
              : ""
          }
          ${
            m.entwine
              ? `<label><input type="checkbox" data-v50-entwine>
                   Entwine ${escapeHtml(m.entwine.manaCost)}</label>`
              : ""
          }
          ${
            m.bargain
              ? `<span>Bargain available</span>`
              : ""
          }
          ${
            m.affinity
              ? `<span>Affinity reduction: ${payload.affinityReduction}</span>`
              : ""
          }
        </div>

        ${candidateSelect(
          m.casualty
            ? `Casualty ${m.casualty.minimumPower}`
            : "Casualty",
          "data-v50-casualty",
          c.casualty
        )}
        ${candidateSelect(
          "Bargain sacrifice",
          "data-v50-bargain",
          c.bargain
        )}
        ${candidateSelect(
          m.offering
            ? `${m.offering.subtype} offering`
            : "Offering",
          "data-v50-offering",
          c.offering
        )}
        ${candidateSelect(
          m.emerge
            ? `Emerge — sacrifice ${m.emerge.permanentType}`
            : "Emerge",
          "data-v50-emerge",
          c.emerge
        )}

        ${spliceOptions(c.splice)}
        ${
          m.escalate?.kind === "discard"
            ? escalateDiscard(c.escalateDiscard)
            : ""
        }

        <button type="button" class="v50-cast-button" data-v50-cast>
          <strong>Apply v50 mechanics, Auto-Tap & Cast</strong>
          <small>Costs are validated and paid by the server</small>
        </button>
      `;

      form.querySelector("button[type='submit']")?.before(panel);
      form.querySelector("[data-v42-autotap-panel]")?.classList.add(
        "v50-hide-base"
      );
      form.querySelector("[data-v46-mechanics-panel]")?.classList.add(
        "v50-hide-base"
      );
      form.dataset.v50Casting = "ready";
    } catch {
      form.dataset.v50Casting = "error";
    }
  }

  function selectedValues(form, selector) {
    return [...form.querySelectorAll(`${selector}:checked`)].map(
      (input) => input.value
    );
  }

  async function advancedCast(form, button) {
    const data = new FormData(form);
    const old = button.innerHTML;
    button.disabled = true;
    button.innerHTML =
      "<strong>Paying v50 costs…</strong><small>Server is validating every selection</small>";

    try {
      await api("/api/casting-v50/cast", {
        cardId: data.get("cardId"),
        fromZone: data.get("fromZone") || "hand",
        xValue: Number(data.get("xValue") || 0),
        targets: data.getAll("targets").map(String),
        modes: String(data.get("modes") || "")
          .split(/\s*;\s*|\n/)
          .filter(Boolean),
        cleave: Boolean(form.querySelector("[data-v50-cleave]:checked")),
        entwine: Boolean(form.querySelector("[data-v50-entwine]:checked")),
        casualtyCardId:
          form.querySelector("[data-v50-casualty]")?.value || "",
        bargainCardId:
          form.querySelector("[data-v50-bargain]")?.value || "",
        offeringCardId:
          form.querySelector("[data-v50-offering]")?.value || "",
        emergeCardId:
          form.querySelector("[data-v50-emerge]")?.value || "",
        spliceCardIds: selectedValues(form, "[data-v50-splice]"),
        escalateDiscardIds: selectedValues(
          form,
          "[data-v50-escalate-discard]"
        )
      });

      document
        .querySelector("#modalBackdrop [data-action='close-modal']")
        ?.click();
      toast("v50 casting mechanics applied.", "success");
    } catch (error) {
      button.disabled = false;
      button.innerHTML = old;
      toast(error.message || "Advanced cast failed.", "error");
    }
  }

  function installButton() {
    const actions = document.querySelector(
      ".arena-game-topbar .arena-top-actions"
    );
    if (!actions || document.getElementById("v50TimedButton")) return;

    const button = document.createElement("button");
    button.type = "button";
    button.id = "v50TimedButton";
    button.className = "arena-hotfix-control v50-timed-button";
    button.innerHTML =
      '<span>⌛</span><small>Timed</small><b data-v50-count>0</b>';
    actions.appendChild(button);
  }

  function timedCard(entry, kind) {
    const card = entry.card;
    return `
      <article class="v50-timed-card">
        ${
          cardImage(card)
            ? `<img src="${escapeHtml(cardImage(card))}" alt="">`
            : `<div class="v50-card-back">?</div>`
        }
        <strong>${escapeHtml(cardName(card))}</strong>
        <small>
          ${
            kind === "foretell"
              ? `${escapeHtml(entry.manaCost)} · ${
                  entry.available ? "Ready" : "Next turn"
                }`
              : `${entry.timeCounters} time counter${
                  entry.timeCounters === 1 ? "" : "s"
                }`
          }
        </small>
        <button type="button"
          data-v50-cast-timed="${escapeHtml(entry.id)}"
          data-v50-kind="${kind}"
          ${entry.available ? "" : "disabled"}>
          ${kind === "foretell" ? "Cast foretold card" : "Cast suspended card"}
        </button>
      </article>
    `;
  }

  function handAction(entry) {
    const card = entry.card;
    return `
      <article class="v50-hand-action">
        <strong>${escapeHtml(cardName(card))}</strong>
        <div>
          ${
            entry.foretell
              ? `<button type="button" data-v50-foretell="${escapeHtml(
                  card.id
                )}">Foretell for {2}</button>`
              : ""
          }
          ${
            entry.suspend
              ? `<button type="button" data-v50-suspend="${escapeHtml(
                  card.id
                )}">Suspend ${entry.suspend.timeCounters} — ${escapeHtml(
                  entry.suspend.manaCost
                )}</button>`
              : ""
          }
        </div>
      </article>
    `;
  }

  function showTimed() {
    document.getElementById("v50TimedSheet")?.remove();
    const overlay = document.createElement("div");
    overlay.id = "v50TimedSheet";
    overlay.className = "v50-timed-sheet";
    overlay.innerHTML = `
      <section>
        <header>
          <div><small>TIMED CASTING</small><h2>Foretell and Suspend</h2></div>
          <button type="button" data-v50-close>×</button>
        </header>

        <h3>Cards in hand</h3>
        <div class="v50-hand-list">
          ${(state?.handActions || []).map(handAction).join("") ||
            "<p>No Foretell or Suspend cards in hand.</p>"}
        </div>

        <h3>Foretold</h3>
        <div class="v50-timed-grid">
          ${(state?.foretold || [])
            .map((entry) => timedCard(entry, "foretell"))
            .join("") || "<p>No foretold cards.</p>"}
        </div>

        <h3>Suspended</h3>
        <div class="v50-timed-grid">
          ${(state?.suspended || [])
            .map((entry) => timedCard(entry, "suspend"))
            .join("") || "<p>No suspended cards.</p>"}
        </div>
      </section>
    `;
    document.body.appendChild(overlay);
  }

  async function timedAction(type, body) {
    try {
      await api("/api/casting-v50/action", { type, ...body });
      document.getElementById("v50TimedSheet")?.remove();
      toast("Timed casting action completed.", "success");
      setTimeout(poll, 40);
    } catch (error) {
      toast(error.message || "Timed casting action failed.", "error");
    }
  }

  function closeChoice() {
    document.getElementById("v50ChoiceOverlay")?.remove();
    activeChoiceId = "";
  }

  function choiceCandidates(choice) {
    if (choice.kind !== "exploit") return "";
    return `
      <label class="v50-choice-select">
        <span>Creature to sacrifice</span>
        <select data-v50-exploit-card>
          <option value="">Choose creature</option>
          ${(choice.candidates || [])
            .map(
              (card) =>
                `<option value="${escapeHtml(card.id)}">${escapeHtml(
                  cardName(card)
                )}</option>`
            )
            .join("")}
        </select>
      </label>
    `;
  }

  function renderChoice(choice) {
    if (!choice || choice.id === activeChoiceId) return;
    closeChoice();
    activeChoiceId = choice.id;

    const overlay = document.createElement("div");
    overlay.id = "v50ChoiceOverlay";
    overlay.className = "v50-choice-overlay";
    overlay.dataset.choiceId = choice.id;
    overlay.innerHTML = `
      <section>
        <small>${escapeHtml(choice.kind.toUpperCase())}</small>
        <h2>${escapeHtml(choice.cardName || choice.sourceName)}</h2>
        <p>${escapeHtml(choice.text)}</p>
        ${choiceCandidates(choice)}
        <div>
          <button type="button" data-v50-decline>Do not use</button>
          <button type="button" class="v50-use-choice" data-v50-use>
            ${
              choice.kind === "exploit"
                ? "Exploit creature"
                : `Cast for ${escapeHtml(choice.manaCost)}`
            }
          </button>
        </div>
      </section>
    `;
    document.body.appendChild(overlay);
  }

  async function resolveChoice(useAbility) {
    const overlay = document.getElementById("v50ChoiceOverlay");
    if (!overlay) return;
    overlay.querySelectorAll("button, select").forEach((element) => {
      element.disabled = true;
    });

    try {
      await api("/api/casting-v50/resolve", {
        choiceId: overlay.dataset.choiceId,
        useAbility,
        sacrificeCardId:
          overlay.querySelector("[data-v50-exploit-card]")?.value || ""
      });
      closeChoice();
      toast(
        useAbility ? "Casting choice accepted." : "Casting choice declined.",
        useAbility ? "success" : "warning"
      );
    } catch (error) {
      overlay.querySelectorAll("button, select").forEach((element) => {
        element.disabled = false;
      });
      toast(error.message || "Unable to resolve casting choice.", "error");
    }
  }

  function updateCount() {
    const count =
      (state?.foretold?.length || 0) +
      (state?.suspended?.length || 0);
    const badge = document.querySelector("[data-v50-count]");
    if (badge) badge.textContent = String(count);
  }

  async function poll() {
    clearTimeout(pollTimer);
    try {
      const [nextState, pending] = await Promise.all([
        api("/api/casting-v50/state"),
        api("/api/casting-v50/pending")
      ]);
      state = nextState;
      installButton();
      updateCount();

      if (pending.choice) renderChoice(pending.choice);
      else closeChoice();
    } catch {}

    pollTimer = setTimeout(poll, document.hidden ? 3800 : 1100);
  }

  document.addEventListener("click", (event) => {
    const cast = event.target.closest("[data-v50-cast]");
    if (cast) {
      event.preventDefault();
      advancedCast(cast.closest("#castCardForm"), cast);
      return;
    }

    if (event.target.closest("#v50TimedButton")) {
      event.preventDefault();
      showTimed();
      return;
    }

    if (event.target.closest("[data-v50-close]")) {
      event.preventDefault();
      document.getElementById("v50TimedSheet")?.remove();
      return;
    }

    const foretell = event.target.closest("[data-v50-foretell]");
    if (foretell) {
      event.preventDefault();
      timedAction("casting-v50-foretell", {
        cardId: foretell.dataset.v50Foretell
      });
      return;
    }

    const suspend = event.target.closest("[data-v50-suspend]");
    if (suspend) {
      event.preventDefault();
      timedAction("casting-v50-suspend", {
        cardId: suspend.dataset.v50Suspend
      });
      return;
    }

    const timed = event.target.closest("[data-v50-cast-timed]");
    if (timed) {
      event.preventDefault();
      timedAction("casting-v50-cast-timed", {
        entryId: timed.dataset.v50CastTimed,
        kind: timed.dataset.v50Kind
      });
      return;
    }

    if (event.target.closest("[data-v50-use]")) {
      event.preventDefault();
      resolveChoice(true);
      return;
    }

    if (event.target.closest("[data-v50-decline]")) {
      event.preventDefault();
      resolveChoice(false);
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

  window.ArenaCommanderCastingV50 = {
    version: VERSION,
    refresh: poll
  };
})();
