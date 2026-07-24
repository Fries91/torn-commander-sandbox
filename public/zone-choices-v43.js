(() => {
  "use strict";

  const VERSION = "43.0.0";
  const SESSION_KEY = "tornCommander.session.v5";
  const POLL_VISIBLE_MS = 900;
  const POLL_HIDDEN_MS = 3000;

  let pollTimer = null;
  let requestRunning = false;
  let currentChoiceId = "";
  let currentChoice = null;
  let placement = new Map();

  function readSession() {
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

  function cardImage(card) {
    return (
      card?.cardData?.imageUrl ||
      card?.imageUrl ||
      card?.cardData?.faces?.[0]?.imageUrl ||
      ""
    );
  }

  function cardName(card) {
    return clean(card?.cardData?.name || card?.name || "Card");
  }

  function cardType(card) {
    return clean(card?.cardData?.typeLine || card?.typeLine || "");
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

  function destinationLabel(destination) {
    return {
      hand: "hand",
      battlefield: "battlefield",
      graveyard: "graveyard",
      exile: "exile",
      "library-top": "top of library",
      "library-bottom": "bottom of library"
    }[destination] || destination;
  }

  async function api(path, body) {
    const session = readSession();
    if (!session) throw new Error("No saved game session was found.");

    const response = await fetch(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      cache: "no-store",
      body: JSON.stringify({ ...session, ...body })
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.success) {
      throw new Error(payload?.error || `Request failed with HTTP ${response.status}.`);
    }
    return payload;
  }

  function closeOverlay() {
    const overlay = document.getElementById("arenaTargetChooser");
    if (overlay?.dataset.zoneChoice === "43") overlay.remove();
    currentChoiceId = "";
    currentChoice = null;
    placement = new Map();
  }

  function cardTile(card, options = {}) {
    const id = escapeHtml(card.id);
    const image = cardImage(card);
    const eligible = options.eligible !== false;

    return `
      <article class="v43-card-tile ${eligible ? "" : "is-ineligible"}" data-v43-card-id="${id}">
        <button type="button" class="v43-card-select" data-v43-select="${id}" ${
          eligible ? "" : "disabled"
        }>
          ${
            image
              ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(cardName(card))}">`
              : `<div class="v43-card-back">♛</div>`
          }
          <span class="v43-card-check">✓</span>
        </button>
        <strong>${escapeHtml(cardName(card))}</strong>
        <small>${escapeHtml(cardType(card))}</small>
      </article>
    `;
  }

  function searchMarkup(choice) {
    const eligible = new Set(choice.eligibleCardIds || []);
    return `
      <div class="v43-search-tools">
        <input type="search" data-v43-filter placeholder="Filter card names or types">
        <span data-v43-selection-count>0 / ${choice.maximum}</span>
      </div>
      <div class="v43-card-grid">
        ${(choice.cards || [])
          .map((card) => cardTile(card, { eligible: eligible.has(card.id) }))
          .join("")}
      </div>
      <footer class="v43-choice-footer">
        ${
          choice.minimum === 0
            ? `<button type="button" class="v43-secondary" data-v43-choose-none>Choose none</button>`
            : ""
        }
        <button type="button" class="v43-confirm" data-v43-confirm-selection disabled>
          Put selected card${choice.maximum === 1 ? "" : "s"} into ${escapeHtml(
            destinationLabel(choice.destination)
          )}
        </button>
      </footer>
    `;
  }

  function placementLabel(choice, value) {
    if (choice.kind === "scry") return value === "bottom" ? "Bottom" : "Top";
    if (choice.kind === "surveil") return value === "graveyard" ? "Graveyard" : "Top";
    return value;
  }

  function orderedCards(choice, zone) {
    return (choice.cards || []).filter((card) => placement.get(card.id) === zone);
  }

  function reorderCard(cardId, direction) {
    const choice = currentChoice;
    const zone = placement.get(cardId);
    const cards = orderedCards(choice, zone);
    const index = cards.findIndex((card) => card.id === cardId);
    const target = direction === "up" ? index - 1 : index + 1;
    if (index < 0 || target < 0 || target >= cards.length) return;

    const ids = cards.map((card) => card.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];

    const all = [...choice.cards];
    const reordered = [];
    for (const card of all) {
      if (placement.get(card.id) !== zone) reordered.push(card);
    }

    const zoneCards = ids.map((id) => all.find((card) => card.id === id));
    choice.cards = [
      ...zoneCards,
      ...reordered
    ];
    renderChoice(choice, true);
  }

  function orderingMarkup(choice) {
    const firstZone = "top";
    const secondZone = choice.kind === "surveil" ? "graveyard" : "bottom";

    const column = (zone) => `
      <section class="v43-order-column" data-v43-zone="${zone}">
        <h3>${placementLabel(choice, zone)}</h3>
        <div>
          ${orderedCards(choice, zone)
            .map(
              (card) => `
                <article class="v43-order-card" data-v43-card-id="${escapeHtml(card.id)}">
                  ${
                    cardImage(card)
                      ? `<img src="${escapeHtml(cardImage(card))}" alt="${escapeHtml(cardName(card))}">`
                      : `<div class="v43-card-back">♛</div>`
                  }
                  <strong>${escapeHtml(cardName(card))}</strong>
                  <div>
                    <button type="button" data-v43-order-up="${escapeHtml(card.id)}">↑</button>
                    <button type="button" data-v43-order-down="${escapeHtml(card.id)}">↓</button>
                    <button type="button" data-v43-move-zone="${escapeHtml(card.id)}" data-v43-destination="${
                      zone === firstZone ? secondZone : firstZone
                    }">
                      ${zone === firstZone ? placementLabel(choice, secondZone) : "Top"}
                    </button>
                  </div>
                </article>
              `
            )
            .join("") || `<p class="v43-empty-column">No cards here.</p>`}
        </div>
      </section>
    `;

    return `
      <div class="v43-order-grid">
        ${column(firstZone)}
        ${column(secondZone)}
      </div>
      <footer class="v43-choice-footer">
        <button type="button" class="v43-confirm" data-v43-confirm-order>
          Confirm ${choice.kind}
        </button>
      </footer>
    `;
  }

  function renderChoice(choice, preservePlacement = false) {
    currentChoice = choice;
    currentChoiceId = choice.id;

    if (!preservePlacement) {
      placement = new Map();
      if (choice.kind === "scry" || choice.kind === "surveil") {
        for (const card of choice.cards || []) placement.set(card.id, "top");
      }
    }

    let overlay = document.getElementById("arenaTargetChooser");
    if (overlay && overlay.dataset.zoneChoice !== "43") return;

    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "arenaTargetChooser";
      overlay.className = "v43-zone-choice-overlay";
      overlay.dataset.zoneChoice = "43";
      document.body.appendChild(overlay);
    }

    const body =
      choice.kind === "scry" || choice.kind === "surveil"
        ? orderingMarkup(choice)
        : searchMarkup(choice);

    overlay.innerHTML = `
      <section class="v43-zone-choice-sheet">
        <header>
          <div>
            <small>${escapeHtml(choice.sourceName || "Card effect")}</small>
            <h2>${escapeHtml(choice.prompt || "Choose cards")}</h2>
          </div>
          <span class="v43-private-badge">PRIVATE</span>
        </header>
        ${
          choice.notes
            ? `<p class="v43-choice-notes">${escapeHtml(choice.notes)}</p>`
            : ""
        }
        ${body}
      </section>
    `;
    document.body.classList.add("v43-choice-open");
  }

  function selectedIds() {
    return [...document.querySelectorAll(".v43-card-tile.is-selected")]
      .map((tile) => tile.dataset.v43CardId)
      .filter(Boolean);
  }

  function updateSelectionState() {
    if (!currentChoice) return;
    const selected = selectedIds();
    const counter = document.querySelector("[data-v43-selection-count]");
    if (counter) counter.textContent = `${selected.length} / ${currentChoice.maximum}`;

    const confirm = document.querySelector("[data-v43-confirm-selection]");
    if (confirm) {
      confirm.disabled =
        selected.length < currentChoice.minimum ||
        selected.length > currentChoice.maximum;
    }
  }

  async function resolveCurrent(resolution) {
    if (!currentChoiceId) return;
    const buttons = document.querySelectorAll(
      "#arenaTargetChooser button, #arenaTargetChooser input"
    );
    buttons.forEach((button) => {
      button.disabled = true;
    });

    try {
      const payload = await api("/api/zone-choices/resolve", {
        choiceId: currentChoiceId,
        resolution
      });

      closeOverlay();
      document.body.classList.remove("v43-choice-open");
      toast("Card choice completed.", "success");

      if (payload.choices?.length) renderChoice(payload.choices[0]);
    } catch (error) {
      buttons.forEach((button) => {
        button.disabled = false;
      });
      toast(error?.message || "Unable to complete that card choice.", "error");
    }
  }

  async function poll() {
    window.clearTimeout(pollTimer);
    const session = readSession();

    if (!session) {
      closeOverlay();
      pollTimer = window.setTimeout(poll, 3000);
      return;
    }

    if (requestRunning) {
      pollTimer = window.setTimeout(
        poll,
        document.hidden ? POLL_HIDDEN_MS : POLL_VISIBLE_MS
      );
      return;
    }

    requestRunning = true;
    try {
      const payload = await api("/api/zone-choices/pending", {});
      const choice = payload.choices?.[0];

      if (choice) {
        if (choice.id !== currentChoiceId) renderChoice(choice);
      } else if (currentChoiceId) {
        closeOverlay();
        document.body.classList.remove("v43-choice-open");
      }
    } catch (error) {
      if (!/session|room/i.test(error?.message || "")) {
        console.warn("Arena Commander zone-choice poll:", error);
      }
    } finally {
      requestRunning = false;
      pollTimer = window.setTimeout(
        poll,
        document.hidden ? POLL_HIDDEN_MS : POLL_VISIBLE_MS
      );
    }
  }

  document.addEventListener("click", (event) => {
    const select = event.target.closest("[data-v43-select]");
    if (select && currentChoice) {
      event.preventDefault();
      const tile = select.closest(".v43-card-tile");
      const selected = selectedIds();
      const already = tile.classList.contains("is-selected");

      if (!already && selected.length >= currentChoice.maximum) {
        toast(`Choose no more than ${currentChoice.maximum}.`, "warning");
        return;
      }

      tile.classList.toggle("is-selected");
      updateSelectionState();
      return;
    }

    if (event.target.closest("[data-v43-choose-none]")) {
      event.preventDefault();
      resolveCurrent({
        selectedCardIds: [],
        orderedRestCardIds: currentChoice?.cardIds || []
      });
      return;
    }

    if (event.target.closest("[data-v43-confirm-selection]")) {
      event.preventDefault();
      const selected = selectedIds();
      resolveCurrent({
        selectedCardIds: selected,
        orderedRestCardIds: (currentChoice?.cardIds || []).filter(
          (id) => !selected.includes(id)
        )
      });
      return;
    }

    const move = event.target.closest("[data-v43-move-zone]");
    if (move && currentChoice) {
      event.preventDefault();
      placement.set(move.dataset.v43MoveZone, move.dataset.v43Destination);
      renderChoice(currentChoice, true);
      return;
    }

    const up = event.target.closest("[data-v43-order-up]");
    if (up) {
      event.preventDefault();
      reorderCard(up.dataset.v43OrderUp, "up");
      return;
    }

    const down = event.target.closest("[data-v43-order-down]");
    if (down) {
      event.preventDefault();
      reorderCard(down.dataset.v43OrderDown, "down");
      return;
    }

    if (event.target.closest("[data-v43-confirm-order]") && currentChoice) {
      event.preventDefault();
      const topCardIds = orderedCards(currentChoice, "top").map((card) => card.id);

      if (currentChoice.kind === "scry") {
        resolveCurrent({
          topCardIds,
          bottomCardIds: orderedCards(currentChoice, "bottom").map((card) => card.id)
        });
      } else {
        resolveCurrent({
          topCardIds,
          graveyardCardIds: orderedCards(currentChoice, "graveyard").map(
            (card) => card.id
          )
        });
      }
    }
  });

  document.addEventListener("input", (event) => {
    const filter = event.target.closest("[data-v43-filter]");
    if (!filter) return;
    const query = clean(filter.value).toLocaleLowerCase("en-US");

    for (const tile of document.querySelectorAll(".v43-card-tile")) {
      const text = clean(tile.textContent).toLocaleLowerCase("en-US");
      tile.hidden = query && !text.includes(query);
    }
  });

  document.addEventListener("visibilitychange", () => {
    window.clearTimeout(pollTimer);
    pollTimer = window.setTimeout(poll, 50);
  });

  window.addEventListener("load", poll, { once: true });
  poll();

  window.ArenaCommanderZoneChoicesV43 = {
    version: VERSION,
    refresh: poll
  };
})();
