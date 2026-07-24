"use strict";

function list(value) {
  return Array.isArray(value) ? value : [];
}

function unique(value) {
  return [...new Set(list(value).map(String).filter(Boolean))];
}

function normalizeState(room) {
  room.playPermissions = list(room.playPermissions)
    .filter((permission) => permission && permission.id && permission.playerId && permission.cardId)
    .slice(-150);

  room.permissionsV47 = room.permissionsV47 && typeof room.permissionsV47 === "object"
    ? room.permissionsV47
    : {};
  room.permissionsV47.linkedExile = list(room.permissionsV47.linkedExile)
    .filter((link) => link && link.id && link.sourceCardId && link.exiledCardId)
    .slice(-100);
  room.permissionsV47.copyLog = list(room.permissionsV47.copyLog).slice(-100);
  return room.permissionsV47;
}

function cardName(card) {
  return String(card?.cardData?.name || card?.name || "").trim();
}

function manaValue(card, deps) {
  const face = deps.currentCardFace(card) || {};
  const direct = face.manaValue ?? face.cmc ?? card?.cardData?.manaValue ?? card?.cardData?.cmc;
  return Number.isFinite(Number(direct)) ? Number(direct) : 0;
}

function findCardInZone(player, zone, cardId) {
  if (!player?.game) return null;
  if (zone === "library-top") {
    const card = player.game.library[0];
    return card?.id === cardId ? { card, index: 0, zone: "library" } : null;
  }
  const actual = zone === "library" ? "library" : zone;
  const cards = player.game[actual];
  if (!Array.isArray(cards)) return null;
  const index = cards.findIndex((card) => card.id === cardId);
  return index < 0 ? null : { card: cards[index], index, zone: actual };
}

function findOwnedCard(room, playerId, cardId, deps) {
  const player = deps.findPlayer(room, playerId);
  if (!player?.game) return null;
  for (const zone of ["hand", "battlefield", "graveyard", "exile", "commandZone", "library"]) {
    const found = findCardInZone(player, zone, cardId);
    if (found) return { player, ...found };
  }
  return null;
}

function expires(permission, room, deps) {
  const turnNumber = Number(room.turn?.number) || 0;
  const phase = deps.PHASES[room.turn?.phaseIndex || 0] || "";

  if (permission.expires === "until-used") return false;
  if (permission.availableTurn && turnNumber < permission.availableTurn) return false;
  if (permission.expiresTurnNumber != null && turnNumber > permission.expiresTurnNumber) return true;
  if (
    permission.expires === "end-of-turn" &&
    permission.expiresTurnNumber === turnNumber &&
    /^Cleanup$/i.test(phase)
  ) {
    return true;
  }
  return false;
}

function expirePermissions(room, deps) {
  normalizeState(room);
  room.playPermissions = room.playPermissions.filter((permission) => !expires(permission, room, deps));
}

function grantPermission(room, raw, deps) {
  normalizeState(room);
  const permission = {
    id: deps.createId(),
    playerId: String(raw.playerId),
    cardId: String(raw.cardId),
    zone: raw.zone || "exile",
    kind: raw.kind || "temporary-play",
    sourceName: raw.sourceName || "Card effect",
    createdAt: deps.nowIso(),
    createdTurnNumber: Number(room.turn?.number) || 0,
    expiresTurnNumber:
      raw.expiresTurnNumber != null
        ? Number(raw.expiresTurnNumber)
        : raw.expires === "end-of-turn"
          ? Number(room.turn?.number) || 0
          : null,
    expires: raw.expires || "until-used",
    availableTurn: Number(raw.availableTurn) || 0,
    freeCast: Boolean(raw.freeCast),
    mayPlayLand: raw.mayPlayLand !== false,
    mayCastSpell: raw.mayCastSpell !== false,
    costOverride: raw.costOverride || "",
    faceDown: Boolean(raw.faceDown),
    qualifier: raw.qualifier || ""
  };
  room.playPermissions.push(permission);
  return permission;
}

function staticPermissions(room, player, deps) {
  const permissions = [];
  const top = player.game?.library?.[0];

  for (const source of player.game?.battlefield || []) {
    if (source.phasedOut) continue;
    const text = String(deps.currentOracleText(source) || "");

    if (
      top &&
      /you may (?:look at and )?play the top card of your library/i.test(text)
    ) {
      permissions.push({
        id: `static:${source.id}:top`,
        playerId: player.id,
        cardId: top.id,
        zone: "library-top",
        kind: "static-top",
        sourceName: source.name,
        freeCast: false,
        mayPlayLand: true,
        mayCastSpell: true,
        static: true
      });
    }

    if (
      top &&
      /you may cast (?:creature|artifact|enchantment|instant|sorcery|nonland)?\s*spells? from the top of your library/i.test(text)
    ) {
      const qualifier = (
        text.match(/you may cast (.+?) spells? from the top of your library/i)?.[1] || ""
      ).trim();
      const typeLine = String(deps.currentTypeLine(top) || "");
      if (!qualifier || new RegExp(qualifier.replace(/\s+spells?$/i, ""), "i").test(typeLine)) {
        permissions.push({
          id: `static:${source.id}:cast-top`,
          playerId: player.id,
          cardId: top.id,
          zone: "library-top",
          kind: "static-top-cast",
          sourceName: source.name,
          freeCast: false,
          mayPlayLand: false,
          mayCastSpell: true,
          qualifier,
          static: true
        });
      }
    }

    for (const match of text.matchAll(
      /you may cast (.+?) cards? from your graveyard/gi
    )) {
      const qualifier = match[1].trim();
      for (const card of player.game.graveyard || []) {
        const typeLine = String(deps.currentTypeLine(card) || "");
        if (
          !qualifier ||
          /cards?$/i.test(qualifier) ||
          new RegExp(qualifier.replace(/\s+cards?$/i, ""), "i").test(typeLine)
        ) {
          permissions.push({
            id: `static:${source.id}:grave:${card.id}`,
            playerId: player.id,
            cardId: card.id,
            zone: "graveyard",
            kind: "static-graveyard",
            sourceName: source.name,
            freeCast: false,
            mayPlayLand: false,
            mayCastSpell: true,
            qualifier,
            static: true
          });
        }
      }
    }
  }

  return permissions;
}

function allPermissions(room, player, deps) {
  expirePermissions(room, deps);
  return [
    ...room.playPermissions.filter((permission) => permission.playerId === player.id),
    ...staticPermissions(room, player, deps)
  ].filter((permission) => !permission.availableTurn || (Number(room.turn?.number) || 0) >= permission.availableTurn);
}

function matchingPermission(room, player, cardId, zone, permissionId, deps) {
  return allPermissions(room, player, deps).find((permission) =>
    permission.cardId === cardId &&
    (permission.zone === zone || (zone === "library" && permission.zone === "library-top")) &&
    (!permissionId || permission.id === permissionId)
  );
}

function consumePermission(room, permission) {
  if (!permission || permission.static) return;
  if (permission.expires !== "until-used" && permission.kind !== "free-cast") return;
  room.playPermissions = room.playPermissions.filter((entry) => entry.id !== permission.id);
}

function preparePermissionCard(player, permission) {
  const located = findCardInZone(player, permission.zone, permission.cardId);
  if (!located) return { success: false, error: "That playable card is no longer in the permitted zone." };

  if (permission.zone === "library-top") {
    const [card] = player.game.library.splice(0, 1);
    player.game.exile.unshift(card);
    return { success: true, card, originalZone: "library-top", castZone: "exile" };
  }
  return {
    success: true,
    card: located.card,
    originalZone: permission.zone,
    castZone: permission.zone
  };
}

function restorePreparedCard(player, prepared) {
  if (prepared.originalZone !== "library-top") return;
  const index = player.game.exile.findIndex((card) => card.id === prepared.card.id);
  if (index >= 0) player.game.library.unshift(player.game.exile.splice(index, 1)[0]);
}

function withCostOverride(card, override, callback) {
  if (!override) return callback();
  card.cardData = card.cardData || {};
  const previous = card.cardData.manaCost;
  card.cardData.manaCost = override;
  try {
    return callback();
  } finally {
    card.cardData.manaCost = previous;
  }
}

function permissionCast(room, actor, action, legacy, deps) {
  const cardId = String(action?.cardId || "");
  const zone = action?.fromZone || "exile";
  const permission = matchingPermission(room, actor, cardId, zone, action?.permissionId, deps);
  if (!permission) return { success: false, error: "You do not currently have permission to play that card." };

  const prepared = preparePermissionCard(actor, permission);
  if (!prepared.success) return prepared;

  const typeLine = String(deps.currentTypeLine(prepared.card) || "");
  const isLand = /\bLand\b/i.test(typeLine);

  if (isLand) {
    if (!permission.mayPlayLand) {
      restorePreparedCard(actor, prepared);
      return { success: false, error: "That permission allows casting, not playing a land." };
    }

    const result = legacy(room, actor, {
      type: "move-card",
      fromZone: prepared.castZone,
      toZone: "battlefield",
      cardId
    });
    if (!result?.success) {
      restorePreparedCard(actor, prepared);
      return result;
    }
    consumePermission(room, permission);
    return { success: true, playedLand: true };
  }

  if (!permission.mayCastSpell) {
    restorePreparedCard(actor, prepared);
    return { success: false, error: "That permission does not allow casting this spell." };
  }

  const override = permission.freeCast ? "{0}" : permission.costOverride;
  const result = withCostOverride(prepared.card, override, () =>
    legacy(room, actor, {
      ...action,
      type: "auto-cast-card",
      cardId,
      fromZone: prepared.castZone,
      freeCast: permission.freeCast,
      permissionId: permission.id
    })
  );

  if (!result?.success) {
    restorePreparedCard(actor, prepared);
    return result;
  }

  const stackItem = room.stack?.at(-1);
  if (stackItem?.sourceCardId === cardId) {
    stackItem.permissionCast = {
      permissionId: permission.id,
      freeCast: permission.freeCast,
      sourceName: permission.sourceName,
      originalZone: prepared.originalZone
    };
  }

  consumePermission(room, permission);
  return { success: true, cast: true };
}

function impulseExile(room, player, text, sourceName, deps) {
  const match = String(text).match(
    /exile the top\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+cards? of your library/i
  );
  if (!match) return [];

  const words = {
    a:1,an:1,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10
  };
  const amount = /^\d+$/.test(match[1]) ? Number(match[1]) : words[match[1].toLowerCase()] || 1;
  const block = String(text).slice(match.index).split(/\.(?:\s|$)/).slice(0, 3).join(". ");

  if (!/you may (?:play|cast) (?:those cards|them|that card|it)/i.test(block)) return [];

  const exiled = player.game.library.splice(0, amount);
  player.game.exile.unshift(...exiled);

  const untilEnd = /until end of turn|this turn/i.test(block);
  return exiled.map((card) =>
    grantPermission(room, {
      playerId: player.id,
      cardId: card.id,
      zone: "exile",
      kind: "impulse",
      sourceName,
      expires: untilEnd ? "end-of-turn" : "until-used",
      freeCast: false,
      mayPlayLand: /\bplay\b/i.test(block),
      mayCastSpell: true
    }, deps)
  );
}

function locateTargetCard(room, targets, deps) {
  for (const target of unique(targets)) {
    if (!target.startsWith("card:")) continue;
    const located = deps.locateCard(room, target.slice(5));
    if (located) return located;
  }
  return null;
}

function locateTargetStack(room, targets) {
  for (const target of unique(targets)) {
    if (!target.startsWith("stack:")) continue;
    const item = room.stack?.find((entry) => entry.id === target.slice(6));
    if (item) return item;
  }
  return null;
}

function linkedExile(room, item, deps) {
  const text = String(item?.text || "");
  if (
    !/\bexile target\b/i.test(text) ||
    !/\buntil\b[^.]*leaves the battlefield/i.test(text)
  ) return null;

  const located = locateTargetCard(room, item.targets, deps);
  if (!located) return null;

  let exiledCard = located.card;
  if (located.zone === "battlefield") {
    const [card] = located.player.game.battlefield.splice(located.index, 1);
    located.player.game.exile.unshift(card);
    exiledCard = card;
  } else if (located.zone !== "exile") {
    return null;
  }

  const state = normalizeState(room);
  const link = {
    id: deps.createId(),
    sourceCardId: String(item.sourceCardId || ""),
    sourceName: item.name,
    exiledCardId: exiledCard.id,
    ownerId: exiledCard.ownerId || located.player.id,
    controllerId: exiledCard.controllerId,
    createdAt: deps.nowIso()
  };
  state.linkedExile.push(link);
  return link;
}

function sourceOnBattlefield(room, sourceCardId) {
  return room.players.some((player) =>
    player.game?.battlefield?.some((card) => card.id === sourceCardId)
  );
}

function reconcileLinkedExile(room, deps) {
  const state = normalizeState(room);
  const remaining = [];

  for (const link of state.linkedExile) {
    if (sourceOnBattlefield(room, link.sourceCardId)) {
      remaining.push(link);
      continue;
    }

    const owner = deps.findPlayer(room, link.ownerId);
    if (!owner?.game) continue;
    const index = owner.game.exile.findIndex((card) => card.id === link.exiledCardId);
    if (index < 0) continue;

    const [card] = owner.game.exile.splice(index, 1);
    card.controllerId = owner.id;
    card.tapped = false;
    card.summoningSick = deps.isCreatureCard(card);
    owner.game.battlefield.unshift(card);
    deps.addLog(room, `${card.name} returned from linked exile.`, "linked-exile");
  }

  state.linkedExile = remaining;
}

function copyPermanent(room, actor, targetCardId, deps) {
  const located = deps.findBattlefieldCard(room, String(targetCardId || ""));
  if (!located) return { success: false, error: "Choose a permanent on the battlefield to copy." };

  const source = located.card;
  const copy = deps.migrateCard(
    {
      ...JSON.parse(JSON.stringify(source)),
      id: deps.createId(),
      ownerId: actor.id,
      controllerId: actor.id,
      token: true,
      commander: false,
      copiedFromCardId: source.id,
      tapped: false,
      attacking: false,
      defendingPlayerId: null,
      blockingCardId: null,
      attachedToId: null,
      counters: {},
      damageMarked: 0,
      deathtouchMarked: false,
      summoningSick: deps.isCreatureCard(source)
    },
    actor.id
  );
  actor.game.battlefield.unshift(copy);
  normalizeState(room).copyLog.push({
    id: deps.createId(),
    type: "permanent",
    sourceId: source.id,
    copyId: copy.id,
    playerId: actor.id,
    time: deps.nowIso()
  });
  deps.addLog(room, `${actor.name} created a token copy of ${source.name}.`, "copy");
  return { success: true, copyId: copy.id };
}

function copyStackItem(room, actor, stackItemId, targets, deps) {
  const source = room.stack?.find((item) => item.id === String(stackItemId || ""));
  if (!source) return { success: false, error: "Choose a spell or ability on the stack to copy." };

  const copy = {
    ...JSON.parse(JSON.stringify(source)),
    id: deps.createId(),
    name: `${source.name} copy`,
    controllerId: actor.id,
    card: null,
    sourceCardId: source.sourceCardId,
    targets: unique(targets).length ? unique(targets) : [...(source.targets || [])],
    copiedFromStackItemId: source.id,
    isCopy: true,
    createdAt: deps.nowIso()
  };
  room.stack.push(copy);
  deps.resetPriority(room, actor.id);
  normalizeState(room).copyLog.push({
    id: deps.createId(),
    type: "stack",
    sourceId: source.id,
    copyId: copy.id,
    playerId: actor.id,
    time: deps.nowIso()
  });
  deps.addLog(room, `${actor.name} copied ${source.name} on the stack.`, "copy");
  return { success: true, copyId: copy.id };
}

function automaticCopies(room, item, deps) {
  const text = String(item?.text || "");
  const controller = deps.findPlayer(room, item?.controllerId);
  if (!controller?.game) return;

  if (/create a token that'?s a copy of target (?:creature|permanent)/i.test(text)) {
    const located = locateTargetCard(room, item.targets, deps);
    if (located?.zone === "battlefield") copyPermanent(room, controller, located.card.id, deps);
  }

  if (/copy target (?:instant or sorcery )?spell/i.test(text)) {
    const target = locateTargetStack(room, item.targets);
    if (target) copyStackItem(room, controller, target.id, item.newTargets || [], deps);
  }
}

function rebound(room, item, deps) {
  if (!item?.card || item.sourceZone !== "hand") return null;
  if (!/\brebound\b/i.test(String(deps.currentOracleText(item.card) || ""))) return null;

  const controller = deps.findPlayer(room, item.controllerId);
  if (!controller?.game) return null;
  const index = controller.game.graveyard.findIndex((card) => card.id === item.card.id);
  if (index < 0) return null;

  const [card] = controller.game.graveyard.splice(index, 1);
  controller.game.exile.unshift(card);
  return grantPermission(room, {
    playerId: controller.id,
    cardId: card.id,
    zone: "exile",
    kind: "rebound",
    sourceName: card.name,
    availableTurn: (Number(room.turn?.number) || 0) + 1,
    expiresTurnNumber: (Number(room.turn?.number) || 0) + 1,
    expires: "end-of-turn",
    freeCast: true,
    mayPlayLand: false,
    mayCastSpell: true
  }, deps);
}

function afterResolve(room, item, deps) {
  if (!item) return;
  const controller = deps.findPlayer(room, item.controllerId);
  if (!controller?.game) return;

  impulseExile(room, controller, item.text || deps.currentOracleText(item.card), item.name, deps);
  linkedExile(room, item, deps);
  automaticCopies(room, item, deps);
  rebound(room, item, deps);
  reconcileLinkedExile(room, deps);
}

function publicPermissions(room, viewerId, deps) {
  const player = deps.findPlayer(room, viewerId);
  if (!player?.game) return [];
  return allPermissions(room, player, deps)
    .map((permission) => {
      const located = findCardInZone(player, permission.zone, permission.cardId);
      return located
        ? { ...permission, card: permission.faceDown ? null : deps.publicCard(located.card) }
        : null;
    })
    .filter(Boolean);
}

function copyCandidates(room, deps) {
  return {
    stack: (room.stack || []).map((item) => ({
      id: item.id,
      name: item.name,
      kind: item.kind,
      controllerId: item.controllerId,
      targets: item.targets || []
    })),
    permanents: room.players.flatMap((player) =>
      (player.game?.battlefield || []).map((card) => ({
        playerId: player.id,
        playerName: player.name,
        card: deps.publicCard(card)
      }))
    )
  };
}

function createPermissionsRulesEngine(deps) {
  return {
    version: "47.0.0",

    processGameAction(room, actor, action, legacy) {
      expirePermissions(room, deps);
      reconcileLinkedExile(room, deps);
      const type = String(action?.type || "");

      if (type === "permission-play-card") {
        return permissionCast(room, actor, action, legacy, deps);
      }
      if (type === "copy-stack-item") {
        return copyStackItem(room, actor, action?.stackItemId, action?.targets, deps);
      }
      if (type === "copy-permanent") {
        return copyPermanent(room, actor, action?.targetCardId, deps);
      }

      if (["cast-card", "auto-cast-card"].includes(type)) {
        const zone = action?.fromZone || "hand";
        if (["exile", "graveyard", "library"].includes(zone)) {
          const permission = matchingPermission(
            room, actor, String(action?.cardId || ""), zone, action?.permissionId, deps
          );
          if (!permission) {
            return {
              success: false,
              error: "That card cannot be cast from this zone without a current permission."
            };
          }
        }
      }

      if (type === "mechanic-auto-cast" && action?.fromZone === "graveyard") {
        // v46 validates Flashback and Escape before the inner cast.
      }

      const result = legacy(room, actor, action);
      reconcileLinkedExile(room, deps);
      expirePermissions(room, deps);
      return result;
    },

    afterResolve(room, item) {
      afterResolve(room, item, deps);
    },

    permissions(room, viewerId) {
      return publicPermissions(room, viewerId, deps);
    },

    copyCandidates(room) {
      return copyCandidates(room, deps);
    },

    status() {
      return {
        success: true,
        version: "47.0.0",
        automatic: [
          "temporary play and cast permissions",
          "impulse draw from exile until end of turn",
          "free-cast permissions from Cascade and Discover",
          "play the top card of your library",
          "common cast-from-graveyard static permissions",
          "permission expiry and one-use consumption",
          "linked exile until the source leaves the battlefield",
          "return linked cards under their owner's control",
          "token copies of permanents",
          "copies of spells and abilities on the stack",
          "Rebound exile and next-turn free-cast permission",
          "server enforcement against unauthorized exile and graveyard casting"
        ],
        assisted: [
          "new targets for copied spells",
          "copying choices and variable X values",
          "Adventure and split-card permission faces",
          "Foretell payment and hidden face-down information",
          "Suspend and time-counter casting",
          "Missions involving opponent libraries",
          "ownership-changing linked exile",
          "permissions with complex dynamic qualifiers"
        ]
      };
    }
  };
}

module.exports = {
  createPermissionsRulesEngine,
  _test: {
    grantPermission,
    expirePermissions,
    impulseExile,
    linkedExile,
    reconcileLinkedExile,
    copyPermanent,
    copyStackItem,
    publicPermissions,
    permissionCast
  }
};
