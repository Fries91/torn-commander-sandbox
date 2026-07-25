(() => {
  "use strict";

  const VERSION = "61.2.0";
  const FULL_ART_CLASS = "v612-full-card";
  let repairQueued = false;

  function currentRoom() {
    return (
      window.ArenaCommanderPlaymatV610?.getRoom?.() ||
      window.__arenaCommanderRoomV610 ||
      null
    );
  }

  function allCards(room) {
    const cards = new Map();
    if (!room) return cards;

    for (const player of room.players || []) {
      const game = player.game || {};
      for (const zone of [
        "hand",
        "battlefield",
        "graveyard",
        "exile",
        "commandZone"
      ]) {
        for (const card of game[zone] || []) {
          if (card?.id) cards.set(String(card.id), card);
        }
      }
    }

    for (const item of room.stack || []) {
      if (item?.card?.id) cards.set(String(item.card.id), item.card);
    }

    return cards;
  }

  function activeFace(card) {
    const index = Math.max(0, Number(card?.activeFaceIndex || 0));
    return (
      card?.currentFace ||
      card?.cardData?.faces?.[index] ||
      card?.cardData?.faces?.[0] ||
      null
    );
  }

  function fullCardImage(card) {
    const face = activeFace(card);
    return (
      face?.imageUrl ||
      card?.cardData?.imageUrl ||
      card?.imageUrl ||
      ""
    );
  }

  function installFullImage(cardElement, card) {
    if (!cardElement || !card || card.faceDown) return;

    const fullImage = fullCardImage(card);
    if (!fullImage) return;

    const imageBox = cardElement.querySelector(".arena-card-image");
    if (!imageBox) return;

    let image = imageBox.querySelector("img");
    if (!image) {
      imageBox.replaceChildren();
      image = document.createElement("img");
      imageBox.appendChild(image);
    }

    const previous = image.currentSrc || image.src || "";
    if (!image.dataset.v612Fallback && previous && previous !== fullImage) {
      image.dataset.v612Fallback = previous;
    }

    if (image.dataset.v612FullSource !== fullImage) {
      image.dataset.v612FullSource = fullImage;
      image.removeAttribute("srcset");
      image.src = fullImage;
      image.alt = card.name || "Magic card";
      image.loading = "eager";
      image.decoding = "async";
      image.referrerPolicy = "no-referrer";

      image.onerror = () => {
        const fallback = image.dataset.v612Fallback;
        if (fallback && image.src !== fallback) {
          image.src = fallback;
        }
      };
    }

    cardElement.classList.add(FULL_ART_CLASS, "v610-real-card");
  }

  function repairArtwork(shell) {
    const cards = allCards(currentRoom());
    if (!cards.size) return;

    for (const element of shell.querySelectorAll(".arena-card[data-card-id]")) {
      const card = cards.get(String(element.dataset.cardId || ""));
      if (card) installFullImage(element, card);
    }
  }

  function ensureLeaveButton(shell) {
    const actions = shell.querySelector(".arena-game-topbar .arena-top-actions");
    if (!actions || actions.querySelector(".v612-leave-match")) return;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "v612-leave-match";
    button.dataset.action = "leave-room";
    button.title = "Leave this match";
    button.setAttribute("aria-label", "Leave match");
    button.innerHTML = "<span>↩</span><b>LEAVE</b>";
    actions.appendChild(button);
  }

  function repair() {
    const shell = document.querySelector(".arena-game-shell");
    document.body.classList.toggle("v612-game-visible", Boolean(shell));
    if (!shell) return;

    shell.classList.add("arena-v612");
    repairArtwork(shell);
    ensureLeaveButton(shell);
  }

  function scheduleRepair() {
    if (repairQueued) return;
    repairQueued = true;
    requestAnimationFrame(() => {
      repairQueued = false;
      repair();
    });
  }

  document.addEventListener(
    "click",
    (event) => {
      const leave = event.target.closest?.(".v612-leave-match");
      if (!leave) return;
      const confirmed = window.confirm(
        "Leave this match? Your seat stays saved so you can reconnect unless you concede separately."
      );
      if (!confirmed) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
    true
  );

  function start() {
    const app = document.getElementById("app");
    if (!app) return;

    const observer = new MutationObserver(scheduleRepair);
    observer.observe(app, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["src", "class"]
    });

    repair();
    window.setInterval(repair, 1500);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }

  window.ArenaCommanderArtworkLeaveV612 = {
    version: VERSION,
    repair
  };
})();
