(() => {
  "use strict";

  const VERSION = "48.0.0";
  const SESSION_KEY = "tornCommander.session.v5";
  let pollTimer = null;
  let requestRunning = false;
  let activeKey = "";

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
    return clean(card?.cardData?.name || card?.name || "Triggered ability");
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
    if (!auth) throw new Error("No saved room session was found.");

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
      throw new Error(payload?.error || `Request failed with HTTP ${response.status}.`);
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
    window.setTimeout(() => element.remove(), 4300);
  }

  function closeOverlay() {
    document.getElementById("v48TriggerOverlay")?.remove();
    activeKey = "";
  }

  function triggerCard(trigger, index, total) {
    const image = cardImage(trigger.sourceCard);
    return `
      <article class="v48-trigger-card" data-v48-trigger-id="${escapeHtml(
        trigger.id
      )}">
        <div class="v48-trigger-order-number">${index + 1}</div>
        ${
          image
            ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(
                cardName(trigger.sourceCard)
              )}">`
            : `<div class="v48-trigger-card-back">♛</div>`
        }
        <div class="v48-trigger-copy">
          <small>${escapeHtml(trigger.sourceName)}</small>
          <strong>${escapeHtml(trigger.text)}</strong>
          <div class="v48-trigger-badges">
            ${trigger.optional ? "<span>MAY</span>" : "<span>MANDATORY</span>"}
            ${
              trigger.condition
                ? `<span>IF: ${escapeHtml(trigger.condition)}</span>`
                : ""
            }
            ${trigger.oncePerTurn ? "<span>ONCE/TURN</span>" : ""}
          </div>
          ${
            trigger.needsTargets
              ? `<div class="v48-target-box" data-v48-target-box="${escapeHtml(
                  trigger.id
                )}">
                   <small>Loading legal targets from v44…</small>
                 </div>`
              : ""
          }
        </div>
        <div class="v48-order-buttons">
          <button type="button" data-v48-up="${escapeHtml(trigger.id)}" ${
            index === 0 ? "disabled" : ""
          }>↑</button>
          <button type="button" data-v48-down="${escapeHtml(trigger.id)}" ${
            index === total - 1 ? "disabled" : ""
          }>↓</button>
        </div>
      </article>
    `;
  }

  async function loadTargets(trigger) {
    const box = document.querySelector(
      `[data-v48-target-box="${CSS.escape(String(trigger.id))}"]`
    );
    if (!box) return;

    try {
      const payload = await api("/api/target-rules/candidates", {
        triggerId: trigger.id,
        sourceCardId: trigger.sourceCardId,
        text: trigger.text
      });

      const specs = payload.specs || [];
      const minimum = specs.reduce(
        (sum, spec) => sum + (Number(spec.minimum) || 0),
        0
      );
      const maximum = specs.reduce(
        (sum, spec) => sum + (Number(spec.maximum) || 0),
        0
      );
      const candidates = [
        ...new Map(
          specs
            .flatMap((spec) => spec.candidates || [])
            .map((candidate) => [candidate.target, candidate])
        ).values()
      ];

      box.dataset.minimum = String(minimum);
      box.dataset.maximum = String(Math.max(maximum, 1));

      if (!candidates.length) {
        box.innerHTML =
          "<small>No legal target is currently available. Judge Mode may be required.</small>";
        return;
      }

      box.innerHTML = `
        <strong>Choose target${maximum === 1 ? "" : "s"}</strong>
        <div>
          ${candidates
            .map(
              (candidate) => `
                <label>
                  <input type="${
                    maximum === 1 ? "radio" : "checkbox"
                  }" name="v48-target-${escapeHtml(trigger.id)}"
                    value="${escapeHtml(candidate.target)}">
                  <span>${escapeHtml(candidate.name)}</span>
                  <small>${escapeHtml(candidate.kind)}</small>
                </label>
              `
            )
            .join("")}
        </div>
        <small>Required: ${minimum} · Maximum: ${Math.max(maximum, 1)}</small>
      `;
      updateConfirmState();
    } catch (error) {
      box.innerHTML = `<small>${escapeHtml(
        error.message || "Unable to load legal targets."
      )}</small>`;
    }
  }

  function renderOrdering(ordering) {
    const key = `order:${ordering.batchId}:${ordering.groupPlayerId}`;
    if (activeKey === key) return;
    closeOverlay();
    activeKey = key;

    const overlay = document.createElement("div");
    overlay.id = "v48TriggerOverlay";
    overlay.className = "v48-trigger-overlay";
    overlay.dataset.batchId = ordering.batchId;
    overlay.innerHTML = `
      <section class="v48-trigger-sheet">
        <header>
          <div>
            <small>APNAP TRIGGER ORDER</small>
            <h2>${escapeHtml(ordering.groupPlayerName)} — choose resolution order</h2>
          </div>
          <span>${ordering.apnapPosition} / ${ordering.apnapTotal}</span>
        </header>
        <p>
          Move the trigger you want to <strong>resolve first</strong> to the top.
          The server places them onto the stack in reverse order.
        </p>
        ${
          ordering.error
            ? `<div class="v48-trigger-error">${escapeHtml(ordering.error)}</div>`
            : ""
        }
        <div class="v48-trigger-list">
          ${ordering.triggers
            .map((trigger, index) =>
              triggerCard(trigger, index, ordering.triggers.length)
            )
            .join("")}
        </div>
        <footer>
          <button type="button" class="v48-confirm-order" data-v48-confirm disabled>
            Confirm trigger order
          </button>
        </footer>
      </section>
    `;
    document.body.appendChild(overlay);

    for (const trigger of ordering.triggers) {
      if (trigger.needsTargets) loadTargets(trigger);
    }
    updateOrderNumbers();
    updateConfirmState();
  }

  function renderMay(choice) {
    const key = `may:${choice.id}`;
    if (activeKey === key) return;
    closeOverlay();
    activeKey = key;

    const overlay = document.createElement("div");
    overlay.id = "v48TriggerOverlay";
    overlay.className = "v48-trigger-overlay";
    overlay.dataset.choiceId = choice.id;
    overlay.innerHTML = `
      <section class="v48-may-sheet">
        <small>OPTIONAL TRIGGER</small>
        <h2>${escapeHtml(choice.sourceName)}</h2>
        <p>${escapeHtml(choice.text)}</p>
        <div>
          <button type="button" data-v48-decline>Do not use ability</button>
          <button type="button" class="v48-use-trigger" data-v48-use>
            Use ability
          </button>
        </div>
      </section>
    `;
    document.body.appendChild(overlay);
  }

  function updateOrderNumbers() {
    const cards = [
      ...document.querySelectorAll(".v48-trigger-card")
    ];
    cards.forEach((card, index) => {
      card.querySelector(".v48-trigger-order-number").textContent = String(
        index + 1
      );
      const up = card.querySelector("[data-v48-up]");
      const down = card.querySelector("[data-v48-down]");
      if (up) up.disabled = index === 0;
      if (down) down.disabled = index === cards.length - 1;
    });
  }

  function targetSelectionValid(box) {
    const minimum = Number(box.dataset.minimum || 0);
    const maximum = Number(box.dataset.maximum || 1);
    const selected = box.querySelectorAll("input:checked").length;
    return selected >= minimum && selected <= maximum;
  }

  function updateConfirmState() {
    const button = document.querySelector("[data-v48-confirm]");
    if (!button) return;

    const boxes = [
      ...document.querySelectorAll(".v48-target-box")
    ];
    const loaded = boxes.every((box) => box.dataset.maximum);
    const valid = boxes.every(targetSelectionValid);
    button.disabled = !loaded || !valid;
  }

  function moveTrigger(triggerId, direction) {
    const card = document.querySelector(
      `.v48-trigger-card[data-v48-trigger-id="${CSS.escape(
        String(triggerId)
      )}"]`
    );
    if (!card) return;
    const sibling =
      direction === "up" ? card.previousElementSibling : card.nextElementSibling;
    if (!sibling) return;

    if (direction === "up") card.parentNode.insertBefore(card, sibling);
    else card.parentNode.insertBefore(sibling, card);
    updateOrderNumbers();
  }

  function targetsByTrigger() {
    const result = {};
    for (const card of document.querySelectorAll(".v48-trigger-card")) {
      const triggerId = card.dataset.v48TriggerId;
      result[triggerId] = [
        ...card.querySelectorAll(".v48-target-box input:checked")
      ].map((input) => input.value);
    }
    return result;
  }

  async function confirmOrder(button) {
    const overlay = document.getElementById("v48TriggerOverlay");
    if (!overlay) return;

    const orderedTriggerIds = [
      ...overlay.querySelectorAll(".v48-trigger-card")
    ].map((card) => card.dataset.v48TriggerId);

    button.disabled = true;
    try {
      await api("/api/triggers/order", {
        batchId: overlay.dataset.batchId,
        orderedTriggerIds,
        targetsByTrigger: targetsByTrigger()
      });
      closeOverlay();
      toast("Triggers were placed on the stack in APNAP order.", "success");
      window.setTimeout(poll, 40);
    } catch (error) {
      button.disabled = false;
      toast(error.message || "Unable to order those triggers.", "error");
    }
  }

  async function resolveMay(useAbility) {
    const overlay = document.getElementById("v48TriggerOverlay");
    if (!overlay) return;
    overlay.querySelectorAll("button").forEach((button) => {
      button.disabled = true;
    });

    try {
      await api("/api/triggers/may", {
        choiceId: overlay.dataset.choiceId,
        useAbility
      });
      closeOverlay();
      toast(
        useAbility ? "Optional trigger accepted." : "Optional trigger declined.",
        useAbility ? "success" : "warning"
      );
      window.setTimeout(poll, 40);
    } catch (error) {
      overlay.querySelectorAll("button").forEach((button) => {
        button.disabled = false;
      });
      toast(error.message || "Unable to resolve the optional trigger.", "error");
    }
  }

  async function poll() {
    window.clearTimeout(pollTimer);
    if (requestRunning) {
      pollTimer = window.setTimeout(poll, 500);
      return;
    }

    requestRunning = true;
    try {
      const payload = await api("/api/triggers/pending");
      if (payload.mayChoice) renderMay(payload.mayChoice);
      else if (payload.ordering) renderOrdering(payload.ordering);
      else closeOverlay();
    } catch {}
    finally {
      requestRunning = false;
      pollTimer = window.setTimeout(poll, document.hidden ? 3200 : 850);
    }
  }

  document.addEventListener("click", (event) => {
    const up = event.target.closest("[data-v48-up]");
    if (up) {
      event.preventDefault();
      moveTrigger(up.dataset.v48Up, "up");
      return;
    }

    const down = event.target.closest("[data-v48-down]");
    if (down) {
      event.preventDefault();
      moveTrigger(down.dataset.v48Down, "down");
      return;
    }

    const confirm = event.target.closest("[data-v48-confirm]");
    if (confirm) {
      event.preventDefault();
      confirmOrder(confirm);
      return;
    }

    if (event.target.closest("[data-v48-use]")) {
      event.preventDefault();
      resolveMay(true);
      return;
    }

    if (event.target.closest("[data-v48-decline]")) {
      event.preventDefault();
      resolveMay(false);
    }
  });

  document.addEventListener("change", (event) => {
    if (event.target.closest(".v48-target-box input")) updateConfirmState();
  });

  document.addEventListener("visibilitychange", () => {
    window.clearTimeout(pollTimer);
    pollTimer = window.setTimeout(poll, 40);
  });

  window.addEventListener("load", poll, { once: true });
  poll();

  window.ArenaCommanderTriggersV48 = {
    version: VERSION,
    refresh: poll
  };
})();
