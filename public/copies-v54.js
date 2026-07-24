(() => {
  "use strict";

  const VERSION = "54.0.0";
  const SESSION_KEY = "tornCommander.session.v5";
  let state = null;
  let pollTimer = null;
  let activeChoiceId = "";

  function session() {
    try {
      const value = JSON.parse(
        localStorage.getItem(SESSION_KEY)
      );
      return value?.roomCode &&
        value?.playerId &&
        value?.sessionToken
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
    return String(
      card?.cardData?.name ||
      card?.name ||
      "Card"
    ).trim();
  }

  function cardImage(card) {
    return (
      card?.cardData?.imageUrl ||
      card?.imageUrl ||
      card?.cardData?.faces?.[
        card?.activeFaceIndex || 0
      ]?.imageUrl ||
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
      body: JSON.stringify({
        ...auth,
        ...body
      })
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.success) {
      throw new Error(
        payload?.error || `HTTP ${response.status}`
      );
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
    if (!actions || document.getElementById("v54CopyButton")) {
      return;
    }

    const button = document.createElement("button");
    button.type = "button";
    button.id = "v54CopyButton";
    button.className =
      "arena-hotfix-control v54-copy-button";
    button.innerHTML =
      '<span>⧉</span><small>Copies</small><b data-v54-count>0</b>';
    actions.appendChild(button);
  }

  function permanentOptions() {
    return (state?.permanents || [])
      .map(
        (entry) =>
          `<option value="${escapeHtml(
            entry.card.id
          )}">${escapeHtml(cardName(entry.card))} — ${escapeHtml(
            entry.playerName
          )}</option>`
      )
      .join("");
  }

  function controlledOptions() {
    return (state?.controlledPermanents || [])
      .map(
        (entry) =>
          `<option value="${escapeHtml(
            entry.card.id
          )}">${escapeHtml(cardName(entry.card))}${
            entry.isCopy ? " — copy" : ""
          }</option>`
      )
      .join("");
  }

  function stackOptions() {
    return (state?.stack || [])
      .map(
        (entry) =>
          `<option value="${escapeHtml(
            entry.id
          )}">${escapeHtml(entry.name)} — ${escapeHtml(
            entry.kind
          )}${entry.permanentSpell ? " · permanent" : ""}</option>`
      )
      .join("");
  }

  function modifierFields(prefix) {
    return `
      <details class="v54-modifiers">
        <summary>Copy modifications</summary>

        <label>
          <input type="checkbox" data-v54-${prefix}-nonlegendary>
          Copy isn't legendary
        </label>

        <label>
          <input type="checkbox" data-v54-${prefix}-artifact>
          Artifact in addition
        </label>

        <label>
          <input type="checkbox" data-v54-${prefix}-creature>
          Creature in addition
        </label>

        <div>
          <input type="text" maxlength="12"
            placeholder="Power"
            data-v54-${prefix}-power>
          <input type="text" maxlength="12"
            placeholder="Toughness"
            data-v54-${prefix}-toughness>
        </div>

        <input type="text" maxlength="150"
          placeholder="Optional copied name"
          data-v54-${prefix}-name>

        <input type="text" maxlength="240"
          placeholder="Keywords separated by commas"
          data-v54-${prefix}-keywords>
      </details>
    `;
  }

  function readModifiers(prefix, root) {
    return {
      nonlegendary: Boolean(
        root.querySelector(
          `[data-v54-${prefix}-nonlegendary]`
        )?.checked
      ),
      addArtifact: Boolean(
        root.querySelector(
          `[data-v54-${prefix}-artifact]`
        )?.checked
      ),
      addCreature: Boolean(
        root.querySelector(
          `[data-v54-${prefix}-creature]`
        )?.checked
      ),
      power:
        root.querySelector(
          `[data-v54-${prefix}-power]`
        )?.value || "",
      toughness:
        root.querySelector(
          `[data-v54-${prefix}-toughness]`
        )?.value || "",
      name:
        root.querySelector(
          `[data-v54-${prefix}-name]`
        )?.value || "",
      addKeywords: String(
        root.querySelector(
          `[data-v54-${prefix}-keywords]`
        )?.value || ""
      )
        .split(/\s*,\s*/)
        .filter(Boolean)
    };
  }

  function showSheet() {
    document.getElementById("v54CopySheet")?.remove();

    const overlay = document.createElement("div");
    overlay.id = "v54CopySheet";
    overlay.className = "v54-copy-sheet";
    overlay.innerHTML = `
      <section>
        <header>
          <div>
            <small>COPIES, CLONES & COPYABLE VALUES</small>
            <h2>Copy control</h2>
          </div>
          <button type="button" data-v54-close>×</button>
        </header>

        <div class="v54-copy-grid">
          <article data-v54-panel="token">
            <h3>Create token copy</h3>
            <select data-v54-token-source>
              <option value="">Choose permanent</option>
              ${permanentOptions()}
            </select>
            ${modifierFields("token")}
            <button type="button" data-v54-token-copy>
              Create token copy
            </button>
          </article>

          <article data-v54-panel="become">
            <h3>Become a copy</h3>
            <select data-v54-copy-object>
              <option value="">Your permanent</option>
              ${controlledOptions()}
            </select>
            <select data-v54-copy-source>
              <option value="">Permanent to copy</option>
              ${permanentOptions()}
            </select>
            ${modifierFields("become")}
            <button type="button" data-v54-become-copy>
              Become copy
            </button>
          </article>

          <article data-v54-panel="stack">
            <h3>Copy spell or ability</h3>
            <select data-v54-stack-source>
              <option value="">Stack item</option>
              ${stackOptions()}
            </select>
            <textarea data-v54-new-targets
              placeholder="Optional new target keys, one per line. Example: card:ID or player:ID"></textarea>
            <button type="button" data-v54-stack-copy>
              Copy stack item
            </button>
          </article>

          <article data-v54-panel="restore">
            <h3>Restore original values</h3>
            <select data-v54-restore-card>
              <option value="">Choose copied permanent</option>
              ${(state?.controlledPermanents || [])
                .filter((entry) => entry.canRestore)
                .map(
                  (entry) =>
                    `<option value="${escapeHtml(
                      entry.card.id
                    )}">${escapeHtml(cardName(entry.card))}</option>`
                )
                .join("")}
            </select>
            <button type="button" data-v54-restore>
              Restore original copyable values
            </button>
          </article>
        </div>

        <h3>Current copied permanents</h3>
        <div class="v54-current-grid">
          ${(state?.permanents || [])
            .filter((entry) => entry.isCopy)
            .map(
              (entry) => `
                <article>
                  ${
                    cardImage(entry.card)
                      ? `<img src="${escapeHtml(
                          cardImage(entry.card)
                        )}" alt="">`
                      : '<div class="v54-card-back">⧉</div>'
                  }
                  <strong>${escapeHtml(cardName(entry.card))}</strong>
                  <small>${escapeHtml(entry.playerName)}</small>
                  <span>${escapeHtml(
                    (entry.blueprintModifications || []).join(" · ") ||
                    "Unmodified copy"
                  )}</span>
                </article>
              `
            )
            .join("") || "<p>No copied permanents are currently tracked.</p>"}
        </div>
      </section>
    `;
    document.body.appendChild(overlay);
  }

  async function runAction(body, message) {
    try {
      await api("/api/copies-v54/action", body);
      document.getElementById("v54CopySheet")?.remove();
      toast(message, "success");
      setTimeout(poll, 40);
    } catch (error) {
      toast(error.message || "Copy action failed.", "error");
    }
  }

  function closeCloneChoice() {
    document.getElementById("v54CloneOverlay")?.remove();
    activeChoiceId = "";
  }

  function renderCloneChoice(choice) {
    if (!choice || choice.id === activeChoiceId) return;
    closeCloneChoice();
    activeChoiceId = choice.id;

    const overlay = document.createElement("div");
    overlay.id = "v54CloneOverlay";
    overlay.className = "v54-clone-overlay";
    overlay.dataset.choiceId = choice.id;
    overlay.innerHTML = `
      <section>
        <small>ENTERS AS A COPY</small>
        <h2>${escapeHtml(choice.sourceName)}</h2>
        <p>
          Choose the permanent whose copyable values this spell
          will have as it resolves.
        </p>

        <div class="v54-clone-grid">
          ${(choice.candidates || [])
            .map(
              (entry) => `
                <button type="button"
                  data-v54-clone-source="${escapeHtml(entry.card.id)}">
                  ${
                    cardImage(entry.card)
                      ? `<img src="${escapeHtml(
                          cardImage(entry.card)
                        )}" alt="">`
                      : '<div class="v54-card-back">⧉</div>'
                  }
                  <strong>${escapeHtml(cardName(entry.card))}</strong>
                  <small>${escapeHtml(entry.playerName)}</small>
                </button>
              `
            )
            .join("")}
        </div>

        ${
          choice.optional
            ? `<button type="button"
                 class="v54-skip-copy"
                 data-v54-skip-clone>
                 Enter without copying
               </button>`
            : ""
        }
      </section>
    `;
    document.body.appendChild(overlay);
  }

  async function resolveClone(body) {
    const overlay = document.getElementById("v54CloneOverlay");
    if (!overlay) return;

    overlay.querySelectorAll("button").forEach((button) => {
      button.disabled = true;
    });

    try {
      await api("/api/copies-v54/resolve-clone", {
        choiceId: overlay.dataset.choiceId,
        ...body
      });
      closeCloneChoice();
      toast("Clone copyable values selected.", "success");
      setTimeout(poll, 40);
    } catch (error) {
      overlay.querySelectorAll("button").forEach((button) => {
        button.disabled = false;
      });
      toast(error.message || "Unable to resolve Clone.", "error");
    }
  }

  function updateBadge() {
    const badge = document.querySelector("[data-v54-count]");
    if (badge) {
      badge.textContent = String(
        (state?.permanents || []).filter(
          (entry) => entry.isCopy
        ).length +
        (state?.stack || []).filter(
          (entry) => entry.isCopy
        ).length
      );
    }
  }

  async function poll() {
    clearTimeout(pollTimer);

    try {
      const [nextState, pending] = await Promise.all([
        api("/api/copies-v54/state"),
        api("/api/copies-v54/pending")
      ]);

      state = nextState;
      installButton();
      updateBadge();

      if (pending.choice) renderCloneChoice(pending.choice);
      else closeCloneChoice();
    } catch {}

    pollTimer = setTimeout(
      poll,
      document.hidden ? 3800 : 1100
    );
  }

  document.addEventListener("click", (event) => {
    if (event.target.closest("#v54CopyButton")) {
      event.preventDefault();
      showSheet();
      return;
    }

    if (event.target.closest("[data-v54-close]")) {
      event.preventDefault();
      document.getElementById("v54CopySheet")?.remove();
      return;
    }

    if (event.target.closest("[data-v54-token-copy]")) {
      event.preventDefault();
      const panel = event.target.closest("[data-v54-panel]");
      runAction(
        {
          type: "copies-v54-token-copy",
          sourceCardId:
            panel.querySelector("[data-v54-token-source]")?.value || "",
          modifiers: readModifiers("token", panel)
        },
        "Token copy created."
      );
      return;
    }

    if (event.target.closest("[data-v54-become-copy]")) {
      event.preventDefault();
      const panel = event.target.closest("[data-v54-panel]");
      runAction(
        {
          type: "copies-v54-become-copy",
          copyCardId:
            panel.querySelector("[data-v54-copy-object]")?.value || "",
          sourceCardId:
            panel.querySelector("[data-v54-copy-source]")?.value || "",
          modifiers: readModifiers("become", panel)
        },
        "Permanent became a copy."
      );
      return;
    }

    if (event.target.closest("[data-v54-stack-copy]")) {
      event.preventDefault();
      const panel = event.target.closest("[data-v54-panel]");
      const targets = String(
        panel.querySelector("[data-v54-new-targets]")?.value || ""
      )
        .split(/\n+/)
        .map((entry) => entry.trim())
        .filter(Boolean);

      runAction(
        {
          type: "copies-v54-stack-copy",
          stackItemId:
            panel.querySelector("[data-v54-stack-source]")?.value || "",
          targets
        },
        "Spell or ability copied."
      );
      return;
    }

    if (event.target.closest("[data-v54-restore]")) {
      event.preventDefault();
      const panel = event.target.closest("[data-v54-panel]");
      runAction(
        {
          type: "copies-v54-restore",
          cardId:
            panel.querySelector("[data-v54-restore-card]")?.value || ""
        },
        "Original copyable values restored."
      );
      return;
    }

    const cloneSource = event.target.closest(
      "[data-v54-clone-source]"
    );
    if (cloneSource) {
      event.preventDefault();
      resolveClone({
        sourceCardId: cloneSource.dataset.v54CloneSource,
        skip: false
      });
      return;
    }

    if (event.target.closest("[data-v54-skip-clone]")) {
      event.preventDefault();
      resolveClone({
        sourceCardId: "",
        skip: true
      });
    }
  });

  const observer = new MutationObserver(installButton);
  const app = document.getElementById("app");
  if (app) {
    observer.observe(app, {
      childList: true,
      subtree: true
    });
  }

  document.addEventListener("visibilitychange", poll);
  window.addEventListener("load", poll, { once: true });
  poll();

  window.ArenaCommanderCopiesV54 = {
    version: VERSION,
    refresh: poll
  };
})();
