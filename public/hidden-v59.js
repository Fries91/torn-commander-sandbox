(() => {
  "use strict";

  const VERSION = "59.0.0";
  const SESSION_KEY =
    "tornCommander.session.v5";

  let state = null;
  let pending = null;
  let pollTimer = null;
  let activeSessionId = "";

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
        "v59HiddenButton"
      )
    ) {
      return;
    }

    const button =
      document.createElement("button");
    button.type = "button";
    button.id =
      "v59HiddenButton";
    button.className =
      "arena-hotfix-control v59-hidden-button";
    button.innerHTML =
      '<span>🔍</span><small>Library</small><b data-v59-count>0</b>';
    actions.appendChild(button);
  }

  function playerOptions() {
    return `
      <option value="">
        Choose player
      </option>
      ${(state?.players || [])
        .map(
          (player) => `
            <option value="${escapeHtml(
              player.id
            )}">
              ${escapeHtml(
                player.name
              )}
              — ${player.libraryCount} cards
            </option>
          `
        )
        .join("")}
    `;
  }

  function playerCard(player) {
    const restrictions =
      player.searchRestrictions || {};

    return `
      <article class="v59-player-card">
        <strong>${escapeHtml(
          player.name
        )}</strong>
        <span>
          Library:
          ${player.libraryCount}
        </span>
        <span>
          Hand:
          ${player.handCount}
        </span>
        <span>
          Shuffles:
          ${player.shuffleCount}
        </span>
        ${
          restrictions.blocked
            ? `
              <small class="blocked">
                Searches blocked by
                ${escapeHtml(
                  restrictions.blockedBy
                    ?.map(
                      (entry) =>
                        entry.name
                    )
                    .join(", ") ||
                  "an effect"
                )}
              </small>
            `
            : restrictions.topLimit != null
              ? `
                <small>
                  Search limited to top
                  ${restrictions.topLimit}
                </small>
              `
              : ""
        }
      </article>
    `;
  }

  function revealCard(reveal) {
    return `
      <article class="v59-reveal-card">
        ${
          cardImage(reveal.card)
            ? `<img src="${escapeHtml(
                cardImage(reveal.card)
              )}" alt="">`
            : '<div class="v59-card-back">?</div>'
        }
        <div>
          <strong>${escapeHtml(
            reveal.cardName
          )}</strong>
          <span>${escapeHtml(
            reveal.zone
          )}</span>
          <small>${escapeHtml(
            reveal.reason
          )}</small>
        </div>
        ${
          reveal.zoneOwnerId ===
            session()?.playerId ||
          state?.isHost
            ? `
              <button type="button"
                data-v59-clear-reveal="${escapeHtml(
                  reveal.id
                )}">
                Hide
              </button>
            `
            : ""
        }
      </article>
    `;
  }

  function showSheet() {
    document.getElementById(
      "v59HiddenSheet"
    )?.remove();

    const overlay =
      document.createElement("div");
    overlay.id =
      "v59HiddenSheet";
    overlay.className =
      "v59-hidden-sheet";

    overlay.innerHTML = `
      <section>
        <header>
          <div>
            <small>HIDDEN INFORMATION, SEARCH, REVEAL & SHUFFLE</small>
            <h2>${escapeHtml(
              state?.phase || "Game"
            )}</h2>
          </div>
          <button type="button"
            data-v59-close>×</button>
        </header>

        <div class="v59-player-grid">
          ${(state?.players || [])
            .map(playerCard)
            .join("")}
        </div>

        <div class="v59-basic-actions">
          <button type="button"
            data-v59-shuffle-self>
            Shuffle my library
          </button>
          <button type="button"
            data-v59-reveal-hand>
            Reveal my hand
          </button>
        </div>

        ${
          state?.isHost
            ? `
              <h3>Create library search</h3>
              <article class="v59-search-builder">
                <select data-v59-searcher>
                  ${playerOptions()}
                </select>
                <select data-v59-library-owner>
                  ${playerOptions()}
                </select>
                <input type="text"
                  data-v59-quality
                  placeholder="Example: basic land card">
                <input type="number"
                  min="0"
                  value="0"
                  data-v59-min
                  placeholder="Minimum">
                <input type="number"
                  min="1"
                  value="1"
                  data-v59-max
                  placeholder="Maximum">
                <select data-v59-destination>
                  <option value="hand">
                    Put into hand
                  </option>
                  <option value="battlefield">
                    Put onto battlefield
                  </option>
                  <option value="graveyard">
                    Put into graveyard
                  </option>
                  <option value="exile">
                    Exile
                  </option>
                  <option value="library-top">
                    Put on top
                  </option>
                  <option value="library-bottom">
                    Put on bottom
                  </option>
                </select>
                <label>
                  <input type="checkbox"
                    data-v59-up-to>
                  Up to maximum
                </label>
                <label>
                  <input type="checkbox"
                    checked
                    data-v59-reveal-found>
                  Reveal found cards
                </label>
                <label>
                  <input type="checkbox"
                    checked
                    data-v59-shuffle-after>
                  Shuffle afterward
                </label>
                <label>
                  <input type="checkbox"
                    data-v59-tapped>
                  Enter tapped
                </label>
                <button type="button"
                  data-v59-create-search>
                  Create private search
                </button>
              </article>

              <h3>Create look/reveal session</h3>
              <article class="v59-look-builder">
                <select data-v59-viewer>
                  ${playerOptions()}
                </select>
                <select data-v59-look-owner>
                  ${playerOptions()}
                </select>
                <input type="number"
                  min="1"
                  value="3"
                  data-v59-look-amount>
                <label>
                  <input type="checkbox"
                    data-v59-reveal-all>
                  Reveal to all
                </label>
                <label>
                  <input type="checkbox"
                    checked
                    data-v59-allow-reorder>
                  Allow reorder
                </label>
                <label>
                  <input type="checkbox"
                    checked
                    data-v59-allow-bottom>
                  Allow bottom
                </label>
                <button type="button"
                  data-v59-create-look>
                  Create session
                </button>
              </article>
            `
            : ""
        }

        <h3>Public reveals</h3>
        <div class="v59-reveal-grid">
          ${(state?.reveals || [])
            .map(revealCard)
            .join("") ||
            "<p>No cards are currently revealed.</p>"}
        </div>
      </section>
    `;

    document.body.appendChild(
      overlay
    );
  }

  function closePending() {
    document.getElementById(
      "v59PendingOverlay"
    )?.remove();
    activeSessionId = "";
  }

  function searchCandidate(card) {
    return `
      <label class="v59-candidate">
        <input type="checkbox"
          data-v59-select-card
          value="${escapeHtml(
            card.cardId
          )}">
        ${
          cardImage(card.card)
            ? `<img src="${escapeHtml(
                cardImage(card.card)
              )}" alt="">`
            : '<div class="v59-card-back">?</div>'
        }
        <strong>${escapeHtml(
          card.name
        )}</strong>
        <small>
          ${escapeHtml(
            card.typeLine
          )}
          · MV ${card.manaValue}
        </small>
      </label>
    `;
  }

  function lookCandidate(card, index) {
    return `
      <article class="v59-look-card"
        data-v59-look-card="${escapeHtml(
          card.cardId
        )}">
        <span>${index + 1}</span>
        ${
          cardImage(card.card)
            ? `<img src="${escapeHtml(
                cardImage(card.card)
              )}" alt="">`
            : '<div class="v59-card-back">?</div>'
        }
        <strong>${escapeHtml(
          card.name
        )}</strong>
        <label>
          <input type="checkbox"
            data-v59-bottom
            value="${escapeHtml(
              card.cardId
            )}">
          Bottom
        </label>
        <div>
          <button type="button"
            data-v59-look-up>↑</button>
          <button type="button"
            data-v59-look-down>↓</button>
        </div>
      </article>
    `;
  }

  function renderPending(next) {
    closePending();
    if (!next) return;

    activeSessionId = next.id;

    const overlay =
      document.createElement("div");
    overlay.id =
      "v59PendingOverlay";
    overlay.className =
      "v59-pending-overlay";
    overlay.dataset.sessionId =
      next.id;
    overlay.dataset.kind =
      next.kind;

    if (next.kind === "search") {
      overlay.innerHTML = `
        <section>
          <small>PRIVATE LIBRARY SEARCH</small>
          <h2>${escapeHtml(
            next.sourceName
          )}</h2>
          <p>
            Choose ${next.min}–${next.max}
            card(s).
            ${
              next.allowFail
                ? "You may legally fail to find."
                : "A card must be found when available."
            }
            ${
              next.searchTopLimit != null
                ? `Only the top ${next.searchTopLimit} cards are searchable.`
                : ""
            }
          </p>

          <div class="v59-candidate-grid">
            ${(next.candidates || [])
              .map(searchCandidate)
              .join("") ||
              "<p>No matching cards are available.</p>"}
          </div>

          <button type="button"
            data-v59-finish-search>
            Finish search
          </button>
        </section>
      `;
    } else {
      overlay.innerHTML = `
        <section>
          <small>${
            next.revealToAll
              ? "REVEALED TOP CARDS"
              : "PRIVATE LOOK"
          }</small>
          <h2>${escapeHtml(
            next.sourceName
          )}</h2>

          <div class="v59-look-list"
            data-v59-look-list>
            ${(next.cards || [])
              .map(lookCandidate)
              .join("") ||
              "<p>No cards are available.</p>"}
          </div>

          <button type="button"
            data-v59-finish-look>
            Finish
          </button>
        </section>
      `;
    }

    document.body.appendChild(
      overlay
    );
  }

  async function runAction(
    body,
    message,
    closeSheet = true
  ) {
    try {
      await api(
        "/api/hidden-v59/action",
        body
      );

      if (closeSheet) {
        document.getElementById(
          "v59HiddenSheet"
        )?.remove();
      }

      toast(message, "success");
      setTimeout(poll, 40);
    } catch (error) {
      toast(
        error.message ||
        "Hidden-information action failed.",
        "error"
      );
    }
  }

  function reorderLook(row, direction) {
    const list = row.parentElement;
    const sibling =
      direction < 0
        ? row.previousElementSibling
        : row.nextElementSibling;

    if (!sibling) return;

    if (direction < 0) {
      list.insertBefore(row, sibling);
    } else {
      list.insertBefore(sibling, row);
    }

    [
      ...list.querySelectorAll(
        ".v59-look-card"
      )
    ].forEach(
      (entry, index) => {
        const number =
          entry.querySelector(
            ":scope > span"
          );
        if (number) {
          number.textContent =
            String(index + 1);
        }
      }
    );
  }

  function updateBadge() {
    const badge =
      document.querySelector(
        "[data-v59-count]"
      );

    if (badge) {
      badge.textContent =
        String(
          (state?.openSessions?.length || 0) +
          (state?.reveals?.length || 0)
        );
    }
  }

  async function poll() {
    clearTimeout(pollTimer);

    try {
      const [nextState, nextPending] =
        await Promise.all([
          api(
            "/api/hidden-v59/state"
          ),
          api(
            "/api/hidden-v59/pending"
          )
        ]);

      state = nextState;
      pending =
        nextPending.session;

      installButton();
      updateBadge();

      if (
        pending &&
        pending.id !== activeSessionId
      ) {
        renderPending(pending);
      } else if (!pending) {
        closePending();
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
          "#v59HiddenButton"
        )
      ) {
        event.preventDefault();
        showSheet();
        return;
      }

      if (
        event.target.closest(
          "[data-v59-close]"
        )
      ) {
        event.preventDefault();
        document.getElementById(
          "v59HiddenSheet"
        )?.remove();
        return;
      }

      if (
        event.target.closest(
          "[data-v59-shuffle-self]"
        )
      ) {
        event.preventDefault();
        runAction(
          {
            type:
              "hidden-v59-shuffle"
          },
          "Library shuffled."
        );
        return;
      }

      if (
        event.target.closest(
          "[data-v59-reveal-hand]"
        )
      ) {
        event.preventDefault();
        runAction(
          {
            type:
              "hidden-v59-reveal-hand",
            persistent: false
          },
          "Hand revealed."
        );
        return;
      }

      const clearReveal =
        event.target.closest(
          "[data-v59-clear-reveal]"
        );
      if (clearReveal) {
        event.preventDefault();
        runAction(
          {
            type:
              "hidden-v59-clear-reveal",
            revealId:
              clearReveal.dataset
                .v59ClearReveal
          },
          "Reveal cleared."
        );
        return;
      }

      if (
        event.target.closest(
          "[data-v59-create-search]"
        )
      ) {
        event.preventDefault();
        const sheet =
          document.getElementById(
            "v59HiddenSheet"
          );

        runAction(
          {
            type:
              "hidden-v59-create-search",
            searcherId:
              sheet.querySelector(
                "[data-v59-searcher]"
              )?.value || "",
            libraryOwnerId:
              sheet.querySelector(
                "[data-v59-library-owner]"
              )?.value || "",
            quality:
              sheet.querySelector(
                "[data-v59-quality]"
              )?.value || "",
            min:
              Number(
                sheet.querySelector(
                  "[data-v59-min]"
                )?.value || 0
              ),
            max:
              Number(
                sheet.querySelector(
                  "[data-v59-max]"
                )?.value || 1
              ),
            destinationZone:
              sheet.querySelector(
                "[data-v59-destination]"
              )?.value || "hand",
            upTo: Boolean(
              sheet.querySelector(
                "[data-v59-up-to]"
              )?.checked
            ),
            revealFound: Boolean(
              sheet.querySelector(
                "[data-v59-reveal-found]"
              )?.checked
            ),
            shuffleAfter: Boolean(
              sheet.querySelector(
                "[data-v59-shuffle-after]"
              )?.checked
            ),
            tapped: Boolean(
              sheet.querySelector(
                "[data-v59-tapped]"
              )?.checked
            )
          },
          "Private library search created."
        );
        return;
      }

      if (
        event.target.closest(
          "[data-v59-create-look]"
        )
      ) {
        event.preventDefault();
        const sheet =
          document.getElementById(
            "v59HiddenSheet"
          );

        runAction(
          {
            type:
              "hidden-v59-create-look",
            viewerId:
              sheet.querySelector(
                "[data-v59-viewer]"
              )?.value || "",
            libraryOwnerId:
              sheet.querySelector(
                "[data-v59-look-owner]"
              )?.value || "",
            amount:
              Number(
                sheet.querySelector(
                  "[data-v59-look-amount]"
                )?.value || 1
              ),
            revealToAll: Boolean(
              sheet.querySelector(
                "[data-v59-reveal-all]"
              )?.checked
            ),
            allowReorder: Boolean(
              sheet.querySelector(
                "[data-v59-allow-reorder]"
              )?.checked
            ),
            allowBottom: Boolean(
              sheet.querySelector(
                "[data-v59-allow-bottom]"
              )?.checked
            )
          },
          "Look/reveal session created."
        );
        return;
      }

      if (
        event.target.closest(
          "[data-v59-finish-search]"
        )
      ) {
        event.preventDefault();

        const overlay =
          document.getElementById(
            "v59PendingOverlay"
          );

        const selectedCardIds = [
          ...overlay.querySelectorAll(
            "[data-v59-select-card]:checked"
          )
        ].map((input) => input.value);

        runAction(
          {
            type:
              "hidden-v59-resolve-search",
            sessionId:
              overlay.dataset.sessionId,
            selectedCardIds
          },
          "Library search resolved.",
          false
        );
        closePending();
        return;
      }

      const up =
        event.target.closest(
          "[data-v59-look-up]"
        );
      if (up) {
        event.preventDefault();
        reorderLook(
          up.closest(
            ".v59-look-card"
          ),
          -1
        );
        return;
      }

      const down =
        event.target.closest(
          "[data-v59-look-down]"
        );
      if (down) {
        event.preventDefault();
        reorderLook(
          down.closest(
            ".v59-look-card"
          ),
          1
        );
        return;
      }

      if (
        event.target.closest(
          "[data-v59-finish-look]"
        )
      ) {
        event.preventDefault();
        const overlay =
          document.getElementById(
            "v59PendingOverlay"
          );

        const rows = [
          ...overlay.querySelectorAll(
            ".v59-look-card"
          )
        ];

        const bottomCardIds = rows
          .filter(
            (row) =>
              row.querySelector(
                "[data-v59-bottom]"
              )?.checked
          )
          .map(
            (row) =>
              row.dataset.v59LookCard
          );

        const topOrder = rows
          .filter(
            (row) =>
              !bottomCardIds.includes(
                row.dataset.v59LookCard
              )
          )
          .map(
            (row) =>
              row.dataset.v59LookCard
          );

        runAction(
          {
            type:
              "hidden-v59-resolve-look",
            sessionId:
              overlay.dataset.sessionId,
            bottomCardIds,
            topOrder
          },
          "Library order updated.",
          false
        );
        closePending();
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

  window.ArenaCommanderV59 = {
    version: VERSION,
    refresh: poll
  };
})();
