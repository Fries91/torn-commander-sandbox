(() => {
  "use strict";

  const VERSION = "56.0.0";
  const SESSION_KEY =
    "tornCommander.session.v5";

  let state = null;
  let pollTimer = null;
  let activeChoiceId = "";
  let activeVoteId = "";

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
        "v56MultiplayerButton"
      )
    ) {
      return;
    }

    const button =
      document.createElement("button");
    button.type = "button";
    button.id = "v56MultiplayerButton";
    button.className =
      "arena-hotfix-control v56-multiplayer-button";
    button.innerHTML =
      '<span>♜</span><small>Table</small><b data-v56-alert>0</b>';
    actions.appendChild(button);
  }

  function designationPanel() {
    return `
      <div class="v56-designations">
        <article>
          <span class="v56-crown">♛</span>
          <div>
            <small>THE MONARCH</small>
            <strong>${escapeHtml(
              state?.monarchName || "No monarch"
            )}</strong>
          </div>
          <button type="button"
            data-v56-monarch>
            Become monarch
          </button>
        </article>

        <article>
          <span class="v56-initiative">◆</span>
          <div>
            <small>THE INITIATIVE</small>
            <strong>${escapeHtml(
              state?.initiativeName ||
              "No initiative holder"
            )}</strong>
          </div>
          <button type="button"
            data-v56-initiative>
            Take initiative
          </button>
        </article>
      </div>
    `;
  }

  function dungeonTrack(entry) {
    return `
      <article class="v56-dungeon-track">
        <header>
          <strong>${escapeHtml(
            entry.playerName
          )}</strong>
          <span>
            ${entry.completed} completed
          </span>
        </header>

        ${
          entry.track
            ? `
              <small>${escapeHtml(
                entry.track.dungeonName
              )}</small>
              <strong>${escapeHtml(
                entry.track.roomName
              )}</strong>
              <p>${escapeHtml(
                entry.track.roomText
              )}</p>
            `
            : "<p>Not currently in a dungeon.</p>"
        }
      </article>
    `;
  }

  function voteCard(vote) {
    const result = vote.result;
    const ballots = Object.values(
      vote.ballots || {}
    ).flat();

    return `
      <article class="v56-vote-card">
        <header>
          <strong>${escapeHtml(
            vote.title
          )}</strong>
          <span>${escapeHtml(
            vote.mode
          )}</span>
        </header>

        <small>
          ${escapeHtml(vote.sourceName || "")}
        </small>

        ${
          vote.status === "complete"
            ? `
              <div class="v56-vote-results">
                ${Object.entries(
                  result?.counts || {}
                )
                  .map(
                    ([option, count]) =>
                      `<span><strong>${escapeHtml(
                        option
                      )}</strong> ${count}</span>`
                  )
                  .join("")}
              </div>
            `
            : `
              <p>
                ${
                  vote.secret
                    ? `${ballots.length} hidden vote(s) submitted`
                    : vote.currentVoterName
                      ? `${escapeHtml(
                          vote.currentVoterName
                        )} votes next`
                      : "Waiting for votes"
                }
              </p>
            `
        }
      </article>
    `;
  }

  function showSheet() {
    document.getElementById(
      "v56MultiplayerSheet"
    )?.remove();

    const overlay =
      document.createElement("div");
    overlay.id =
      "v56MultiplayerSheet";
    overlay.className =
      "v56-multiplayer-sheet";

    overlay.innerHTML = `
      <section>
        <header>
          <div>
            <small>MONARCH, INITIATIVE, DUNGEONS & VOTING</small>
            <h2>${escapeHtml(
              state?.phase || "Game"
            )}</h2>
          </div>
          <button type="button"
            data-v56-close>×</button>
        </header>

        ${designationPanel()}

        <div class="v56-venture-actions">
          <button type="button"
            data-v56-venture="normal">
            Venture into the dungeon
          </button>
          <button type="button"
            data-v56-venture="undercity">
            Venture into Undercity
          </button>
        </div>

        <h3>Dungeon progress</h3>
        <div class="v56-dungeon-grid">
          ${(state?.dungeons || [])
            .map(dungeonTrack)
            .join("")}
        </div>

        <h3>Start a table vote</h3>
        <article class="v56-vote-builder">
          <input type="text"
            data-v56-vote-title
            maxlength="160"
            placeholder="Vote title">

          <select data-v56-vote-mode>
            <option value="will">
              Will of the council
            </option>
            <option value="dilemma">
              Council's dilemma
            </option>
            <option value="secret">
              Secret council
            </option>
          </select>

          <textarea data-v56-vote-options
            placeholder="One option per line"></textarea>

          <button type="button"
            data-v56-start-vote>
            Start vote
          </button>
        </article>

        <h3>Active and recent votes</h3>
        <div class="v56-vote-grid">
          ${(state?.votes || [])
            .map(voteCard)
            .join("") ||
            "<p>No active or recent votes.</p>"}
        </div>
      </section>
    `;

    document.body.appendChild(overlay);
  }

  async function runAction(body, message) {
    try {
      await api(
        "/api/multiplayer-v56/action",
        body
      );
      document.getElementById(
        "v56MultiplayerSheet"
      )?.remove();
      toast(message, "success");
      setTimeout(poll, 40);
    } catch (error) {
      toast(
        error.message ||
        "Multiplayer action failed.",
        "error"
      );
    }
  }

  function closePending() {
    document.getElementById(
      "v56PendingOverlay"
    )?.remove();
    activeChoiceId = "";
    activeVoteId = "";
  }

  function genericChoiceButtons(choice) {
    if (choice.kind === "dungeon-start") {
      return choice.candidates.map(
        (entry) => `
          <button type="button"
            data-v56-choice-dungeon="${escapeHtml(
              entry.dungeonId
            )}">
            <strong>${escapeHtml(
              entry.name
            )}</strong>
          </button>
        `
      ).join("");
    }

    if (choice.kind === "dungeon-path") {
      return choice.candidates.map(
        (entry) => `
          <button type="button"
            data-v56-choice-room="${escapeHtml(
              entry.roomId
            )}">
            <strong>${escapeHtml(
              entry.name
            )}</strong>
            <small>${escapeHtml(
              entry.text
            )}</small>
          </button>
        `
      ).join("");
    }

    if (
      choice.kind === "dungeon-target-creature" ||
      choice.kind === "dungeon-target-player"
    ) {
      return choice.candidates.map(
        (entry) => `
          <button type="button"
            data-v56-choice-target="${escapeHtml(
              entry.targetKey
            )}">
            ${
              entry.card && cardImage(entry.card)
                ? `<img src="${escapeHtml(
                    cardImage(entry.card)
                  )}" alt="">`
                : ""
            }
            <strong>${escapeHtml(
              entry.name
            )}</strong>
          </button>
        `
      ).join("");
    }

    if (choice.kind === "dungeon-search-basic") {
      return `
        ${choice.candidates.map(
          (entry) => `
            <button type="button"
              data-v56-choice-card="${escapeHtml(
                entry.cardId
              )}">
              <strong>${escapeHtml(
                entry.name
              )}</strong>
            </button>
          `
        ).join("")}
        <button type="button"
          data-v56-choice-card="">
          Find no card
        </button>
      `;
    }

    if (choice.kind === "dungeon-free-cast") {
      return `
        ${choice.candidates.map(
          (entry) => `
            <button type="button"
              data-v56-choice-card="${escapeHtml(
                entry.cardId
              )}">
              <strong>Cast ${escapeHtml(
                entry.name
              )}</strong>
            </button>
          `
        ).join("")}
        <button type="button"
          data-v56-choice-card="">
          Cast none
        </button>
      `;
    }

    if (choice.kind === "dungeon-throne") {
      return `
        ${choice.candidates.map(
          (entry) => `
            <button type="button"
              data-v56-choice-card="${escapeHtml(
                entry.cardId
              )}">
              ${
                cardImage(entry.card)
                  ? `<img src="${escapeHtml(
                      cardImage(entry.card)
                    )}" alt="">`
                  : ""
              }
              <strong>${escapeHtml(
                entry.name
              )}</strong>
            </button>
          `
        ).join("")}
        <button type="button"
          data-v56-choice-card="">
          Put no creature onto the battlefield
        </button>
      `;
    }

    if (choice.kind === "dungeon-group-choice") {
      return `
        <button type="button"
          data-v56-group-option="life">
          Lose ${choice.amount} life
        </button>
        <button type="button"
          data-v56-group-option="${
            choice.choiceType ===
            "discard-or-life"
              ? "discard"
              : "sacrifice"
          }">
          ${
            choice.choiceType ===
            "discard-or-life"
              ? "Discard a card"
              : "Sacrifice a permanent"
          }
        </button>
      `;
    }

    if (choice.kind === "dungeon-scry") {
      return `
        <div class="v56-scry-cards">
          ${choice.cards.map(
            (entry) => `
              <label>
                <input type="checkbox"
                  data-v56-scry-bottom
                  value="${escapeHtml(
                    entry.cardId
                  )}">
                <strong>${escapeHtml(
                  entry.name
                )}</strong>
                <small>Check to put on bottom</small>
              </label>
            `
          ).join("")}
        </div>
        <button type="button"
          data-v56-resolve-scry>
          Finish scry
        </button>
      `;
    }

    if (choice.kind === "dungeon-oubliette") {
      return `
        <p>
          Choose the required cards in the Judge/manual controls,
          then finish this room through Judge Mode.
        </p>
      `;
    }

    return "<p>This choice requires Judge Mode.</p>";
  }

  function renderChoice(choice) {
    closePending();
    activeChoiceId = choice.id;

    const overlay =
      document.createElement("div");
    overlay.id = "v56PendingOverlay";
    overlay.className =
      "v56-pending-overlay";
    overlay.dataset.choiceId = choice.id;
    overlay.dataset.kind = choice.kind;

    overlay.innerHTML = `
      <section>
        <small>DUNGEON CHOICE</small>
        <h2>${escapeHtml(
          choice.roomName ||
          choice.dungeonName ||
          "Choose"
        )}</h2>
        <div class="v56-choice-grid">
          ${genericChoiceButtons(choice)}
        </div>
      </section>
    `;

    document.body.appendChild(overlay);
  }

  function renderVote(vote) {
    closePending();
    activeVoteId = vote.id;

    const overlay =
      document.createElement("div");
    overlay.id = "v56PendingOverlay";
    overlay.className =
      "v56-pending-overlay";
    overlay.dataset.voteId = vote.id;

    overlay.innerHTML = `
      <section>
        <small>${
          vote.secret
            ? "SECRET COUNCIL"
            : "TABLE VOTE"
        }</small>
        <h2>${escapeHtml(
          vote.title
        )}</h2>

        <p>
          You may cast
          ${vote.viewerVotesAllowed -
          vote.viewerVotesUsed}
          more vote(s).
        </p>

        <div class="v56-choice-grid">
          ${vote.options.map(
            (option) => `
              <button type="button"
                data-v56-vote-option="${escapeHtml(
                  option
                )}">
                <strong>${escapeHtml(
                  option
                )}</strong>
              </button>
            `
          ).join("")}
        </div>
      </section>
    `;

    document.body.appendChild(overlay);
  }

  async function resolveChoice(body) {
    const overlay =
      document.getElementById(
        "v56PendingOverlay"
      );
    if (!overlay) return;

    try {
      await api(
        "/api/multiplayer-v56/resolve-choice",
        {
          choiceId:
            overlay.dataset.choiceId,
          ...body
        }
      );
      closePending();
      toast("Dungeon choice resolved.", "success");
      setTimeout(poll, 40);
    } catch (error) {
      toast(
        error.message ||
        "Unable to resolve the choice.",
        "error"
      );
    }
  }

  async function castVote(option) {
    const overlay =
      document.getElementById(
        "v56PendingOverlay"
      );
    if (!overlay) return;

    try {
      const result = await api(
        "/api/multiplayer-v56/action",
        {
          type: "multiplayer-v56-vote",
          voteId:
            overlay.dataset.voteId,
          option
        }
      );

      closePending();
      toast(
        result.result?.complete
          ? "Voting complete."
          : "Vote recorded.",
        "success"
      );
      setTimeout(poll, 40);
    } catch (error) {
      toast(
        error.message ||
        "Unable to cast that vote.",
        "error"
      );
    }
  }

  function updateBadge(pending) {
    const badge =
      document.querySelector(
        "[data-v56-alert]"
      );
    if (!badge) return;

    badge.textContent = String(
      (pending?.choice ? 1 : 0) +
      (pending?.vote ? 1 : 0)
    );
  }

  async function poll() {
    clearTimeout(pollTimer);

    try {
      const [nextState, pending] =
        await Promise.all([
          api(
            "/api/multiplayer-v56/state"
          ),
          api(
            "/api/multiplayer-v56/pending"
          )
        ]);

      state = nextState;
      installButton();
      updateBadge(pending);

      if (
        pending.choice &&
        pending.choice.id !== activeChoiceId
      ) {
        renderChoice(pending.choice);
      } else if (
        pending.vote &&
        pending.vote.id !== activeVoteId
      ) {
        renderVote(pending.vote);
      } else if (
        !pending.choice &&
        !pending.vote
      ) {
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
          "#v56MultiplayerButton"
        )
      ) {
        event.preventDefault();
        showSheet();
        return;
      }

      if (
        event.target.closest(
          "[data-v56-close]"
        )
      ) {
        event.preventDefault();
        document.getElementById(
          "v56MultiplayerSheet"
        )?.remove();
        return;
      }

      if (
        event.target.closest(
          "[data-v56-monarch]"
        )
      ) {
        event.preventDefault();
        runAction(
          {
            type:
              "multiplayer-v56-monarch"
          },
          "You became the monarch."
        );
        return;
      }

      if (
        event.target.closest(
          "[data-v56-initiative]"
        )
      ) {
        event.preventDefault();
        runAction(
          {
            type:
              "multiplayer-v56-initiative"
          },
          "You took the initiative."
        );
        return;
      }

      const venture =
        event.target.closest(
          "[data-v56-venture]"
        );
      if (venture) {
        event.preventDefault();
        runAction(
          {
            type:
              "multiplayer-v56-venture",
            mode:
              venture.dataset.v56Venture
          },
          "Dungeon venture started."
        );
        return;
      }

      if (
        event.target.closest(
          "[data-v56-start-vote]"
        )
      ) {
        event.preventDefault();
        const sheet =
          document.getElementById(
            "v56MultiplayerSheet"
          );
        const options = String(
          sheet.querySelector(
            "[data-v56-vote-options]"
          )?.value || ""
        )
          .split(/\n+/)
          .map((entry) => entry.trim())
          .filter(Boolean);

        runAction(
          {
            type:
              "multiplayer-v56-start-vote",
            title:
              sheet.querySelector(
                "[data-v56-vote-title]"
              )?.value ||
              "Table vote",
            mode:
              sheet.querySelector(
                "[data-v56-vote-mode]"
              )?.value ||
              "will",
            options
          },
          "Vote started."
        );
        return;
      }

      const dungeon =
        event.target.closest(
          "[data-v56-choice-dungeon]"
        );
      if (dungeon) {
        event.preventDefault();
        resolveChoice({
          dungeonId:
            dungeon.dataset
              .v56ChoiceDungeon
        });
        return;
      }

      const room =
        event.target.closest(
          "[data-v56-choice-room]"
        );
      if (room) {
        event.preventDefault();
        resolveChoice({
          roomId:
            room.dataset.v56ChoiceRoom
        });
        return;
      }

      const target =
        event.target.closest(
          "[data-v56-choice-target]"
        );
      if (target) {
        event.preventDefault();
        resolveChoice({
          targetKey:
            target.dataset
              .v56ChoiceTarget
        });
        return;
      }

      const card =
        event.target.closest(
          "[data-v56-choice-card]"
        );
      if (card) {
        event.preventDefault();
        resolveChoice({
          cardId:
            card.dataset.v56ChoiceCard
        });
        return;
      }

      const group =
        event.target.closest(
          "[data-v56-group-option]"
        );
      if (group) {
        event.preventDefault();
        const option =
          group.dataset.v56GroupOption;

        if (
          option === "discard" ||
          option === "sacrifice"
        ) {
          toast(
            "Select the card through Judge Mode for this room, then resolve it.",
            "warning"
          );
          return;
        }

        resolveChoice({ option });
        return;
      }

      if (
        event.target.closest(
          "[data-v56-resolve-scry]"
        )
      ) {
        event.preventDefault();
        const overlay =
          document.getElementById(
            "v56PendingOverlay"
          );
        const bottomCardIds = [
          ...overlay.querySelectorAll(
            "[data-v56-scry-bottom]:checked"
          )
        ].map((input) => input.value);

        resolveChoice({
          bottomCardIds,
          topOrder: []
        });
        return;
      }

      const voteOption =
        event.target.closest(
          "[data-v56-vote-option]"
        );
      if (voteOption) {
        event.preventDefault();
        castVote(
          voteOption.dataset
            .v56VoteOption
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

  window.ArenaCommanderV56 = {
    version: VERSION,
    refresh: poll
  };
})();
