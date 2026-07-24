(() => {
  "use strict";

  const VERSION = "58.0.0";
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
        "v58ControlButton"
      )
    ) {
      return;
    }

    const button =
      document.createElement("button");
    button.type = "button";
    button.id =
      "v58ControlButton";
    button.className =
      "arena-hotfix-control v58-control-button";
    button.innerHTML =
      '<span>↔</span><small>Control</small><b data-v58-count>0</b>';
    actions.appendChild(button);
  }

  function permanentOptions() {
    return `
      <option value="">
        Choose permanent
      </option>
      ${(state?.permanents || [])
        .map(
          (entry) => `
            <option value="${escapeHtml(
              entry.cardId
            )}">
              ${escapeHtml(
                entry.name
              )}
              — ${escapeHtml(
                entry.controllerName
              )}
            </option>
          `
        )
        .join("")}
    `;
  }

  function playerOptions(
    includeLeaving = true
  ) {
    return `
      <option value="">
        Choose player
      </option>
      ${(state?.players || [])
        .filter(
          (player) =>
            includeLeaving ||
            !player.conceded
        )
        .map(
          (player) => `
            <option value="${escapeHtml(
              player.id
            )}">
              ${escapeHtml(
                player.name
              )}
              ${
                player.conceded
                  ? " — left"
                  : ""
              }
            </option>
          `
        )
        .join("")}
    `;
  }

  function permanentCard(entry) {
    return `
      <article class="v58-permanent-card">
        ${
          cardImage(entry.card)
            ? `<img src="${escapeHtml(
                cardImage(entry.card)
              )}" alt="">`
            : '<div class="v58-card-back">↔</div>'
        }

        <div>
          <strong>${escapeHtml(
            entry.name
          )}</strong>
          <small>${escapeHtml(
            entry.typeLine
          )}</small>
          <span>
            Owner:
            ${escapeHtml(
              entry.ownerName
            )}
          </span>
          <span>
            Controller:
            ${escapeHtml(
              entry.controllerName
            )}
          </span>
          <span>
            ${
              entry.activeEffects.length
            }
            active control effect(s)
          </span>
        </div>

        ${
          state?.isHost &&
          entry.activeEffects.length
            ? `
              <button type="button"
                data-v58-return="${escapeHtml(
                  entry.cardId
                )}">
                End control effects
              </button>
            `
            : ""
        }
      </article>
    `;
  }

  function effectRow(effect) {
    return `
      <article class="v58-effect-row">
        <strong>${escapeHtml(
          effect.label
        )}</strong>
        <span>
          ${escapeHtml(
            effect.controllerName
          )}
          · ${escapeHtml(
            effect.duration
          )}
        </span>
        <small>
          Timestamp
          ${effect.timestamp}
          ${
            effect.static
              ? " · static"
              : ""
          }
        </small>
      </article>
    `;
  }

  function showSheet() {
    document.getElementById(
      "v58ControlSheet"
    )?.remove();

    const overlay =
      document.createElement("div");
    overlay.id =
      "v58ControlSheet";
    overlay.className =
      "v58-control-sheet";

    overlay.innerHTML = `
      <section>
        <header>
          <div>
            <small>CONTROL, OWNERSHIP, EXCHANGE & LEAVE CLEANUP</small>
            <h2>
              Turn ${state?.turnNumber || 0}
              · ${escapeHtml(
                state?.phase || "Game"
              )}
            </h2>
          </div>
          <button type="button"
            data-v58-close>×</button>
        </header>

        ${
          state?.isHost
            ? `
              <h3>Manual control effect</h3>
              <article class="v58-builder">
                <select data-v58-card>
                  ${permanentOptions()}
                </select>

                <select data-v58-controller>
                  ${playerOptions(false)}
                </select>

                <select data-v58-duration>
                  <option value="permanent">
                    Permanent
                  </option>
                  <option value="end-of-turn">
                    Until end of turn
                  </option>
                  <option value="until-turn">
                    Until next turn
                  </option>
                  <option value="source">
                    While source remains
                  </option>
                </select>

                <select data-v58-source>
                  ${permanentOptions()}
                </select>

                <label>
                  <input type="checkbox"
                    data-v58-untap>
                  Untap it
                </label>

                <label>
                  <input type="checkbox"
                    data-v58-haste>
                  Give haste this turn
                </label>

                <input type="text"
                  maxlength="220"
                  data-v58-label
                  placeholder="Optional effect label">

                <button type="button"
                  data-v58-gain>
                  Apply control effect
                </button>
              </article>

              <h3>Exchange control</h3>
              <article class="v58-exchange-builder">
                <select data-v58-exchange-first>
                  ${permanentOptions()}
                </select>
                <span>↔</span>
                <select data-v58-exchange-second>
                  ${permanentOptions()}
                </select>
                <button type="button"
                  data-v58-exchange>
                  Exchange
                </button>
              </article>

              <h3>Leave-game cleanup</h3>
              <article class="v58-leave-builder">
                <select data-v58-leaving-player>
                  ${playerOptions(true)}
                </select>
                <button type="button"
                  data-v58-cleanup-player>
                  Run cleanup
                </button>
              </article>
            `
            : `
              <p class="v58-help">
                Automatic card effects remain active. Manual
                control and cleanup tools are host-only.
              </p>
            `
        }

        <h3>Battlefield ownership and control</h3>
        <div class="v58-permanent-grid">
          ${(state?.permanents || [])
            .map(permanentCard)
            .join("") ||
            "<p>No permanents are on the battlefield.</p>"}
        </div>

        <h3>Active control effects</h3>
        <div class="v58-effect-list">
          ${(state?.effects || [])
            .map(effectRow)
            .join("") ||
            "<p>No active control-changing effects.</p>"}
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
        "/api/control-v58/action",
        body
      );

      document.getElementById(
        "v58ControlSheet"
      )?.remove();

      toast(message, "success");
      setTimeout(poll, 40);
    } catch (error) {
      toast(
        error.message ||
        "Control action failed.",
        "error"
      );
    }
  }

  function updateBadge() {
    const badge =
      document.querySelector(
        "[data-v58-count]"
      );

    if (badge) {
      badge.textContent =
        String(
          state?.effects?.length || 0
        );
    }
  }

  async function poll() {
    clearTimeout(pollTimer);

    try {
      state = await api(
        "/api/control-v58/state"
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
          "#v58ControlButton"
        )
      ) {
        event.preventDefault();
        showSheet();
        return;
      }

      if (
        event.target.closest(
          "[data-v58-close]"
        )
      ) {
        event.preventDefault();
        document.getElementById(
          "v58ControlSheet"
        )?.remove();
        return;
      }

      if (
        event.target.closest(
          "[data-v58-gain]"
        )
      ) {
        event.preventDefault();
        const sheet =
          document.getElementById(
            "v58ControlSheet"
          );

        const duration =
          sheet.querySelector(
            "[data-v58-duration]"
          )?.value ||
          "permanent";

        runAction(
          {
            type:
              "control-v58-gain",
            cardId:
              sheet.querySelector(
                "[data-v58-card]"
              )?.value || "",
            controllerId:
              sheet.querySelector(
                "[data-v58-controller]"
              )?.value || "",
            duration,
            expiresTurn:
              duration === "until-turn"
                ? Number(
                    state?.turnNumber || 0
                  ) + 1
                : null,
            sourceCardId:
              duration === "source"
                ? sheet.querySelector(
                    "[data-v58-source]"
                  )?.value || ""
                : "",
            sourceRequiredControllerId:
              duration === "source"
                ? session()?.playerId || ""
                : "",
            untap: Boolean(
              sheet.querySelector(
                "[data-v58-untap]"
              )?.checked
            ),
            haste: Boolean(
              sheet.querySelector(
                "[data-v58-haste]"
              )?.checked
            ),
            label:
              sheet.querySelector(
                "[data-v58-label]"
              )?.value || ""
          },
          "Control effect applied."
        );
        return;
      }

      if (
        event.target.closest(
          "[data-v58-exchange]"
        )
      ) {
        event.preventDefault();
        const sheet =
          document.getElementById(
            "v58ControlSheet"
          );

        runAction(
          {
            type:
              "control-v58-exchange",
            firstCardId:
              sheet.querySelector(
                "[data-v58-exchange-first]"
              )?.value || "",
            secondCardId:
              sheet.querySelector(
                "[data-v58-exchange-second]"
              )?.value || ""
          },
          "Control exchanged."
        );
        return;
      }

      const returnButton =
        event.target.closest(
          "[data-v58-return]"
        );
      if (returnButton) {
        event.preventDefault();
        runAction(
          {
            type:
              "control-v58-return",
            cardId:
              returnButton.dataset
                .v58Return
          },
          "Control effects ended."
        );
        return;
      }

      if (
        event.target.closest(
          "[data-v58-cleanup-player]"
        )
      ) {
        event.preventDefault();
        const sheet =
          document.getElementById(
            "v58ControlSheet"
          );

        runAction(
          {
            type:
              "control-v58-cleanup-player",
            playerId:
              sheet.querySelector(
                "[data-v58-leaving-player]"
              )?.value || ""
          },
          "Leave-game cleanup completed."
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

  window.ArenaCommanderV58 = {
    version: VERSION,
    refresh: poll
  };
})();
