(() => {
  "use strict";

  const VERSION = "44.0.0";
  const SESSION_KEY = "tornCommander.session.v5";
  let pollTimer = null;
  let activeWardId = "";
  let candidateTimer = null;

  function session() {
    try {
      const value = JSON.parse(localStorage.getItem(SESSION_KEY));
      return value?.roomCode && value?.playerId && value?.sessionToken ? value : null;
    } catch {
      return null;
    }
  }

  function clean(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function cardName(card) {
    return clean(card?.cardData?.name || card?.name || "Card");
  }

  function cardImage(card) {
    return card?.cardData?.imageUrl || card?.imageUrl || card?.cardData?.faces?.[0]?.imageUrl || "";
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
    const element = document.createElement("div");
    element.className = `toast ${type}`;
    element.textContent = message;
    region.appendChild(element);
    setTimeout(() => element.remove(), 4200);
  }

  function closeWard() {
    document.getElementById("v44WardOverlay")?.remove();
    activeWardId = "";
  }

  function optionCards(cards, name) {
    if (!cards?.length) return "";
    return `
      <label class="v44-choice-select">
        <span>${escapeHtml(name)}</span>
        <select data-v44-${name.toLowerCase().replace(/\s+/g, "-")}>
          <option value="">Choose a card</option>
          ${cards.map((card) => `<option value="${escapeHtml(card.id)}">${escapeHtml(cardName(card))}</option>`).join("")}
        </select>
      </label>
    `;
  }

  function renderWard(choice) {
    if (!choice || choice.id === activeWardId) return;
    activeWardId = choice.id;
    closeWard();
    activeWardId = choice.id;

    const overlay = document.createElement("div");
    overlay.id = "v44WardOverlay";
    overlay.className = "v44-ward-overlay";
    overlay.dataset.choiceId = choice.id;
    overlay.innerHTML = `
      <section>
        <header>
          <div><small>WARD TRIGGER</small><h2>Pay ward for ${escapeHtml(choice.target?.name || "target")}</h2></div>
          <span>STACK PAUSED</span>
        </header>
        <p><strong>${escapeHtml(choice.sourceName)}</strong> targeted this permanent.</p>
        <div class="v44-ward-cost">${escapeHtml(choice.cost?.raw || "Ward")}</div>
        ${optionCards(choice.paymentOptions?.hand, "Discard card")}
        ${optionCards(choice.paymentOptions?.battlefield, "Sacrifice permanent")}
        <div class="v44-ward-actions">
          <button type="button" data-v44-decline>Decline — counter spell/ability</button>
          <button type="button" class="v44-pay" data-v44-pay>Auto-pay ward</button>
        </div>
      </section>
    `;
    document.body.appendChild(overlay);
  }

  async function resolveWard(pay) {
    const overlay = document.getElementById("v44WardOverlay");
    if (!overlay) return;
    const buttons = overlay.querySelectorAll("button, select");
    buttons.forEach((element) => { element.disabled = true; });

    try {
      await api("/api/target-rules/resolve-ward", {
        choiceId: overlay.dataset.choiceId,
        pay,
        discardCardId: overlay.querySelector("[data-v44-discard-card]")?.value || "",
        sacrificeCardId: overlay.querySelector("[data-v44-sacrifice-permanent]")?.value || ""
      });
      closeWard();
      toast(pay ? "Ward paid." : "Ward declined; the stack item was countered.", pay ? "success" : "warning");
    } catch (error) {
      buttons.forEach((element) => { element.disabled = false; });
      toast(error.message || "Unable to resolve ward.", "error");
    }
  }

  async function pollWard() {
    clearTimeout(pollTimer);
    try {
      const payload = await api("/api/target-rules/pending");
      const choice = payload.choices?.[0];
      if (choice) renderWard(choice);
      else closeWard();
    } catch {}
    pollTimer = setTimeout(pollWard, document.hidden ? 3000 : 900);
  }

  function formAction(form) {
    const data = new FormData(form);
    return {
      cardId: data.get("cardId"),
      sourceCardId: data.get("sourceCardId"),
      fromZone: data.get("fromZone"),
      text: data.get("text") || ""
    };
  }

  async function enhanceTargets(form) {
    const inputs = [...form.querySelectorAll("input[name='targets']")];
    if (!inputs.length || form.dataset.v44Targets === "loading") return;
    form.dataset.v44Targets = "loading";

    try {
      const payload = await api("/api/target-rules/candidates", formAction(form));
      const legal = new Set(
        (payload.specs || []).flatMap((spec) => spec.candidates || []).map((entry) => entry.target)
      );
      for (const input of inputs) {
        const target = String(input.value || "");
        const allowed = legal.has(target);
        input.disabled = !allowed;
        input.closest("label")?.classList.toggle("v44-illegal-target", !allowed);
      }
      form.dataset.v44Targets = "ready";
    } catch {
      form.dataset.v44Targets = "error";
    }
  }

  function scanForms() {
    clearTimeout(candidateTimer);
    candidateTimer = setTimeout(() => {
      for (const form of document.querySelectorAll("#castCardForm, [data-target-form]")) {
        enhanceTargets(form);
      }
    }, 80);
  }

  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-v44-pay]")) {
      event.preventDefault();
      resolveWard(true);
    }
    if (event.target.closest("[data-v44-decline]")) {
      event.preventDefault();
      resolveWard(false);
    }
  });

  const observer = new MutationObserver(scanForms);
  const modalBody = document.getElementById("modalBody");
  if (modalBody) observer.observe(modalBody, { childList: true, subtree: true });

  document.addEventListener("visibilitychange", pollWard);
  window.addEventListener("load", () => {
    scanForms();
    pollWard();
  }, { once: true });
  pollWard();

  window.ArenaCommanderTargetingV44 = { version: VERSION, refresh: scanForms };
})();
