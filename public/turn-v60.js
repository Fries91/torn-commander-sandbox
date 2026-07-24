(() => {
  "use strict";

  const VERSION = "60.0.0";
  const SESSION_KEY =
    "tornCommander.session.v5";

  let state = null;
  let pollTimer = null;

  function session() {
    try {
      const value = JSON.parse(
        localStorage.getItem(
          SESSION_KEY
        )
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

  async function api(path, body = {}) {
    const auth = session();
    if (!auth) {
      throw new Error(
        "No saved room session."
      );
    }

    const response = await fetch(path, {
      method: "POST",
      headers: {
        "Content-Type":
          "application/json",
        Accept: "application/json"
      },
      cache: "no-store",
      body: JSON.stringify({
        ...auth,
        ...body
      })
    });

    const payload =
      await response
        .json()
        .catch(() => null);

    if (
      !response.ok ||
      !payload?.success
    ) {
      throw new Error(
        payload?.error ||
        `HTTP ${response.status}`
      );
    }

    return payload;
  }

  function toast(
    message,
    type = "info"
  ) {
    const region =
      document.getElementById(
        "toastRegion"
      );
    if (!region) return;

    const item =
      document.createElement("div");
    item.className =
      `toast ${type}`;
    item.textContent = message;
    region.appendChild(item);

    setTimeout(
      () => item.remove(),
      4300
    );
  }

  function installButton() {
    const actions =
      document.querySelector(
        ".arena-game-topbar .arena-top-actions"
      );

    if (
      !actions ||
      document.getElementById(
        "v60TurnButton"
      )
    ) {
      return;
    }

    const button =
      document.createElement("button");
    button.type = "button";
    button.id =
      "v60TurnButton";
    button.className =
      "arena-hotfix-control v60-turn-button";
    button.innerHTML =
      '<span>⟳</span><small>Turns</small><b data-v60-count>0</b>';
    actions.appendChild(button);
  }

  function playerOptions() {
    return `
      <option value="">
        Choose player
      </option>
      ${(state?.players || [])
        .filter((player) => player.active)
        .map(
          (player) => `
            <option value="${escapeHtml(
              player.playerId
            )}">
              ${escapeHtml(
                player.playerName
              )}
              ${
                player.skippedTurns
                  ? ` — skips ${player.skippedTurns}`
                  : ""
              }
            </option>
          `
        )
        .join("")}
    `;
  }

  function orderCard(entry, index) {
    return `
      <article class="v60-order-card ${
        entry.playerId ===
          state?.activePlayerId
          ? "active"
          : ""
      }">
        <span>${index + 1}</span>
        <strong>${escapeHtml(
          entry.playerName
        )}</strong>
        ${
          entry.playerId ===
            state?.activePlayerId
            ? "<small>ACTIVE</small>"
            : ""
        }
      </article>
    `;
  }

  function extraTurnCard(entry) {
    return `
      <article class="v60-queue-card">
        <strong>${escapeHtml(
          entry.playerName
        )}</strong>
        <span>Extra turn</span>
        <small>${escapeHtml(
          entry.sourceName
        )}</small>
      </article>
    `;
  }

  function phaseCard(entry) {
    return `
      <article class="v60-queue-card">
        <strong>${escapeHtml(
          entry.playerName
        )}</strong>
        <span>
          ${escapeHtml(
            entry.kind.replace("-", " ")
          )}
          after
          ${escapeHtml(
            entry.anchorPhaseName
          )}
        </span>
        <small>${escapeHtml(
          entry.sourceName
        )}</small>
      </article>
    `;
  }

  function skippedPhaseCard(entry) {
    return `
      <article class="v60-queue-card danger">
        <strong>${escapeHtml(
          entry.playerName
        )}</strong>
        <span>
          Skip ${escapeHtml(
            entry.phaseName
          )}
        </span>
        <small>${escapeHtml(
          entry.sourceName
        )}</small>
      </article>
    `;
  }

  function showSheet() {
    document.getElementById(
      "v60TurnSheet"
    )?.remove();

    const overlay =
      document.createElement("div");
    overlay.id =
      "v60TurnSheet";
    overlay.className =
      "v60-turn-sheet";

    overlay.innerHTML = `
      <section>
        <header>
          <div>
            <small>TURN ORDER, EXTRA TURNS, SKIPS & PHASE CONTROL</small>
            <h2>
              Turn ${state?.turnNumber || 0}
              · ${escapeHtml(
                state?.phaseName || "Game"
              )}
            </h2>
            <p>
              Active:
              <strong>${escapeHtml(
                state?.activePlayerName ||
                "No active player"
              )}</strong>
            </p>
          </div>
          <button type="button"
            data-v60-close>×</button>
        </header>

        <h3>Turn order</h3>
        <div class="v60-order-grid">
          ${(state?.order || [])
            .map(orderCard)
            .join("")}
        </div>

        ${
          state?.isHost
            ? `
              <div class="v60-host-actions">
                <button type="button"
                  data-v60-reverse>
                  Reverse turn order
                </button>
                <button type="button"
                  data-v60-end-combat>
                  End combat now
                </button>
                <button type="button"
                  data-v60-end-turn>
                  End turn now
                </button>
              </div>

              <h3>Add or skip turns</h3>
              <article class="v60-builder">
                <select data-v60-turn-player>
                  ${playerOptions()}
                </select>

                <input type="number"
                  min="1"
                  max="20"
                  value="1"
                  data-v60-turn-amount>

                <button type="button"
                  data-v60-extra-turn>
                  Add extra turn
                </button>

                <button type="button"
                  data-v60-skip-turn>
                  Skip next turn
                </button>
              </article>

              <h3>Add phase sequence</h3>
              <article class="v60-builder">
                <select data-v60-phase-player>
                  ${playerOptions()}
                </select>

                <select data-v60-phase-kind>
                  <option value="beginning">
                    Beginning phase
                  </option>
                  <option value="upkeep">
                    Upkeep step
                  </option>
                  <option value="draw">
                    Draw step
                  </option>
                  <option value="combat">
                    Combat phase
                  </option>
                  <option value="combat-main">
                    Combat + main
                  </option>
                  <option value="main">
                    Main phase
                  </option>
                  <option value="end">
                    End step
                  </option>
                </select>

                <input type="number"
                  min="1"
                  max="12"
                  value="1"
                  data-v60-phase-amount>

                <button type="button"
                  data-v60-add-phase>
                  Add after current phase
                </button>
              </article>

              <h3>Skip a phase or step</h3>
              <article class="v60-builder">
                <select data-v60-skip-player>
                  ${playerOptions()}
                </select>

                <select data-v60-skip-phase>
                  ${[
                    "Untap",
                    "Upkeep",
                    "Draw",
                    "Main 1",
                    "Beginning Combat",
                    "Declare Attackers",
                    "Declare Blockers",
                    "First-Strike Damage",
                    "Combat Damage",
                    "End Combat",
                    "Main 2",
                    "End",
                    "Cleanup"
                  ].map(
                    (name) =>
                      `<option value="${escapeHtml(
                        name
                      )}">${escapeHtml(
                        name
                      )}</option>`
                  ).join("")}
                </select>

                <input type="number"
                  min="1"
                  max="20"
                  value="1"
                  data-v60-skip-amount>

                <button type="button"
                  data-v60-skip-phase-action>
                  Schedule skip
                </button>
              </article>
            `
            : `
              <p class="v60-help">
                Extra turns and phase effects are automated.
                Manual timeline controls are host-only.
              </p>
            `
        }

        <h3>Queued extra turns</h3>
        <div class="v60-queue-grid">
          ${(state?.extraTurns || [])
            .map(extraTurnCard)
            .join("") ||
            "<p>No extra turns are queued.</p>"}
        </div>

        <h3>Queued additional phases</h3>
        <div class="v60-queue-grid">
          ${(state?.phaseInsertions || [])
            .map(phaseCard)
            .join("") ||
            "<p>No additional phases are queued.</p>"}
        </div>

        <h3>Queued phase skips</h3>
        <div class="v60-queue-grid">
          ${(state?.skippedPhases || [])
            .map(skippedPhaseCard)
            .join("") ||
            "<p>No phase skips are queued.</p>"}
        </div>
      </section>
    `;

    document.body.appendChild(
      overlay
    );
  }

  async function runAction(
    body,
    message
  ) {
    try {
      await api(
        "/api/turn-v60/action",
        body
      );

      document.getElementById(
        "v60TurnSheet"
      )?.remove();

      toast(message, "success");
      setTimeout(poll, 40);
    } catch (error) {
      toast(
        error.message ||
        "Turn action failed.",
        "error"
      );
    }
  }

  function updateBadge() {
    const badge =
      document.querySelector(
        "[data-v60-count]"
      );

    if (badge) {
      badge.textContent =
        String(
          (state?.extraTurns?.length || 0) +
          (state?.phaseInsertions?.length || 0) +
          (state?.skippedPhases?.length || 0)
        );
    }
  }

  async function poll() {
    clearTimeout(pollTimer);

    try {
      state = await api(
        "/api/turn-v60/state"
      );

      installButton();
      updateBadge();
    } catch {}

    pollTimer = setTimeout(
      poll,
      document.hidden ? 3800 : 1200
    );
  }

  document.addEventListener(
    "click",
    (event) => {
      if (
        event.target.closest(
          "#v60TurnButton"
        )
      ) {
        event.preventDefault();
        showSheet();
        return;
      }

      if (
        event.target.closest(
          "[data-v60-close]"
        )
      ) {
        event.preventDefault();
        document.getElementById(
          "v60TurnSheet"
        )?.remove();
        return;
      }

      if (
        event.target.closest(
          "[data-v60-reverse]"
        )
      ) {
        event.preventDefault();
        runAction(
          {
            type:
              "turn-v60-reverse-order"
          },
          "Turn order reversed."
        );
        return;
      }

      if (
        event.target.closest(
          "[data-v60-end-combat]"
        )
      ) {
        event.preventDefault();
        runAction(
          {
            type:
              "turn-v60-end-combat"
          },
          "Combat ended."
        );
        return;
      }

      if (
        event.target.closest(
          "[data-v60-end-turn]"
        )
      ) {
        event.preventDefault();
        runAction(
          {
            type:
              "turn-v60-end-turn"
          },
          "Turn moved to cleanup."
        );
        return;
      }

      const sheet =
        document.getElementById(
          "v60TurnSheet"
        );

      if (
        event.target.closest(
          "[data-v60-extra-turn]"
        )
      ) {
        event.preventDefault();
        runAction(
          {
            type:
              "turn-v60-extra-turn",
            playerId:
              sheet.querySelector(
                "[data-v60-turn-player]"
              )?.value || "",
            amount:
              Number(
                sheet.querySelector(
                  "[data-v60-turn-amount]"
                )?.value || 1
              )
          },
          "Extra turn queued."
        );
        return;
      }

      if (
        event.target.closest(
          "[data-v60-skip-turn]"
        )
      ) {
        event.preventDefault();
        runAction(
          {
            type:
              "turn-v60-skip-turn",
            playerId:
              sheet.querySelector(
                "[data-v60-turn-player]"
              )?.value || "",
            amount:
              Number(
                sheet.querySelector(
                  "[data-v60-turn-amount]"
                )?.value || 1
              )
          },
          "Skipped turn queued."
        );
        return;
      }

      if (
        event.target.closest(
          "[data-v60-add-phase]"
        )
      ) {
        event.preventDefault();
        runAction(
          {
            type:
              "turn-v60-add-phase",
            playerId:
              sheet.querySelector(
                "[data-v60-phase-player]"
              )?.value || "",
            kind:
              sheet.querySelector(
                "[data-v60-phase-kind]"
              )?.value || "combat-main",
            amount:
              Number(
                sheet.querySelector(
                  "[data-v60-phase-amount]"
                )?.value || 1
              ),
            anchorPhaseIndex:
              state?.phaseIndex || 0
          },
          "Additional phase queued."
        );
        return;
      }

      if (
        event.target.closest(
          "[data-v60-skip-phase-action]"
        )
      ) {
        event.preventDefault();
        runAction(
          {
            type:
              "turn-v60-skip-phase",
            playerId:
              sheet.querySelector(
                "[data-v60-skip-player]"
              )?.value || "",
            phase:
              sheet.querySelector(
                "[data-v60-skip-phase]"
              )?.value || "Draw",
            amount:
              Number(
                sheet.querySelector(
                  "[data-v60-skip-amount]"
                )?.value || 1
              )
          },
          "Phase skip queued."
        );
      }
    }
  );

  const observer =
    new MutationObserver(
      installButton
    );
  const app =
    document.getElementById("app");

  if (app) {
    observer.observe(app, {
      childList: true,
      subtree: true
    });
  }

  document.addEventListener(
    "visibilitychange",
    poll
  );
  window.addEventListener(
    "load",
    poll,
    { once: true }
  );
  poll();

  window.ArenaCommanderV60 = {
    version: VERSION,
    refresh: poll
  };
})();
