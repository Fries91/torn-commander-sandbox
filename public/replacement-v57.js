(() => {
  "use strict";

  const VERSION = "57.0.0";
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
        "v57ReplacementButton"
      )
    ) {
      return;
    }

    const button =
      document.createElement("button");
    button.type = "button";
    button.id =
      "v57ReplacementButton";
    button.className =
      "arena-hotfix-control v57-replacement-button";
    button.innerHTML =
      '<span>🛡️</span><small>Replace</small><b data-v57-count>0</b>';
    actions.appendChild(button);
  }

  function targetOptions(
    includeBlank = true
  ) {
    return `
      ${
        includeBlank
          ? '<option value="">Choose target</option>'
          : ""
      }
      ${(state?.targets || [])
        .map(
          (target) => `
            <option value="${escapeHtml(
              target.targetKey
            )}">
              ${escapeHtml(
                target.name
              )}${
                target.typeLine
                  ? ` — ${escapeHtml(
                      target.typeLine
                    )}`
                  : ""
              }
            </option>
          `
        )
        .join("")}
    `;
  }

  function effectRow(
    effect,
    index
  ) {
    return `
      <article class="v57-effect-row"
        data-v57-effect="${escapeHtml(
          effect.id
        )}">
        <span class="v57-order-handle">
          ${index + 1}
        </span>

        <div>
          <strong>${escapeHtml(
            effect.label ||
            effect.kind
          )}</strong>
          <small>
            ${escapeHtml(
              effect.sourceName ||
              "Manual effect"
            )}
            · ${escapeHtml(
              effect.sourceFilter ||
              "any"
            )}
          </small>
          ${
            Number.isFinite(
              Number(effect.remaining)
            )
              ? `<span>${effect.remaining} remaining</span>`
              : ""
          }
        </div>

        ${
          effect.kind?.startsWith(
            "redirect"
          )
            ? `
              <select
                data-v57-redirect-target>
                ${targetOptions()}
              </select>
            `
            : ""
        }

        ${
          effect.manual
            ? `
              <button type="button"
                data-v57-remove="${escapeHtml(
                  effect.id
                )}">
                Remove
              </button>
            `
            : ""
        }

        <div class="v57-order-buttons">
          <button type="button"
            data-v57-up>↑</button>
          <button type="button"
            data-v57-down>↓</button>
        </div>
      </article>
    `;
  }

  function historyRow(event) {
    return `
      <article class="v57-history-row">
        <strong>
          ${escapeHtml(
            event.sourceName
          )}
          → ${escapeHtml(
            event.targetName
          )}
        </strong>
        <span>
          ${event.requested}
          became
          ${event.finalAmount}
        </span>
        <small>
          ${(event.steps || [])
            .map(
              (step) =>
                `${step.label}: ${step.before}→${step.after}`
            )
            .join(" · ") ||
            "No replacement changed the amount"
          }
        </small>
      </article>
    `;
  }

  function showSheet() {
    document.getElementById(
      "v57ReplacementSheet"
    )?.remove();

    const overlay =
      document.createElement("div");
    overlay.id =
      "v57ReplacementSheet";
    overlay.className =
      "v57-replacement-sheet";

    overlay.innerHTML = `
      <section>
        <header>
          <div>
            <small>REPLACEMENT, PREVENTION & REDIRECTION</small>
            <h2>${escapeHtml(
              state?.phase || "Game"
            )}</h2>
          </div>
          <button type="button"
            data-v57-close>×</button>
        </header>

        <h3>Replacement order</h3>
        <p class="v57-help">
          Move effects into the order you want the server
          to apply them when damage would be dealt to you
          or your permanents.
        </p>

        <div class="v57-effect-list"
          data-v57-effect-list>
          ${(state?.effects || [])
            .map(effectRow)
            .join("") ||
            "<p>No discovered replacement or prevention effects.</p>"}
        </div>

        <button type="button"
          class="v57-save-order"
          data-v57-save-order>
          Save replacement order
        </button>

        <h3>Create a temporary effect</h3>
        <article class="v57-builder">
          <select data-v57-kind>
            <option value="prevent-fixed">
              Prevent next N damage
            </option>
            <option value="prevent-all">
              Prevent all next damage
            </option>
            <option value="redirect-fixed">
              Redirect next N damage
            </option>
            <option value="redirect-all">
              Redirect all next damage
            </option>
            <option value="multiply">
              Multiply damage
            </option>
            <option value="half">
              Half damage
            </option>
          </select>

          <select data-v57-target>
            ${targetOptions()}
          </select>

          <input type="number"
            min="1"
            value="1"
            data-v57-amount
            placeholder="Amount">

          <input type="number"
            min="0"
            step="0.5"
            value="2"
            data-v57-multiplier
            placeholder="Multiplier">

          <select data-v57-filter>
            <option value="any">
              Any damage
            </option>
            <option value="combat">
              Combat damage only
            </option>
            <option value="noncombat">
              Noncombat damage only
            </option>
          </select>

          <select data-v57-redirect>
            ${targetOptions()}
          </select>

          <select data-v57-expires>
            <option value="turn">
              Until used or turn changes
            </option>
            <option value="game">
              Until used or removed
            </option>
          </select>

          <input type="text"
            maxlength="180"
            data-v57-label
            placeholder="Optional label">

          <button type="button"
            data-v57-create>
            Create effect
          </button>
        </article>

        <h3>Recent damage events</h3>
        <div class="v57-history">
          ${(state?.history || [])
            .map(historyRow)
            .join("") ||
            "<p>No damage events have been processed yet.</p>"}
        </div>
      </section>
    `;

    document.body.appendChild(
      overlay
    );

    for (
      const effect of
      state?.effects || []
    ) {
      const row =
        overlay.querySelector(
          `[data-v57-effect="${CSS.escape(
            effect.id
          )}"]`
        );

      const select =
        row?.querySelector(
          "[data-v57-redirect-target]"
        );

      if (select) {
        select.value =
          effect.redirectTargetKey ||
          "";
      }
    }
  }

  async function runAction(
    body,
    message
  ) {
    try {
      await api(
        "/api/replacement-v57/action",
        body
      );

      toast(message, "success");
      setTimeout(poll, 40);
    } catch (error) {
      toast(
        error.message ||
        "Replacement action failed.",
        "error"
      );
    }
  }

  function reorder(row, direction) {
    const list =
      row.parentElement;
    const sibling =
      direction < 0
        ? row.previousElementSibling
        : row.nextElementSibling;

    if (!sibling) return;

    if (direction < 0) {
      list.insertBefore(
        row,
        sibling
      );
    } else {
      list.insertBefore(
        sibling,
        row
      );
    }

    [
      ...list.querySelectorAll(
        ".v57-effect-row"
      )
    ].forEach(
      (entry, index) => {
        const handle =
          entry.querySelector(
            ".v57-order-handle"
          );
        if (handle) {
          handle.textContent =
            String(index + 1);
        }
      }
    );
  }

  function updateBadge() {
    const badge =
      document.querySelector(
        "[data-v57-count]"
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
        "/api/replacement-v57/state"
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
          "#v57ReplacementButton"
        )
      ) {
        event.preventDefault();
        showSheet();
        return;
      }

      if (
        event.target.closest(
          "[data-v57-close]"
        )
      ) {
        event.preventDefault();
        document.getElementById(
          "v57ReplacementSheet"
        )?.remove();
        return;
      }

      const up =
        event.target.closest(
          "[data-v57-up]"
        );
      if (up) {
        event.preventDefault();
        reorder(
          up.closest(
            ".v57-effect-row"
          ),
          -1
        );
        return;
      }

      const down =
        event.target.closest(
          "[data-v57-down]"
        );
      if (down) {
        event.preventDefault();
        reorder(
          down.closest(
            ".v57-effect-row"
          ),
          1
        );
        return;
      }

      const remove =
        event.target.closest(
          "[data-v57-remove]"
        );
      if (remove) {
        event.preventDefault();
        runAction(
          {
            type:
              "replacement-v57-remove",
            shieldId:
              remove.dataset.v57Remove
          },
          "Temporary effect removed."
        );
        return;
      }

      if (
        event.target.closest(
          "[data-v57-save-order]"
        )
      ) {
        event.preventDefault();

        const list =
          document.querySelector(
            "[data-v57-effect-list]"
          );

        const rows = [
          ...list.querySelectorAll(
            ".v57-effect-row"
          )
        ];

        const redirectTargets = {};
        for (const row of rows) {
          const select =
            row.querySelector(
              "[data-v57-redirect-target]"
            );
          if (select?.value) {
            redirectTargets[
              row.dataset.v57Effect
            ] = select.value;
          }
        }

        runAction(
          {
            type:
              "replacement-v57-preferences",
            order: rows.map(
              (row) =>
                row.dataset.v57Effect
            ),
            redirectTargets
          },
          "Replacement order saved."
        );
        return;
      }

      if (
        event.target.closest(
          "[data-v57-create]"
        )
      ) {
        event.preventDefault();

        const sheet =
          document.getElementById(
            "v57ReplacementSheet"
          );

        runAction(
          {
            type:
              "replacement-v57-create",
            kind:
              sheet.querySelector(
                "[data-v57-kind]"
              )?.value,
            targetKey:
              sheet.querySelector(
                "[data-v57-target]"
              )?.value,
            amount:
              Number(
                sheet.querySelector(
                  "[data-v57-amount]"
                )?.value || 1
              ),
            multiplier:
              Number(
                sheet.querySelector(
                  "[data-v57-multiplier]"
                )?.value || 2
              ),
            sourceFilter:
              sheet.querySelector(
                "[data-v57-filter]"
              )?.value,
            redirectTargetKey:
              sheet.querySelector(
                "[data-v57-redirect]"
              )?.value,
            expires:
              sheet.querySelector(
                "[data-v57-expires]"
              )?.value,
            label:
              sheet.querySelector(
                "[data-v57-label]"
              )?.value || "",
            oneUse: true
          },
          "Temporary replacement effect created."
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

  window.ArenaCommanderV57 = {
    version: VERSION,
    refresh: poll
  };
})();
