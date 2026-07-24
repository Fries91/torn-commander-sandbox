"use strict";

function list(value) {
  return Array.isArray(value) ? value : [];
}

function unique(value) {
  return [...new Set(list(value).map(String).filter(Boolean))];
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

const DUNGEONS = {
  lost_mine: {
    id: "lost_mine",
    name: "Lost Mine of Phandelver",
    entrance: "cave_entrance",
    undercityOnly: false,
    rooms: {
      cave_entrance: {
        name: "Cave Entrance",
        text: "Scry 1.",
        next: ["goblin_lair", "mine_tunnels"],
        effect: { kind: "scry", amount: 1 }
      },
      goblin_lair: {
        name: "Goblin Lair",
        text: "Create a 1/1 red Goblin creature token.",
        next: ["storeroom", "dark_pool"],
        effect: {
          kind: "token",
          name: "Goblin",
          typeLine: "Token Creature — Goblin",
          power: "1",
          toughness: "1",
          color: "R"
        }
      },
      mine_tunnels: {
        name: "Mine Tunnels",
        text: "Create a Treasure token.",
        next: ["dark_pool", "fungi_cavern"],
        effect: { kind: "treasure" }
      },
      storeroom: {
        name: "Storeroom",
        text: "Put a +1/+1 counter on target creature.",
        next: ["temple"],
        effect: {
          kind: "target-creature",
          action: "counter",
          amount: 1
        }
      },
      dark_pool: {
        name: "Dark Pool",
        text: "Each opponent loses 1 life and you gain 1 life.",
        next: ["temple"],
        effect: { kind: "dark-pool" }
      },
      fungi_cavern: {
        name: "Fungi Cavern",
        text: "Target creature gets -4/-0 until your next turn.",
        next: ["temple"],
        effect: {
          kind: "target-creature",
          action: "power-penalty",
          amount: 4
        }
      },
      temple: {
        name: "Temple of Dumathoin",
        text: "Draw a card.",
        next: [],
        effect: { kind: "draw", amount: 1 }
      }
    }
  },

  mad_mage: {
    id: "mad_mage",
    name: "Dungeon of the Mad Mage",
    entrance: "yawning_portal",
    undercityOnly: false,
    rooms: {
      yawning_portal: {
        name: "Yawning Portal",
        text: "You gain 1 life.",
        next: ["dungeon_level"],
        effect: { kind: "gain-life", amount: 1 }
      },
      dungeon_level: {
        name: "Dungeon Level",
        text: "Scry 1.",
        next: ["goblin_bazaar", "twisted_caverns"],
        effect: { kind: "scry", amount: 1 }
      },
      goblin_bazaar: {
        name: "Goblin Bazaar",
        text: "Create a Treasure token.",
        next: ["lost_level"],
        effect: { kind: "treasure" }
      },
      twisted_caverns: {
        name: "Twisted Caverns",
        text: "Target creature can't attack until your next turn.",
        next: ["lost_level"],
        effect: {
          kind: "target-creature",
          action: "cant-attack"
        }
      },
      lost_level: {
        name: "Lost Level",
        text: "Scry 2.",
        next: ["runestone_caverns", "muirals_graveyard"],
        effect: { kind: "scry", amount: 2 }
      },
      runestone_caverns: {
        name: "Runestone Caverns",
        text: "Exile the top two cards of your library. You may play them.",
        next: ["deep_mines"],
        effect: { kind: "impulse", amount: 2 }
      },
      muirals_graveyard: {
        name: "Muiral's Graveyard",
        text: "Create two 1/1 black Skeleton creature tokens.",
        next: ["deep_mines"],
        effect: {
          kind: "token",
          name: "Skeleton",
          typeLine: "Token Creature — Skeleton",
          power: "1",
          toughness: "1",
          color: "B",
          amount: 2
        }
      },
      deep_mines: {
        name: "Deep Mines",
        text: "Scry 3.",
        next: ["mad_wizards_lair"],
        effect: { kind: "scry", amount: 3 }
      },
      mad_wizards_lair: {
        name: "Mad Wizard's Lair",
        text: "Draw three cards, then you may cast one without paying its mana cost.",
        next: [],
        effect: { kind: "mad-wizard" }
      }
    }
  },

  tomb: {
    id: "tomb",
    name: "Tomb of Annihilation",
    entrance: "trapped_entry",
    undercityOnly: false,
    rooms: {
      trapped_entry: {
        name: "Trapped Entry",
        text: "Each player loses 1 life.",
        next: ["veils_of_fear", "oubliette"],
        effect: { kind: "each-player-loses", amount: 1 }
      },
      veils_of_fear: {
        name: "Veils of Fear",
        text: "Each player loses 2 life unless they discard a card.",
        next: ["sandfall_cell"],
        effect: {
          kind: "group-choice",
          choiceType: "discard-or-life",
          amount: 2
        }
      },
      oubliette: {
        name: "Oubliette",
        text: "Discard a card and sacrifice an artifact, a creature, and a land.",
        next: ["cradle"],
        effect: { kind: "oubliette" }
      },
      sandfall_cell: {
        name: "Sandfall Cell",
        text: "Each player loses 2 life unless they sacrifice an artifact, a creature, or a land.",
        next: ["cradle"],
        effect: {
          kind: "group-choice",
          choiceType: "sacrifice-or-life",
          amount: 2
        }
      },
      cradle: {
        name: "Cradle of the Death God",
        text: "Create The Atropal, a legendary 4/4 black God Horror creature token with deathtouch.",
        next: [],
        effect: {
          kind: "token",
          name: "The Atropal",
          typeLine: "Legendary Token Creature — God Horror",
          power: "4",
          toughness: "4",
          color: "B",
          keywords: ["Deathtouch"]
        }
      }
    }
  },

  undercity: {
    id: "undercity",
    name: "Undercity",
    entrance: "secret_entrance",
    undercityOnly: true,
    rooms: {
      secret_entrance: {
        name: "Secret Entrance",
        text: "Search your library for a basic land card, reveal it, put it into your hand, then shuffle.",
        next: ["forge", "lost_well"],
        effect: { kind: "search-basic" }
      },
      forge: {
        name: "Forge",
        text: "Put two +1/+1 counters on target creature.",
        next: ["trap", "arena"],
        effect: {
          kind: "target-creature",
          action: "counter",
          amount: 2
        }
      },
      lost_well: {
        name: "Lost Well",
        text: "Scry 2.",
        next: ["arena", "stash"],
        effect: { kind: "scry", amount: 2 }
      },
      trap: {
        name: "Trap!",
        text: "Target player loses 5 life.",
        next: ["archives"],
        effect: {
          kind: "target-player",
          action: "lose-life",
          amount: 5
        }
      },
      arena: {
        name: "Arena",
        text: "Goad target creature.",
        next: ["archives", "catacombs"],
        effect: {
          kind: "target-creature",
          action: "goad"
        }
      },
      stash: {
        name: "Stash",
        text: "Create a Treasure token.",
        next: ["catacombs"],
        effect: { kind: "treasure" }
      },
      archives: {
        name: "Archives",
        text: "Draw a card.",
        next: ["throne"],
        effect: { kind: "draw", amount: 1 }
      },
      catacombs: {
        name: "Catacombs",
        text: "Create a 4/1 black Skeleton creature token with menace.",
        next: ["throne"],
        effect: {
          kind: "token",
          name: "Skeleton",
          typeLine: "Token Creature — Skeleton",
          power: "4",
          toughness: "1",
          color: "B",
          keywords: ["Menace"]
        }
      },
      throne: {
        name: "Throne of the Dead Three",
        text: "Reveal the top ten cards of your library. Put a creature card from among them onto the battlefield with three +1/+1 counters on it. It gains hexproof until your next turn. Then shuffle.",
        next: [],
        effect: { kind: "throne" }
      }
    }
  }
};

function normalizeState(room) {
  room.multiplayerV56 =
    room.multiplayerV56 && typeof room.multiplayerV56 === "object"
      ? room.multiplayerV56
      : {};

  const state = room.multiplayerV56;
  state.monarchPlayerId = state.monarchPlayerId || null;
  state.initiativePlayerId = state.initiativePlayerId || null;
  state.dungeonsByPlayer =
    state.dungeonsByPlayer &&
    typeof state.dungeonsByPlayer === "object"
      ? state.dungeonsByPlayer
      : {};
  state.completedByPlayer =
    state.completedByPlayer &&
    typeof state.completedByPlayer === "object"
      ? state.completedByPlayer
      : {};
  state.choices = list(state.choices)
    .filter((choice) => choice && choice.id && choice.status === "open")
    .slice(-100);
  state.votes =
    state.votes && typeof state.votes === "object"
      ? state.votes
      : {};
  state.phaseTriggers =
    state.phaseTriggers && typeof state.phaseTriggers === "object"
      ? state.phaseTriggers
      : {};
  state.specialStack =
    state.specialStack && typeof state.specialStack === "object"
      ? state.specialStack
      : {};
  state.impulsePermissions =
    state.impulsePermissions &&
    typeof state.impulsePermissions === "object"
      ? state.impulsePermissions
      : {};
  state.history = list(state.history).slice(-150);
  state.lastError = state.lastError || null;

  for (const player of room.players || []) {
    state.completedByPlayer[player.id] =
      Math.max(0, Number(state.completedByPlayer[player.id]) || 0);
  }

  return state;
}

function currentFace(card, deps) {
  return deps.currentCardFace(card) || card?.cardData || {};
}

function typeLine(card, deps) {
  return String(deps.currentTypeLine(card) || "");
}

function oracle(card, deps) {
  return String(deps.currentOracleText(card) || "");
}

function activePlayers(room) {
  return room.players.filter(
    (player) => player.game && !player.game.lost && !player.game.conceded
  );
}

function findPlayer(room, playerId, deps) {
  return deps.findPlayer(room, String(playerId || ""));
}

function turnOrderFrom(room, startingPlayerId) {
  const active = activePlayers(room);
  if (!active.length) return [];

  const configured = list(room.turn?.order);
  const order = configured.length
    ? configured.filter((id) => active.some((player) => player.id === id))
    : active.map((player) => player.id);

  for (const player of active) {
    if (!order.includes(player.id)) order.push(player.id);
  }

  const index = Math.max(0, order.indexOf(startingPlayerId));
  return [...order.slice(index), ...order.slice(0, index)];
}

function nextActivePlayer(room, fromPlayerId, deps) {
  const order = turnOrderFrom(room, fromPlayerId);
  if (!order.length) return null;

  const currentIndex = order.indexOf(fromPlayerId);
  const rotated =
    currentIndex >= 0
      ? [...order.slice(currentIndex + 1), ...order.slice(0, currentIndex + 1)]
      : order;

  return rotated
    .map((id) => findPlayer(room, id, deps))
    .find((player) => player?.game && !player.game.lost && !player.game.conceded) || null;
}

function designationSuccessor(room, holderId, deps) {
  const activeId = room.turn?.activePlayerId;
  const active = findPlayer(room, activeId, deps);

  if (active?.game && !active.game.lost && !active.game.conceded && active.id !== holderId) {
    return active;
  }

  return nextActivePlayer(room, holderId, deps);
}

function handleDepartedHolders(room, deps) {
  const state = normalizeState(room);

  for (const key of ["monarchPlayerId", "initiativePlayerId"]) {
    const holderId = state[key];
    if (!holderId) continue;

    const holder = findPlayer(room, holderId, deps);
    if (holder?.game && !holder.game.lost && !holder.game.conceded) continue;

    const successor = designationSuccessor(room, holderId, deps);
    state[key] = successor?.id || null;

    if (successor) {
      deps.addLog(
        room,
        `${successor.name} became the ${key === "monarchPlayerId" ? "monarch" : "initiative holder"} after the previous holder left the game.`,
        "multiplayer"
      );

      if (key === "initiativePlayerId") {
        queueSpecialStack(room, successor.id, "initiative-venture", deps);
      }
    }
  }
}

function drawCards(player, amount) {
  const drawn = [];
  for (let index = 0; index < Math.max(0, Number(amount) || 0); index += 1) {
    const card = player.game.library.shift();
    if (!card) break;
    player.game.hand.push(card);
    drawn.push(card);
  }
  return drawn;
}

function loseLife(player, amount) {
  const value = Math.max(0, Number(amount) || 0);
  player.game.life = Math.max(0, Number(player.game.life) - value);
  return value;
}

function gainLife(player, amount) {
  const value = Math.max(0, Number(amount) || 0);
  player.game.life = Math.max(0, Number(player.game.life) + value);
  return value;
}

function createToken(room, player, definition, deps) {
  const amount = Math.max(1, Number(definition.amount) || 1);
  const created = [];

  for (let index = 0; index < amount; index += 1) {
    const card = deps.migrateCard(
      {
        id: deps.createId(),
        name: definition.name,
        ownerId: player.id,
        controllerId: player.id,
        token: true,
        commander: false,
        tapped: false,
        counters: {},
        damageMarked: 0,
        deathtouchMarked: false,
        attacking: false,
        defendingPlayerId: null,
        defendingPermanentId: null,
        blockingCardId: null,
        attachedToId: null,
        summoningSick: /\bCreature\b/i.test(definition.typeLine || ""),
        phasedOut: false,
        temporaryEffects: [],
        ruleEffects: [],
        manualKeywords: list(definition.keywords),
        specialState: {
          createdByDungeonV56: true,
          colorV56: definition.color || ""
        },
        power: definition.power || "",
        toughness: definition.toughness || "",
        cardData: {
          name: definition.name,
          typeLine: definition.typeLine,
          oracleText: definition.oracleText || "",
          power: definition.power || "",
          toughness: definition.toughness || "",
          keywords: list(definition.keywords),
          imageUrl: "",
          faces: []
        }
      },
      player.id
    );

    player.game.battlefield.unshift(card);
    created.push(card);
    deps.queueSuggestedTriggers(room, "PERMANENT_ENTERED", {
      card,
      controllerId: player.id,
      dungeonRoomV56: true
    });
  }

  return created;
}

function createTreasure(room, player, deps) {
  return createToken(
    room,
    player,
    {
      name: "Treasure",
      typeLine: "Token Artifact — Treasure",
      oracleText: "{T}, Sacrifice this artifact: Add one mana of any color."
    },
    deps
  );
}

function roomChoice(room, playerId, kind, payload, deps) {
  const choice = {
    id: deps.createId(),
    status: "open",
    kind,
    playerId,
    createdAt: deps.nowIso(),
    ...clone(payload)
  };

  normalizeState(room).choices.push(choice);
  return choice;
}

function creatureCandidates(room, controllerMode, playerId, deps) {
  return room.players.flatMap((player) =>
    (player.game?.battlefield || [])
      .filter((card) => {
        if (!deps.isCreatureCard(card)) return false;
        if (controllerMode === "you" && card.controllerId !== playerId) return false;
        if (controllerMode === "opponent" && card.controllerId === playerId) return false;
        return true;
      })
      .map((card) => ({
        targetKey: `card:${card.id}`,
        cardId: card.id,
        name: card.name,
        controllerId: card.controllerId,
        card: deps.publicCard(card)
      }))
  );
}

function playerCandidates(room) {
  return activePlayers(room).map((player) => ({
    targetKey: `player:${player.id}`,
    playerId: player.id,
    name: player.name,
    life: player.game.life
  }));
}

function basicLandCandidates(player) {
  return player.game.library
    .filter((card) => /\bBasic\b/i.test(card.cardData?.typeLine || ""))
    .map((card) => ({
      cardId: card.id,
      name: card.name,
      card: clone(card)
    }));
}

function shuffleLibrary(player) {
  for (let index = player.game.library.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [player.game.library[index], player.game.library[swap]] =
      [player.game.library[swap], player.game.library[index]];
  }
}

function applyTemporaryEffect(card, effect) {
  card.temporaryEffects = list(card.temporaryEffects);
  card.temporaryEffects.push(effect);
}

function applyRoomEffect(room, player, dungeonId, roomId, deps) {
  const dungeon = DUNGEONS[dungeonId];
  const currentRoom = dungeon?.rooms?.[roomId];
  if (!currentRoom) return { success: false, error: "Unknown dungeon room." };

  const effect = currentRoom.effect || {};
  const state = normalizeState(room);
  const context = {
    dungeonId,
    dungeonName: dungeon.name,
    roomId,
    roomName: currentRoom.name
  };

  if (effect.kind === "draw") {
    const cards = drawCards(player, effect.amount);
    deps.addLog(room, `${player.name} drew ${cards.length} card${cards.length === 1 ? "" : "s"} in ${currentRoom.name}.`, "dungeon");
  } else if (effect.kind === "gain-life") {
    gainLife(player, effect.amount);
  } else if (effect.kind === "each-player-loses") {
    for (const target of activePlayers(room)) loseLife(target, effect.amount);
  } else if (effect.kind === "dark-pool") {
    for (const target of activePlayers(room)) {
      if (target.id !== player.id) loseLife(target, 1);
    }
    gainLife(player, 1);
  } else if (effect.kind === "treasure") {
    createTreasure(room, player, deps);
  } else if (effect.kind === "token") {
    createToken(room, player, effect, deps);
  } else if (effect.kind === "scry") {
    const cards = player.game.library.slice(0, effect.amount).map((card) => ({
      cardId: card.id,
      name: card.name,
      card: deps.publicCard(card)
    }));

    if (cards.length) {
      roomChoice(
        room,
        player.id,
        "dungeon-scry",
        {
          ...context,
          amount: effect.amount,
          cards
        },
        deps
      );
    }
  } else if (effect.kind === "search-basic") {
    const candidates = basicLandCandidates(player);
    if (candidates.length) {
      roomChoice(
        room,
        player.id,
        "dungeon-search-basic",
        {
          ...context,
          candidates,
          optional: true
        },
        deps
      );
    } else {
      shuffleLibrary(player);
    }
  } else if (effect.kind === "target-creature") {
    const candidates = creatureCandidates(room, "any", player.id, deps);
    if (candidates.length) {
      roomChoice(
        room,
        player.id,
        "dungeon-target-creature",
        {
          ...context,
          action: effect.action,
          amount: effect.amount || 0,
          candidates
        },
        deps
      );
    }
  } else if (effect.kind === "target-player") {
    roomChoice(
      room,
      player.id,
      "dungeon-target-player",
      {
        ...context,
        action: effect.action,
        amount: effect.amount || 0,
        candidates: playerCandidates(room)
      },
      deps
    );
  } else if (effect.kind === "group-choice") {
    for (const target of activePlayers(room)) {
      roomChoice(
        room,
        target.id,
        "dungeon-group-choice",
        {
          ...context,
          choiceType: effect.choiceType,
          amount: effect.amount || 0,
          sourcePlayerId: player.id
        },
        deps
      );
    }
  } else if (effect.kind === "oubliette") {
    roomChoice(
      room,
      player.id,
      "dungeon-oubliette",
      {
        ...context
      },
      deps
    );
  } else if (effect.kind === "impulse") {
    const exiled = [];
    for (let index = 0; index < effect.amount; index += 1) {
      const card = player.game.library.shift();
      if (!card) break;
      card.specialState = card.specialState || {};
      card.specialState.dungeonImpulseV56 = {
        playerId: player.id,
        createdAt: deps.nowIso(),
        permission: "play"
      };
      player.game.exile.unshift(card);
      exiled.push(card.id);
    }

    state.impulsePermissions[player.id] = unique([
      ...list(state.impulsePermissions[player.id]),
      ...exiled
    ]);
  } else if (effect.kind === "mad-wizard") {
    const drawn = drawCards(player, 3);
    if (drawn.length) {
      roomChoice(
        room,
        player.id,
        "dungeon-free-cast",
        {
          ...context,
          candidates: drawn.map((card) => ({
            cardId: card.id,
            name: card.name,
            card: deps.publicCard(card)
          })),
          optional: true
        },
        deps
      );
    }
  } else if (effect.kind === "throne") {
    const revealed = player.game.library.splice(0, 10);
    const creatures = revealed.filter((card) => deps.isCreatureCard(card));

    roomChoice(
      room,
      player.id,
      "dungeon-throne",
      {
        ...context,
        revealedCardIds: revealed.map((card) => card.id),
        candidates: creatures.map((card) => ({
          cardId: card.id,
          name: card.name,
          card: deps.publicCard(card)
        })),
        optional: true
      },
      deps
    );

    player.game.library.unshift(...revealed);
  }

  deps.queueSuggestedTriggers(room, "DUNGEON_ROOM_ENTERED", {
    playerId: player.id,
    ...context
  });

  return { success: true };
}

function completeDungeon(room, player, dungeonId, deps) {
  const state = normalizeState(room);
  const track = state.dungeonsByPlayer[player.id];
  if (!track) return;

  state.completedByPlayer[player.id] =
    (Number(state.completedByPlayer[player.id]) || 0) + 1;
  state.history.push({
    id: deps.createId(),
    type: "dungeon-completed",
    playerId: player.id,
    dungeonId,
    dungeonName: DUNGEONS[dungeonId]?.name || dungeonId,
    createdAt: deps.nowIso()
  });
  delete state.dungeonsByPlayer[player.id];

  deps.queueSuggestedTriggers(room, "DUNGEON_COMPLETED", {
    playerId: player.id,
    dungeonId
  });
  deps.addLog(
    room,
    `${player.name} completed ${DUNGEONS[dungeonId]?.name || "a dungeon"}.`,
    "dungeon"
  );
}

function enterDungeonRoom(room, player, dungeonId, roomId, deps) {
  const dungeon = DUNGEONS[dungeonId];
  const roomDefinition = dungeon?.rooms?.[roomId];

  if (!dungeon || !roomDefinition) {
    return { success: false, error: "That dungeon room is unavailable." };
  }

  const state = normalizeState(room);
  state.dungeonsByPlayer[player.id] = {
    dungeonId,
    dungeonName: dungeon.name,
    roomId,
    roomName: roomDefinition.name,
    roomText: roomDefinition.text,
    history: [
      ...list(state.dungeonsByPlayer[player.id]?.history),
      roomId
    ],
    enteredAt: deps.nowIso()
  };

  deps.addLog(
    room,
    `${player.name} entered ${roomDefinition.name} in ${dungeon.name}.`,
    "dungeon"
  );

  const result = applyRoomEffect(room, player, dungeonId, roomId, deps);

  if (!roomDefinition.next.length) {
    const openRoomChoice = normalizeState(room).choices.some(
      (choice) =>
        choice.playerId === player.id &&
        choice.dungeonId === dungeonId &&
        choice.roomId === roomId
    );

    if (openRoomChoice) {
      state.dungeonsByPlayer[player.id].pendingCompletion = true;
    } else {
      completeDungeon(room, player, dungeonId, deps);
    }
  }

  return result;
}

function startDungeon(room, player, dungeonId, deps) {
  const dungeon = DUNGEONS[dungeonId];
  if (!dungeon) return { success: false, error: "Unknown dungeon." };

  return enterDungeonRoom(room, player, dungeonId, dungeon.entrance, deps);
}

function venture(room, player, mode, deps) {
  const state = normalizeState(room);
  const track = state.dungeonsByPlayer[player.id];

  if (!track) {
    if (mode === "undercity") {
      return startDungeon(room, player, "undercity", deps);
    }

    roomChoice(
      room,
      player.id,
      "dungeon-start",
      {
        mode: "normal",
        candidates: Object.values(DUNGEONS)
          .filter((dungeon) => !dungeon.undercityOnly)
          .map((dungeon) => ({
            dungeonId: dungeon.id,
            name: dungeon.name
          }))
      },
      deps
    );
    return { success: true, waiting: true };
  }

  const dungeon = DUNGEONS[track.dungeonId];
  const currentRoom = dungeon?.rooms?.[track.roomId];
  if (!currentRoom) {
    delete state.dungeonsByPlayer[player.id];
    return venture(room, player, mode, deps);
  }

  if (!currentRoom.next.length) {
    completeDungeon(room, player, track.dungeonId, deps);
    return mode === "undercity"
      ? startDungeon(room, player, "undercity", deps)
      : venture(room, player, "normal", deps);
  }

  if (currentRoom.next.length === 1) {
    return enterDungeonRoom(
      room,
      player,
      track.dungeonId,
      currentRoom.next[0],
      deps
    );
  }

  roomChoice(
    room,
    player.id,
    "dungeon-path",
    {
      dungeonId: track.dungeonId,
      dungeonName: dungeon.name,
      roomId: track.roomId,
      candidates: currentRoom.next.map((roomId) => ({
        roomId,
        name: dungeon.rooms[roomId].name,
        text: dungeon.rooms[roomId].text
      }))
    },
    deps
  );

  return { success: true, waiting: true };
}

function queueSpecialStack(room, playerId, kind, deps) {
  const state = normalizeState(room);
  const key = `${kind}:${room.turn?.number || 0}:${room.turn?.phaseIndex || 0}:${playerId}`;

  if (state.phaseTriggers[key]) return null;
  state.phaseTriggers[key] = true;

  const names = {
    "monarch-draw": "The Monarch — End Step Draw",
    "initiative-venture": "The Initiative — Venture into Undercity"
  };

  const item = deps.pushStack(
    room,
    {
      kind: "trigger",
      name: names[kind] || "Multiplayer designation trigger",
      controllerId: playerId,
      sourceCardId: null,
      text: "",
      targets: [],
      createdAt: deps.nowIso(),
      v56Special: { kind, playerId }
    },
    playerId
  );

  if (item) {
    state.specialStack[item.id] = clone(item.v56Special);
    deps.resetPriority(room, playerId);
  }
  return item;
}

function setMonarch(room, playerId, reason, deps) {
  const player = findPlayer(room, playerId, deps);
  if (!player?.game || player.game.lost || player.game.conceded) {
    return { success: false, error: "That player cannot become the monarch." };
  }

  const state = normalizeState(room);
  const previous = state.monarchPlayerId;
  state.monarchPlayerId = player.id;

  state.history.push({
    id: deps.createId(),
    type: "monarch",
    playerId: player.id,
    previousPlayerId: previous,
    reason: reason || "effect",
    createdAt: deps.nowIso()
  });

  deps.queueSuggestedTriggers(room, "BECAME_MONARCH", {
    playerId: player.id,
    previousPlayerId: previous
  });
  deps.addLog(room, `${player.name} became the monarch.`, "monarch");
  return { success: true };
}

function setInitiative(room, playerId, reason, deps) {
  const player = findPlayer(room, playerId, deps);
  if (!player?.game || player.game.lost || player.game.conceded) {
    return { success: false, error: "That player cannot take the initiative." };
  }

  const state = normalizeState(room);
  const previous = state.initiativePlayerId;
  state.initiativePlayerId = player.id;

  state.history.push({
    id: deps.createId(),
    type: "initiative",
    playerId: player.id,
    previousPlayerId: previous,
    reason: reason || "effect",
    createdAt: deps.nowIso()
  });

  queueSpecialStack(room, player.id, "initiative-venture", deps);
  deps.queueSuggestedTriggers(room, "TOOK_INITIATIVE", {
    playerId: player.id,
    previousPlayerId: previous
  });
  deps.addLog(room, `${player.name} took the initiative.`, "initiative");
  return { success: true };
}

function actualDamage(before, target) {
  return Math.max(0, Number(before.life) - Number(target.game.life));
}

function wrapPlayerDamage(room, source, target, amount, legacy, deps) {
  const state = normalizeState(room);
  const before = { life: Number(target?.game?.life) || 0 };
  const wasMonarch = state.monarchPlayerId === target?.id;
  const hadInitiative = state.initiativePlayerId === target?.id;

  const result = legacy(room, source, target, amount);
  const dealt = actualDamage(before, target);

  if (
    dealt > 0 &&
    source &&
    source.attacking &&
    deps.isCreatureCard(source)
  ) {
    const controllerId = source.controllerId;

    if (wasMonarch && controllerId && controllerId !== target.id) {
      setMonarch(room, controllerId, "combat damage", deps);
    }
    if (hadInitiative && controllerId && controllerId !== target.id) {
      setInitiative(room, controllerId, "combat damage", deps);
    }
  }

  return result;
}

function phaseKey(room, kind) {
  return `${kind}:${room.turn?.number || 0}:${room.turn?.phaseIndex || 0}`;
}

function processPhaseTriggers(room, deps) {
  const state = normalizeState(room);
  const phase = deps.PHASES[room.turn?.phaseIndex || 0] || "";
  const activePlayerId = room.turn?.activePlayerId;

  if (phase === "Upkeep" && state.initiativePlayerId === activePlayerId) {
    queueSpecialStack(room, activePlayerId, "initiative-venture", deps);
  }

  if (phase === "End" && state.monarchPlayerId === activePlayerId) {
    queueSpecialStack(room, activePlayerId, "monarch-draw", deps);
  }

  const cleanupKey = phaseKey(room, "cleanup");
  if (phase === "Cleanup" && !state.phaseTriggers[cleanupKey]) {
    state.phaseTriggers[cleanupKey] = true;

    for (const player of room.players) {
      for (const card of player.game?.battlefield || []) {
        card.temporaryEffects = list(card.temporaryEffects).filter(
          (effect) => effect.expires !== "until-next-turn-v56" ||
            Number(effect.untilTurn) > Number(room.turn?.number || 0)
        );
        if (
          card.specialState?.goadV56 &&
          Number(card.specialState.goadV56.untilTurn) <=
            Number(room.turn?.number || 0)
        ) {
          delete card.specialState.goadV56;
        }
      }
    }
  }
}

function resolveSpecialStack(room, item, deps) {
  const meta =
    item?.v56Special ||
    normalizeState(room).specialStack[item?.id];

  if (!meta) return false;

  const player = findPlayer(room, meta.playerId, deps);
  if (!player?.game) return true;

  if (meta.kind === "monarch-draw") {
    const drawn = drawCards(player, 1);
    deps.addLog(
      room,
      `${player.name} drew ${drawn.length} card as the monarch.`,
      "monarch"
    );
  } else if (meta.kind === "initiative-venture") {
    venture(room, player, "undercity", deps);
  }

  delete normalizeState(room).specialStack[item.id];
  return true;
}

function detectDesignationText(room, item, newCards, deps) {
  const controllerId = item?.controllerId;
  const text = [
    item?.text || "",
    ...newCards.map((card) => oracle(card, deps))
  ].join("\n");

  if (controllerId && /\byou become the monarch\b/i.test(text)) {
    setMonarch(room, controllerId, "spell or ability", deps);
  }

  if (controllerId && /\byou take the initiative\b/i.test(text)) {
    setInitiative(room, controllerId, "spell or ability", deps);
  }

  if (controllerId && /\bventure into the dungeon\b/i.test(text)) {
    const player = findPlayer(room, controllerId, deps);
    if (player) venture(room, player, "normal", deps);
  }

  if (
    controllerId &&
    /\bventure into Undercity\b/i.test(text) &&
    !/\byou take the initiative\b/i.test(text)
  ) {
    const player = findPlayer(room, controllerId, deps);
    if (player) venture(room, player, "undercity", deps);
  }
}

function additionalVotes(player, deps) {
  let extra = 0;

  for (const card of player.game?.battlefield || []) {
    const text = oracle(card, deps);

    for (const match of text.matchAll(
      /\byou (?:get|have|may cast) (an|one|two|three|\d+) additional votes?\b/gi
    )) {
      const words = { an: 1, one: 1, two: 2, three: 3 };
      extra += words[String(match[1]).toLowerCase()] ?? Number(match[1]) ?? 0;
    }

    if (/\byou may vote an additional time\b/i.test(text)) extra += 1;
  }

  return Math.max(0, extra);
}

function parseVoteInstruction(text) {
  const source = String(text || "");
  const secret = /\bsecret council\b/i.test(source);
  const dilemma = /\bcouncil'?s dilemma\b/i.test(source);
  const will = /\bwill of the council\b/i.test(source);

  if (!secret && !dilemma && !will && !/\beach player (?:secretly )?votes?\b/i.test(source)) {
    return null;
  }

  const match = source.match(
    /\bvotes? for ([^.,;\n]+?) or ([^.,;\n]+?)(?:[.,;\n]|$)/i
  );

  const options = match
    ? [match[1].trim(), match[2].trim()]
    : ["Option A", "Option B"];

  return {
    mode: secret ? "secret" : dilemma ? "dilemma" : "will",
    secret,
    options: unique(options),
    title:
      secret ? "Secret council" :
      dilemma ? "Council's dilemma" :
      "Will of the council"
  };
}

function voteOrder(room, controllerId) {
  return turnOrderFrom(room, controllerId);
}

function createVoteSession(room, controllerId, instruction, source, deps) {
  const state = normalizeState(room);
  const existing = Object.values(state.votes).find(
    (vote) =>
      vote.status === "open" &&
      vote.sourceStackItemId &&
      vote.sourceStackItemId === source?.id
  );
  if (existing) return existing;

  const order = voteOrder(room, controllerId);
  const slots = {};

  for (const playerId of order) {
    const player = room.players.find((entry) => entry.id === playerId);
    slots[playerId] = 1 + additionalVotes(player, deps);
  }

  const vote = {
    id: deps.createId(),
    status: "open",
    title: instruction.title || "Table vote",
    mode: instruction.mode || "will",
    secret: Boolean(instruction.secret),
    options: unique(instruction.options).slice(0, 8),
    controllerId,
    order,
    currentOrderIndex: 0,
    slots,
    ballots: {},
    sourceStackItemId: source?.id || null,
    sourceName: source?.name || instruction.title || "Vote",
    createdAt: deps.nowIso(),
    completedAt: null,
    result: null
  };

  state.votes[vote.id] = vote;
  return vote;
}

function playerBallots(vote, playerId) {
  return list(vote.ballots[playerId]);
}

function currentPublicVoter(vote) {
  if (vote.secret) return null;

  while (vote.currentOrderIndex < vote.order.length) {
    const playerId = vote.order[vote.currentOrderIndex];
    if (playerBallots(vote, playerId).length < Number(vote.slots[playerId] || 1)) {
      return playerId;
    }
    vote.currentOrderIndex += 1;
  }

  return null;
}

function tallyVote(vote) {
  const counts = Object.fromEntries(vote.options.map((option) => [option, 0]));

  for (const ballots of Object.values(vote.ballots)) {
    for (const option of ballots) {
      if (Object.prototype.hasOwnProperty.call(counts, option)) {
        counts[option] += 1;
      }
    }
  }

  const maximum = Math.max(0, ...Object.values(counts));
  const winners = Object.entries(counts)
    .filter(([, count]) => count === maximum)
    .map(([option]) => option);

  return {
    counts,
    winners,
    tied: winners.length > 1,
    totalVotes: Object.values(counts).reduce((sum, count) => sum + count, 0)
  };
}

function voteComplete(vote) {
  return vote.order.every(
    (playerId) =>
      playerBallots(vote, playerId).length >=
      Number(vote.slots[playerId] || 1)
  );
}

function castVote(room, actor, action, deps) {
  const state = normalizeState(room);
  const vote = state.votes[String(action?.voteId || "")];

  if (!vote || vote.status !== "open") {
    return { success: false, error: "That vote is unavailable." };
  }

  if (!vote.options.includes(String(action?.option || ""))) {
    return { success: false, error: "Choose one of the available vote options." };
  }

  if (!vote.order.includes(actor.id)) {
    return { success: false, error: "You are not participating in this vote." };
  }

  if (!vote.secret) {
    const expected = currentPublicVoter(vote);
    if (expected !== actor.id) {
      const player = findPlayer(room, expected, deps);
      return {
        success: false,
        error: `${player?.name || "Another player"} votes next.`
      };
    }
  }

  const ballots = playerBallots(vote, actor.id);
  const allowed = Number(vote.slots[actor.id] || 1);

  if (ballots.length >= allowed) {
    return { success: false, error: "You have already used all your votes." };
  }

  ballots.push(String(action.option));
  vote.ballots[actor.id] = ballots;

  if (!vote.secret) vote.currentOrderIndex += ballots.length >= allowed ? 1 : 0;

  if (voteComplete(vote)) {
    vote.status = "complete";
    vote.completedAt = deps.nowIso();
    vote.result = tallyVote(vote);

    const item = room.stack?.find(
      (entry) => entry.id === vote.sourceStackItemId
    );
    if (item) {
      item.v56VoteComplete = true;
      item.v56VoteResult = clone(vote.result);
    }

    deps.queueSuggestedTriggers(room, "TABLE_VOTE_COMPLETED", {
      voteId: vote.id,
      mode: vote.mode,
      result: clone(vote.result)
    });
    deps.addLog(
      room,
      `${vote.title} finished: ${Object.entries(vote.result.counts)
        .map(([option, count]) => `${option} ${count}`)
        .join(", ")}.`,
      "vote"
    );
    deps.resetPriority(room, vote.controllerId);
  }

  return {
    success: true,
    complete: vote.status === "complete",
    remainingVotes:
      allowed - playerBallots(vote, actor.id).length
  };
}

function resolveVoteGate(room, item, deps) {
  if (!item || item.v56VoteComplete) return { blocked: false };

  const instruction = parseVoteInstruction(item.text || "");
  if (!instruction) return { blocked: false };

  const vote = createVoteSession(
    room,
    item.controllerId,
    instruction,
    item,
    deps
  );

  if (vote.status === "complete") {
    item.v56VoteComplete = true;
    item.v56VoteResult = clone(vote.result);
    return { blocked: false };
  }

  return { blocked: true, voteId: vote.id };
}

function maybeCompleteDungeonAfterChoice(room, choice, deps) {
  if (!choice?.dungeonId || !choice?.roomId) return;

  const track = normalizeState(room).dungeonsByPlayer[choice.playerId];
  if (
    track?.pendingCompletion &&
    track.dungeonId === choice.dungeonId &&
    track.roomId === choice.roomId
  ) {
    const another = normalizeState(room).choices.some(
      (entry) =>
        entry.status === "open" &&
        entry.playerId === choice.playerId &&
        entry.dungeonId === choice.dungeonId &&
        entry.roomId === choice.roomId
    );

    if (!another) {
      completeDungeon(room, findPlayer(room, choice.playerId, deps), choice.dungeonId, deps);
    }
  }
}

function moveCardToGraveyard(room, cardId, deps) {
  const located = deps.findBattlefieldCard(room, cardId);
  if (!located) return false;

  const [card] = located.player.game.battlefield.splice(located.index, 1);
  if (!card.token) {
    const owner = findPlayer(room, card.ownerId, deps) || located.player;
    owner.game.graveyard.unshift(card);
  }
  return true;
}

function resolveDungeonChoice(room, actor, action, legacy, deps) {
  const state = normalizeState(room);
  const choice = state.choices.find(
    (entry) => entry.id === action?.choiceId && entry.status === "open"
  );

  if (!choice) return { success: false, error: "That dungeon choice is unavailable." };
  if (choice.playerId !== actor.id && room.hostId !== actor.id) {
    return { success: false, error: "That dungeon choice belongs to another player." };
  }

  const player = findPlayer(room, choice.playerId, deps);
  if (!player?.game) return { success: false, error: "The dungeon player is unavailable." };

  if (choice.kind === "dungeon-start") {
    const dungeonId = String(action?.dungeonId || "");
    if (!choice.candidates.some((entry) => entry.dungeonId === dungeonId)) {
      return { success: false, error: "Choose an available dungeon." };
    }
    enterDungeonRoom(room, player, dungeonId, DUNGEONS[dungeonId].entrance, deps);
  } else if (choice.kind === "dungeon-path") {
    const roomId = String(action?.roomId || "");
    if (!choice.candidates.some((entry) => entry.roomId === roomId)) {
      return { success: false, error: "Choose a connected dungeon room." };
    }
    enterDungeonRoom(room, player, choice.dungeonId, roomId, deps);
  } else if (choice.kind === "dungeon-scry") {
    const topCards = choice.cards.map((entry) => entry.cardId);
    const bottomIds = unique(action?.bottomCardIds).filter((id) => topCards.includes(id));
    const topOrder = unique(action?.topOrder).filter(
      (id) => topCards.includes(id) && !bottomIds.includes(id)
    );

    const missingTop = topCards.filter(
      (id) => !bottomIds.includes(id) && !topOrder.includes(id)
    );
    const finalTopOrder = [...topOrder, ...missingTop];
    const extracted = new Map();

    player.game.library = player.game.library.filter((card) => {
      if (topCards.includes(card.id)) {
        extracted.set(card.id, card);
        return false;
      }
      return true;
    });

    player.game.library.unshift(
      ...finalTopOrder.map((id) => extracted.get(id)).filter(Boolean)
    );
    player.game.library.push(
      ...bottomIds.map((id) => extracted.get(id)).filter(Boolean)
    );
  } else if (choice.kind === "dungeon-search-basic") {
    const cardId = String(action?.cardId || "");
    if (cardId) {
      const index = player.game.library.findIndex(
        (card) =>
          card.id === cardId &&
          /\bBasic\b/i.test(card.cardData?.typeLine || "")
      );
      if (index < 0) return { success: false, error: "That basic land is unavailable." };
      const [card] = player.game.library.splice(index, 1);
      player.game.hand.push(card);
    }
    shuffleLibrary(player);
  } else if (choice.kind === "dungeon-target-creature") {
    const cardId = String(action?.targetKey || "").replace(/^card:/, "");
    const candidate = choice.candidates.find((entry) => entry.cardId === cardId);
    const located = deps.findBattlefieldCard(room, cardId);
    if (!candidate || !located) {
      return { success: false, error: "Choose a legal creature." };
    }

    if (choice.action === "counter") {
      located.card.counters = located.card.counters || {};
      located.card.counters["+1/+1"] =
        (Number(located.card.counters["+1/+1"]) || 0) + Number(choice.amount || 1);
    } else if (choice.action === "power-penalty") {
      applyTemporaryEffect(located.card, {
        id: deps.createId(),
        source: "dungeon-v56",
        power: -Math.max(0, Number(choice.amount) || 0),
        toughness: 0,
        expires: "until-next-turn-v56",
        untilTurn: Number(room.turn?.number || 0) + 1
      });
    } else if (choice.action === "cant-attack") {
      located.card.specialState = located.card.specialState || {};
      located.card.specialState.cantAttackV56 = {
        untilTurn: Number(room.turn?.number || 0) + 1
      };
    } else if (choice.action === "goad") {
      located.card.specialState = located.card.specialState || {};
      located.card.specialState.goadV56 = {
        byPlayerId: player.id,
        untilTurn: Number(room.turn?.number || 0) + 1
      };
    }
  } else if (choice.kind === "dungeon-target-player") {
    const playerId = String(action?.targetKey || "").replace(/^player:/, "");
    const target = findPlayer(room, playerId, deps);
    if (!target || !choice.candidates.some((entry) => entry.playerId === playerId)) {
      return { success: false, error: "Choose a legal player." };
    }
    if (choice.action === "lose-life") loseLife(target, choice.amount);
  } else if (choice.kind === "dungeon-group-choice") {
    const selected = String(action?.option || "");
    if (choice.choiceType === "discard-or-life") {
      if (selected === "discard") {
        const cardId = String(action?.cardId || "");
        const index = player.game.hand.findIndex((card) => card.id === cardId);
        if (index < 0) return { success: false, error: "Choose a card to discard." };
        const [card] = player.game.hand.splice(index, 1);
        player.game.graveyard.unshift(card);
      } else if (selected === "life") {
        loseLife(player, choice.amount);
      } else {
        return { success: false, error: "Choose discard or lose life." };
      }
    } else if (choice.choiceType === "sacrifice-or-life") {
      if (selected === "sacrifice") {
        const cardId = String(action?.cardId || "");
        const located = deps.findBattlefieldCard(room, cardId);
        if (
          !located ||
          located.card.controllerId !== player.id ||
          !/\b(?:Artifact|Creature|Land)\b/i.test(typeLine(located.card, deps))
        ) {
          return { success: false, error: "Choose an artifact, creature, or land to sacrifice." };
        }
        moveCardToGraveyard(room, cardId, deps);
      } else if (selected === "life") {
        loseLife(player, choice.amount);
      } else {
        return { success: false, error: "Choose sacrifice or lose life." };
      }
    }
  } else if (choice.kind === "dungeon-oubliette") {
    const discardId = String(action?.discardCardId || "");
    const handIndex = player.game.hand.findIndex((card) => card.id === discardId);
    if (handIndex < 0) return { success: false, error: "Choose a card to discard." };

    const required = [
      ["artifactCardId", /\bArtifact\b/i],
      ["creatureCardId", /\bCreature\b/i],
      ["landCardId", /\bLand\b/i]
    ];
    const sacrificeIds = [];

    for (const [field, pattern] of required) {
      const cardId = String(action?.[field] || "");
      const located = deps.findBattlefieldCard(room, cardId);
      if (
        !located ||
        located.card.controllerId !== player.id ||
        !pattern.test(typeLine(located.card, deps))
      ) {
        return { success: false, error: "Choose the required artifact, creature, and land." };
      }
      sacrificeIds.push(cardId);
    }

    if (unique(sacrificeIds).length !== sacrificeIds.length) {
      return { success: false, error: "Each sacrifice must be a different permanent." };
    }

    const [discarded] = player.game.hand.splice(handIndex, 1);
    player.game.graveyard.unshift(discarded);
    for (const cardId of sacrificeIds) moveCardToGraveyard(room, cardId, deps);
  } else if (choice.kind === "dungeon-free-cast") {
    const cardId = String(action?.cardId || "");
    if (cardId) {
      const candidate = choice.candidates.find((entry) => entry.cardId === cardId);
      if (!candidate) return { success: false, error: "Choose one of the drawn cards." };

      const castResult = legacy(room, player, {
        type: "auto-cast-card",
        fromZone: "hand",
        cardId,
        freeCast: true,
        withoutPayingManaCost: true,
        v56DungeonFreeCast: true
      });
      if (!castResult?.success) return castResult;
    }
  } else if (choice.kind === "dungeon-throne") {
    const revealedIds = unique(choice.revealedCardIds);
    const selectedId = String(action?.cardId || "");
    const extracted = [];

    player.game.library = player.game.library.filter((card) => {
      if (revealedIds.includes(card.id)) {
        extracted.push(card);
        return false;
      }
      return true;
    });

    if (selectedId) {
      const selected = extracted.find(
        (card) => card.id === selectedId && deps.isCreatureCard(card)
      );
      if (!selected) {
        player.game.library.unshift(...extracted);
        return { success: false, error: "Choose a revealed creature card." };
      }

      selected.controllerId = player.id;
      selected.counters = selected.counters || {};
      selected.counters["+1/+1"] =
        (Number(selected.counters["+1/+1"]) || 0) + 3;
      selected.summoningSick = true;
      selected.temporaryEffects = list(selected.temporaryEffects);
      selected.temporaryEffects.push({
        id: deps.createId(),
        keyword: "hexproof",
        expires: "until-next-turn-v56",
        untilTurn: Number(room.turn?.number || 0) + 1
      });
      player.game.battlefield.unshift(selected);

      const remaining = extracted.filter((card) => card.id !== selectedId);
      player.game.library.push(...remaining);
      shuffleLibrary(player);
    } else {
      player.game.library.push(...extracted);
      shuffleLibrary(player);
    }
  } else {
    return { success: false, error: "Unsupported dungeon choice." };
  }

  choice.status = "resolved";
  state.choices = state.choices.filter((entry) => entry.status === "open");
  maybeCompleteDungeonAfterChoice(room, choice, deps);
  deps.runStateBasedActions(room, "dungeon-choice-v56");
  return { success: true };
}

function legalAttackRestriction(room, actor, action, deps) {
  if (!["declare-attacker", "combat-v52-declare-attack"].includes(action?.type)) {
    return { success: true };
  }

  const card = deps.findBattlefieldCard(room, String(action?.cardId || ""))?.card;
  if (!card) return { success: true };

  const currentTurn = Number(room.turn?.number || 0);
  if (
    card.specialState?.cantAttackV56 &&
    Number(card.specialState.cantAttackV56.untilTurn) >= currentTurn
  ) {
    return { success: false, error: `${card.name} can't attack until its controller's next turn.` };
  }

  return { success: true };
}

function beforeResolve(room, item, deps) {
  const gate = resolveVoteGate(room, item, deps);
  if (gate.blocked) return gate;
  return { blocked: false };
}

function afterResolve(room, item, beforeBattlefieldIds, result, deps) {
  if (!result) return result;

  resolveSpecialStack(room, item, deps);

  const before = new Set(beforeBattlefieldIds || []);
  const newCards = room.players.flatMap((player) =>
    (player.game?.battlefield || []).filter((card) => !before.has(card.id))
  );

  detectDesignationText(room, item, newCards, deps);
  processPhaseTriggers(room, deps);
  handleDepartedHolders(room, deps);
  deps.runStateBasedActions(room, "multiplayer-v56");
  return result;
}

function processGameAction(room, actor, action, legacy, deps) {
  const state = normalizeState(room);
  const type = String(action?.type || "");

  if (type === "multiplayer-v56-resolve-choice") {
    return resolveDungeonChoice(room, actor, action, legacy, deps);
  }
  if (type === "multiplayer-v56-vote") {
    return castVote(room, actor, action, deps);
  }
  if (type === "multiplayer-v56-monarch") {
    return setMonarch(room, action?.playerId || actor.id, "manual action", deps);
  }
  if (type === "multiplayer-v56-initiative") {
    return setInitiative(room, action?.playerId || actor.id, "manual action", deps);
  }
  if (type === "multiplayer-v56-venture") {
    return venture(room, actor, action?.mode === "undercity" ? "undercity" : "normal", deps);
  }
  if (type === "multiplayer-v56-start-vote") {
    const options = unique(action?.options).filter(Boolean);
    if (options.length < 2) {
      return { success: false, error: "A vote needs at least two options." };
    }

    const vote = createVoteSession(
      room,
      actor.id,
      {
        title: String(action?.title || "Table vote").slice(0, 160),
        mode: ["will", "dilemma", "secret"].includes(action?.mode)
          ? action.mode
          : "will",
        secret: action?.mode === "secret",
        options
      },
      null,
      deps
    );
    return { success: true, voteId: vote.id };
  }

  if (
    state.choices.length &&
    !["judge-action", "undo-last", "check-state-based"].includes(type)
  ) {
    const waiting = findPlayer(room, state.choices[0].playerId, deps);
    return {
      success: false,
      error: `${waiting?.name || "A player"} must finish a multiplayer choice.`
    };
  }

  const attack = legalAttackRestriction(room, actor, action, deps);
  if (!attack.success) return attack;

  const beforeBattlefieldIds = room.players.flatMap((player) =>
    (player.game?.battlefield || []).map((card) => card.id)
  );

  const result = legacy(room, actor, action);
  if (!result?.success) return result;

  processPhaseTriggers(room, deps);
  handleDepartedHolders(room, deps);

  if (type === "next-phase" || type === "end-turn" || type === "set-active-player") {
    processPhaseTriggers(room, deps);
  }

  const newCards = room.players.flatMap((player) =>
    (player.game?.battlefield || []).filter(
      (card) => !beforeBattlefieldIds.includes(card.id)
    )
  );
  detectDesignationText(room, null, newCards, deps);

  return result;
}

function publicVote(vote, viewerId, deps, room) {
  const complete = vote.status === "complete";
  const viewerBallots = playerBallots(vote, viewerId);
  const allowed = Number(vote.slots[viewerId] || 0);
  const currentVoterId = currentPublicVoter(vote);

  const visibleBallots = {};
  if (complete || !vote.secret) {
    for (const [playerId, ballots] of Object.entries(vote.ballots)) {
      visibleBallots[playerId] = [...ballots];
    }
  }

  return {
    id: vote.id,
    status: vote.status,
    title: vote.title,
    mode: vote.mode,
    secret: vote.secret,
    options: [...vote.options],
    controllerId: vote.controllerId,
    order: [...vote.order],
    currentVoterId,
    currentVoterName: findPlayer(room, currentVoterId, deps)?.name || null,
    slots: clone(vote.slots),
    viewerVotesUsed: viewerBallots.length,
    viewerVotesAllowed: allowed,
    canViewerVote:
      vote.status === "open" &&
      viewerBallots.length < allowed &&
      (vote.secret || currentVoterId === viewerId),
    ballots: visibleBallots,
    result: complete ? clone(vote.result) : null,
    sourceName: vote.sourceName
  };
}

function stateForViewer(room, viewerId, deps) {
  const state = normalizeState(room);

  return {
    success: true,
    version: "56.0.0",
    phase: deps.PHASES[room.turn?.phaseIndex || 0] || "",
    activePlayerId: room.turn?.activePlayerId || null,
    monarchPlayerId: state.monarchPlayerId,
    monarchName: findPlayer(room, state.monarchPlayerId, deps)?.name || null,
    initiativePlayerId: state.initiativePlayerId,
    initiativeName: findPlayer(room, state.initiativePlayerId, deps)?.name || null,
    dungeons: room.players.map((player) => ({
      playerId: player.id,
      playerName: player.name,
      track: clone(state.dungeonsByPlayer[player.id] || null),
      completed: Number(state.completedByPlayer[player.id]) || 0
    })),
    dungeonDefinitions: Object.values(DUNGEONS).map((dungeon) => ({
      id: dungeon.id,
      name: dungeon.name,
      undercityOnly: dungeon.undercityOnly,
      rooms: Object.entries(dungeon.rooms).map(([roomId, roomDefinition]) => ({
        roomId,
        name: roomDefinition.name,
        text: roomDefinition.text,
        next: [...roomDefinition.next]
      }))
    })),
    votes: Object.values(state.votes)
      .filter(
        (vote) =>
          vote.status === "open" ||
          Date.now() - Date.parse(vote.completedAt || vote.createdAt) < 10 * 60 * 1000
      )
      .map((vote) => publicVote(vote, viewerId, deps, room)),
    history: state.history.slice(-30),
    impulsePermissions: clone(state.impulsePermissions[viewerId] || [])
  };
}

function pendingForViewer(room, viewerId, deps) {
  const state = normalizeState(room);
  const choice = state.choices.find(
    (entry) =>
      entry.status === "open" &&
      (entry.playerId === viewerId || room.hostId === viewerId)
  );

  const vote = Object.values(state.votes).find((entry) => {
    const publicData = publicVote(entry, viewerId, deps, room);
    return publicData.canViewerVote;
  });

  return {
    success: true,
    version: "56.0.0",
    choice: choice ? clone(choice) : null,
    vote: vote ? publicVote(vote, viewerId, deps, room) : null
  };
}

function summary(room, deps) {
  const state = normalizeState(room);
  return {
    version: "56.0.0",
    monarchPlayerId: state.monarchPlayerId,
    initiativePlayerId: state.initiativePlayerId,
    activeDungeons: Object.keys(state.dungeonsByPlayer).length,
    completedDungeons: Object.values(state.completedByPlayer)
      .reduce((sum, value) => sum + Number(value || 0), 0),
    openChoices: state.choices.length,
    openVotes: Object.values(state.votes).filter((vote) => vote.status === "open").length
  };
}

function createMultiplayerRulesEngine(deps) {
  return {
    version: "56.0.0",

    processGameAction(room, actor, action, legacy) {
      return processGameAction(room, actor, action, legacy, deps);
    },

    beforeResolve(room, item) {
      return beforeResolve(room, item, deps);
    },

    beforeBattlefield(room) {
      return room.players.flatMap((player) =>
        (player.game?.battlefield || []).map((card) => card.id)
      );
    },

    afterResolve(room, item, beforeBattlefieldIds, result) {
      return afterResolve(room, item, beforeBattlefieldIds, result, deps);
    },

    playerDamage(room, source, target, amount, legacy) {
      return wrapPlayerDamage(room, source, target, amount, legacy, deps);
    },

    state(room, viewerId) {
      return stateForViewer(room, viewerId, deps);
    },

    pending(room, viewerId) {
      return pendingForViewer(room, viewerId, deps);
    },

    summary(room) {
      return summary(room, deps);
    },

    status() {
      return {
        success: true,
        version: "56.0.0",
        automatic: [
          "single monarch designation",
          "monarch end-step draw trigger",
          "monarch transfer after creature combat damage",
          "monarch succession when the holder leaves the game",
          "single initiative designation",
          "venture into Undercity whenever a player takes the initiative",
          "initiative upkeep venture trigger",
          "initiative transfer after creature combat damage",
          "initiative succession when the holder leaves the game",
          "Lost Mine of Phandelver",
          "Dungeon of the Mad Mage",
          "Tomb of Annihilation",
          "Undercity",
          "dungeon start and branching-room choices",
          "dungeon completion tracking",
          "draw, life, token, Treasure, counter, goad and temporary room effects",
          "scry and basic-land-search room choices",
          "Tomb discard, sacrifice and life-loss choices",
          "Undercity top-ten creature choice",
          "public Will of the council voting in turn order",
          "Council's dilemma vote counts",
          "secret council hidden ballots",
          "additional-vote effects",
          "vote results attached to the resolving stack item"
        ],
        assisted: [
          "card-specific effects that consume Will of the council results",
          "card-specific Council's dilemma outcome text",
          "effects that change or replace votes",
          "Brago's Representative and Ballot Broker wording variants beyond additional votes",
          "Mad Wizard's Lair free-cast corner cases",
          "Runestone Caverns play permissions that require unusual timing or alternative costs",
          "simultaneous combat damage from creatures controlled by different players",
          "effects that remove gameplay designations",
          "future dungeon cards and card-specific dungeon room replacement effects"
        ]
      };
    }
  };
}

module.exports = {
  DUNGEONS,
  createMultiplayerRulesEngine,
  _test: {
    normalizeState,
    turnOrderFrom,
    setMonarch,
    setInitiative,
    venture,
    enterDungeonRoom,
    completeDungeon,
    applyRoomEffect,
    parseVoteInstruction,
    createVoteSession,
    castVote,
    tallyVote,
    voteComplete,
    additionalVotes,
    processPhaseTriggers,
    resolveSpecialStack,
    wrapPlayerDamage,
    resolveDungeonChoice,
    handleDepartedHolders
  }
};
