(() => {
  "use strict";

  const VERSION = "55.0.0";
  const SESSION_KEY =
    "tornCommander.session.v5";

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
      "Commander"
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
    if (!auth) {
      throw new Error(
        "No saved room session."
      );
    }

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

    const payload =
      await response.json().catch(() => null);

    if (!response.ok || !payload?.success) {
      throw new Error(
        payload?.error ||
        `HTTP ${response.status}`
      );
    }

    return payload;
  }

  function toast(message, type = "info") {
    const region =
      document.getElementById("toastRegion");
    if (!region) return;

    const item =
      document.createElement("div");
    item.className = `toast ${type}`;
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
        "v55CommanderButton"
      )
    ) {
      return;
    }

    const button =
      document.createElement("button");
    button.type = "button";
    button.id = "v55CommanderButton";
    button.className =
      "arena-hotfix-control v55-commander-button";
    button.innerHTML =
      '<span>♛</span><small>Command+</small><b data-v55-alert>0</b>';
    actions.appendChild(button);
  }

  function commanderCard(entry) {
    const owner =
      state?.damageMatrix
        ?.find(
          (player) =>
            player.playerId === entry.ownerId
        )
        ?.playerName || entry.ownerId;

    return `
      <article class="v55-commander-card">
        ${
          cardImage(entry.card)
            ? `<img src="${escapeHtml(
                cardImage(entry.card)
              )}" alt="">`
            : '<div class="v55-card-back">♛</div>'
        }

        <div>
          <strong>${escapeHtml(entry.name)}</strong>
          <small>Owner: ${escapeHtml(owner)}</small>
          <span>Zone: ${escapeHtml(entry.zone)}</span>
          <span>
            Casts: ${entry.castsFromCommandZone}
            · Tax: {${entry.tax}}
          </span>
        </div>

        ${
          entry.ownerId === session()?.playerId &&
          entry.zone !== "commandZone" &&
          entry.zone !== "stack"
            ? `<button type="button"
                 data-v55-return="${escapeHtml(
                   entry.cardId
                 )}">
                 Move to command zone
               </button>`
            : ""
        }
      </article>
    `;
  }

  function pairPanel() {
    const validation =
      state?.viewerPairValidation;

    if (!validation) return "";

    return `
      <article class="v55-pair ${
        validation.valid
          ? "valid"
          : "invalid"
      }">
        <strong>
          ${
            validation.valid
              ? "Commander configuration valid"
              : "Commander configuration warning"
          }
        </strong>
        <span>${escapeHtml(
          validation.message
        )}</span>
      </article>
    `;
  }

  function damageTable() {
    const commanders =
      state?.commanders || [];
    const players =
      state?.damageMatrix || [];

    if (!commanders.length) {
      return "<p>No commanders are registered.</p>";
    }

    return `
      <div class="v55-damage-scroll">
        <table class="v55-damage-table">
          <thead>
            <tr>
              <th>Player</th>
              ${commanders
                .map(
                  (commander) =>
                    `<th>${escapeHtml(
                      commander.name
                    )}</th>`
                )
                .join("")}
            </tr>
          </thead>
          <tbody>
            ${players
              .map(
                (player) => `
                  <tr>
                    <th>${escapeHtml(
                      player.playerName
                    )}</th>
                    ${commanders
                      .map((commander) => {
                        const amount =
                          player.damage.find(
                            (entry) =>
                              entry.commanderCardId ===
                              commander.cardId
                          )?.amount || 0;

                        return `
                          <td class="${
                            amount >=
                            state.commanderDamageThreshold
                              ? "lethal"
                              : ""
                          }">
                            ${amount}/${
                              state.commanderDamageThreshold
                            }
                          </td>
                        `;
                      })
                      .join("")}
                  </tr>
                `
              )
              .join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function companionPanel() {
    if (state?.companion) {
      const companion =
        state.companion;
      const valid =
        companion.validation?.valid !== false;

      return `
        <article class="v55-companion-active">
          ${
            cardImage(companion.card)
              ? `<img src="${escapeHtml(
                  cardImage(companion.card)
                )}" alt="">`
              : '<div class="v55-card-back">◇</div>'
          }
          <div>
            <strong>${escapeHtml(
              cardName(companion.card)
            )}</strong>
            <span class="${
              valid ? "valid" : "invalid"
            }">
              ${
                valid
                  ? "Companion restriction valid"
                  : escapeHtml(
                      companion.validation?.errors?.[0] ||
                      "Companion restriction failed"
                    )
              }
            </span>
          </div>
          <button type="button"
            data-v55-take-companion
            ${
              state.companionActionUsed ||
              !valid
                ? "disabled"
                : ""
            }>
            Pay {3} — put into hand
          </button>
        </article>
      `;
    }

    const candidates =
      state?.companionCandidates || [];

    return `
      <article class="v55-companion-setup">
        <select data-v55-companion-select>
          <option value="">
            Choose imported companion
          </option>
          ${candidates
            .map(
              (entry) => `
                <option value="${escapeHtml(
                  entry.name
                )}">
                  ${escapeHtml(entry.name)}
                  ${
                    entry.validation?.valid
                      ? " — valid"
                      : " — restriction warning"
                  }
                </option>
              `
            )
            .join("")}
        </select>

        <button type="button"
          data-v55-designate-companion
          ${candidates.length ? "" : "disabled"}>
          Designate companion
        </button>

        ${
          candidates.length
            ? candidates
                .map(
                  (entry) => `
                    <small>
                      <strong>${escapeHtml(
                        entry.name
                      )}:</strong>
                      ${
                        entry.validation?.valid
                          ? "starting-deck restriction passed"
                          : escapeHtml(
                              entry.validation?.errors?.[0] ||
                              "restriction needs Judge Mode"
                            )
                      }
                    </small>
                  `
                )
                .join("")
            : "<small>No Companion card was found in the imported deck data.</small>"
        }
      </article>
    `;
  }

  function showSheet() {
    document.getElementById(
      "v55CommanderSheet"
    )?.remove();

    const overlay =
      document.createElement("div");
    overlay.id = "v55CommanderSheet";
    overlay.className =
      "v55-commander-sheet";
    overlay.innerHTML = `
      <section>
        <header>
          <div>
            <small>COMPLETE COMMANDER RULES</small>
            <h2>${escapeHtml(
              state?.phase || "Game"
            )}</h2>
          </div>
          <button type="button"
            data-v55-close>×</button>
        </header>

        ${pairPanel()}

        <h3>Commanders & separate taxes</h3>
        <div class="v55-commander-grid">
          ${(state?.commanders || [])
            .map(commanderCard)
            .join("") ||
            "<p>No commanders are registered.</p>"}
        </div>

        <h3>Commander damage by card</h3>
        ${damageTable()}

        <h3>Companion</h3>
        ${companionPanel()}
      </section>
    `;
    document.body.appendChild(overlay);
  }

  async function runAction(body, message) {
    try {
      await api(
        "/api/commander-v55/action",
        body
      );
      document.getElementById(
        "v55CommanderSheet"
      )?.remove();
      toast(message, "success");
      setTimeout(poll, 40);
    } catch (error) {
      toast(
        error.message ||
        "Commander action failed.",
        "error"
      );
    }
  }

  function closeZoneChoice() {
    document.getElementById(
      "v55ZoneChoiceOverlay"
    )?.remove();
    activeChoiceId = "";
  }

  function renderZoneChoice(choice) {
    if (
      !choice ||
      choice.id === activeChoiceId
    ) {
      return;
    }

    closeZoneChoice();
    activeChoiceId = choice.id;

    const overlay =
      document.createElement("div");
    overlay.id =
      "v55ZoneChoiceOverlay";
    overlay.className =
      "v55-zone-choice-overlay";
    overlay.dataset.choiceId =
      choice.id;

    overlay.innerHTML = `
      <section>
        <small>COMMAND ZONE CHOICE</small>
        <h2>${escapeHtml(
          choice.commanderName
        )}</h2>

        <p>
          ${
            choice.timing === "state-based"
              ? `${escapeHtml(
                  choice.commanderName
                )} is in ${escapeHtml(
                  choice.destinationZone
                )}. Move it to the command zone?`
              : `${escapeHtml(
                  choice.commanderName
                )} would go to ${escapeHtml(
                  choice.destinationZone
                )}. Use the command-zone replacement?`
          }
        </p>

        ${
          cardImage(choice.card)
            ? `<img src="${escapeHtml(
                cardImage(choice.card)
              )}" alt="">`
            : ""
        }

        <div>
          <button type="button"
            data-v55-zone="command">
            Move to command zone
          </button>
          <button type="button"
            data-v55-zone="leave">
            Leave in ${escapeHtml(
              choice.destinationZone
            )}
          </button>
        </div>
      </section>
    `;
    document.body.appendChild(overlay);
  }

  async function resolveZone(moveToCommandZone) {
    const overlay =
      document.getElementById(
        "v55ZoneChoiceOverlay"
      );
    if (!overlay) return;

    overlay
      .querySelectorAll("button")
      .forEach((button) => {
        button.disabled = true;
      });

    try {
      await api(
        "/api/commander-v55/resolve-zone",
        {
          choiceId:
            overlay.dataset.choiceId,
          moveToCommandZone
        }
      );

      closeZoneChoice();
      toast(
        moveToCommandZone
          ? "Commander moved to the command zone."
          : "Commander left in the destination zone.",
        "success"
      );
      setTimeout(poll, 40);
    } catch (error) {
      overlay
        .querySelectorAll("button")
        .forEach((button) => {
          button.disabled = false;
        });
      toast(
        error.message ||
        "Unable to resolve the command-zone choice.",
        "error"
      );
    }
  }

  function updateBadge(pending) {
    const badge =
      document.querySelector(
        "[data-v55-alert]"
      );
    if (!badge) return;

    const invalid =
      state?.viewerPairValidation &&
      !state.viewerPairValidation.valid
        ? 1
        : 0;

    badge.textContent = String(
      (pending?.choice ? 1 : 0) +
      invalid
    );
  }

  async function poll() {
    clearTimeout(pollTimer);

    try {
      const [nextState, pending] =
        await Promise.all([
          api("/api/commander-v55/state"),
          api("/api/commander-v55/pending")
        ]);

      state = nextState;
      installButton();
      updateBadge(pending);

      if (pending.choice) {
        renderZoneChoice(
          pending.choice
        );
      } else {
        closeZoneChoice();
      }
    } catch {}

    pollTimer = setTimeout(
      poll,
      document.hidden ? 3800 : 1100
    );
  }

  document.addEventListener(
    "click",
    (event) => {
      if (
        event.target.closest(
          "#v55CommanderButton"
        )
      ) {
        event.preventDefault();
        showSheet();
        return;
      }

      if (
        event.target.closest(
          "[data-v55-close]"
        )
      ) {
        event.preventDefault();
        document.getElementById(
          "v55CommanderSheet"
        )?.remove();
        return;
      }

      const returnButton =
        event.target.closest(
          "[data-v55-return]"
        );
      if (returnButton) {
        event.preventDefault();
        runAction(
          {
            type: "commander-v55-return",
            cardId:
              returnButton.dataset.v55Return
          },
          "Commander moved to the command zone."
        );
        return;
      }

      if (
        event.target.closest(
          "[data-v55-designate-companion]"
        )
      ) {
        event.preventDefault();
        const name =
          document.querySelector(
            "[data-v55-companion-select]"
          )?.value || "";

        runAction(
          {
            type:
              "commander-v55-designate-companion",
            name
          },
          "Companion designated."
        );
        return;
      }

      if (
        event.target.closest(
          "[data-v55-take-companion]"
        )
      ) {
        event.preventDefault();
        runAction(
          {
            type:
              "commander-v55-take-companion"
          },
          "Companion moved to your hand."
        );
        return;
      }

      const zoneButton =
        event.target.closest(
          "[data-v55-zone]"
        );
      if (zoneButton) {
        event.preventDefault();
        resolveZone(
          zoneButton.dataset.v55Zone ===
            "command"
        );
      }
    }
  );

  const observer =
    new MutationObserver(installButton);
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

  window.ArenaCommanderV55 = {
    version: VERSION,
    refresh: poll
  };
})();
