"use strict";

const COLORS = ["W", "U", "B", "R", "G", "C"];
const KEYWORDS = [
  "deathtouch",
  "double strike",
  "first strike",
  "flying",
  "haste",
  "hexproof",
  "indestructible",
  "lifelink",
  "menace",
  "reach",
  "trample",
  "vigilance",
  "ward"
];

function list(value) {
  return Array.isArray(value) ? value : [];
}

function unique(value) {
  return [...new Set(list(value).map(String).filter(Boolean))];
}

function normalizeState(room) {
  room.attachmentsV53 =
    room.attachmentsV53 && typeof room.attachmentsV53 === "object"
      ? room.attachmentsV53
      : {};

  const state = room.attachmentsV53;
  state.choices = list(state.choices)
    .filter((choice) => choice && choice.id && choice.status === "open")
    .slice(-50);
  state.stackMeta =
    state.stackMeta && typeof state.stackMeta === "object"
      ? state.stackMeta
      : {};
  state.lastError = state.lastError || null;
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

function isAura(card, deps) {
  return /\bEnchantment\b/i.test(typeLine(card, deps)) &&
    /\bAura\b/i.test(typeLine(card, deps));
}

function isEquipment(card, deps) {
  return /\bArtifact\b/i.test(typeLine(card, deps)) &&
    /\bEquipment\b/i.test(typeLine(card, deps));
}

function isFortification(card, deps) {
  return /\bArtifact\b/i.test(typeLine(card, deps)) &&
    /\bFortification\b/i.test(typeLine(card, deps));
}

function isVehicle(card, deps) {
  return /\bArtifact\b/i.test(typeLine(card, deps)) &&
    /\bVehicle\b/i.test(typeLine(card, deps));
}

function isMount(card, deps) {
  return /\bCreature\b/i.test(typeLine(card, deps)) &&
    /\bMount\b/i.test(typeLine(card, deps));
}

function parseKeywordCost(card, keyword, deps) {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const text = oracle(card, deps);

  for (const line of text.split(/\n+/)) {
    if (!new RegExp(`^\\s*${escaped}\\b`, "i").test(line)) continue;
    const symbols = line.match(/(?:\{[^}]+\})+/);
    if (!symbols) continue;

    const qualifier = line
      .slice(0, symbols.index)
      .replace(new RegExp(`^\\s*${escaped}\\b`, "i"), "")
      .replace(/[—–-]\s*$/, "")
      .trim();

    return {
      manaCost: symbols[0],
      qualifier
    };
  }

  return null;
}

function parseEquip(card, deps) {
  return parseKeywordCost(card, "Equip", deps);
}

function parseFortify(card, deps) {
  return parseKeywordCost(card, "Fortify", deps);
}

function parseReconfigure(card, deps) {
  return parseKeywordCost(card, "Reconfigure", deps);
}

function parseCrew(card, deps) {
  const match = oracle(card, deps).match(/\bcrew\s+(\d+)\b/i);
  return match ? { power: Math.max(0, Number(match[1])) } : null;
}

function parseSaddle(card, deps) {
  const match = oracle(card, deps).match(/\bsaddle\s+(\d+)\b/i);
  return match ? { power: Math.max(0, Number(match[1])) } : null;
}

function parseEnchant(card, deps) {
  const line = oracle(card, deps)
    .split(/\n+/)
    .map((entry) => entry.trim())
    .find((entry) => /^enchant\b/i.test(entry));

  if (!line) return null;

  const phrase = line
    .replace(/^enchant\s+/i, "")
    .replace(/[.;].*$/, "")
    .trim();

  const lower = phrase.toLowerCase();
  const zone =
    /\bcard in a graveyard\b/.test(lower)
      ? "graveyard"
      : /\bcard in exile\b/.test(lower)
        ? "exile"
        : "battlefield";

  return {
    phrase,
    lower,
    zone,
    player: /\bplayer\b/.test(lower),
    creature: /\bcreature\b/.test(lower),
    artifact: /\bartifact\b/.test(lower),
    enchantment: /\benchantment\b/.test(lower),
    land: /\bland\b/.test(lower),
    planeswalker: /\bplaneswalker\b/.test(lower),
    battle: /\bbattle\b/.test(lower),
    permanent: /\bpermanent\b/.test(lower),
    nonland: /\bnonland\b/.test(lower),
    noncreature: /\bnoncreature\b/.test(lower),
    youControl: /\byou control\b/.test(lower),
    opponentControls:
      /\ban opponent controls\b/.test(lower) ||
      /\bopponent controls\b/.test(lower),
    tapped: /\btapped\b/.test(lower),
    untapped: /\buntapped\b/.test(lower)
  };
}

function parseAttachmentEffects(card, deps) {
  const text = oracle(card, deps);
  const effects = [];

  for (const match of text.matchAll(
    /\b(?:enchanted|equipped|fortified) (?:creature|permanent|land|artifact)\s+gets\s+([+-]\d+)\s*\/\s*([+-]\d+)/gi
  )) {
    effects.push({
      power: Number(match[1]),
      toughness: Number(match[2])
    });
  }

  for (const keyword of KEYWORDS) {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(
      `\\b(?:enchanted|equipped|fortified) (?:creature|permanent|land|artifact)[^.\\n]*(?:has|gains)\\s+(?:[^.\\n]*\\b)?${escaped}\\b`,
      "i"
    );
    if (pattern.test(text)) {
      effects.push({ keyword });
    }
  }

  return effects;
}

function parseManaRequirement(cost) {
  const requirement = {
    W: 0,
    U: 0,
    B: 0,
    R: 0,
    G: 0,
    C: 0,
    generic: 0
  };

  for (const match of String(cost || "").matchAll(/\{([^}]+)\}/g)) {
    const symbol = String(match[1] || "").toUpperCase();

    if (/^\d+$/.test(symbol)) {
      requirement.generic += Number(symbol);
    } else if (COLORS.includes(symbol)) {
      requirement[symbol] += 1;
    } else if (symbol.includes("/")) {
      const color = symbol
        .split("/")
        .find((entry) => COLORS.includes(entry));
      if (color) requirement[color] += 1;
      else requirement.generic += 1;
    }
  }

  return requirement;
}

function manaOptions(card, deps) {
  if (!card || card.tapped || card.phasedOut) return [];

  const options = [];
  const cardType = typeLine(card, deps);
  const text = oracle(card, deps);
  const basics = {
    Plains: "W",
    Island: "U",
    Swamp: "B",
    Mountain: "R",
    Forest: "G",
    Wastes: "C"
  };

  for (const [basic, color] of Object.entries(basics)) {
    if (new RegExp(`\\b${basic}\\b`, "i").test(cardType)) {
      options.push({ mana: { [color]: 1 } });
    }
  }

  for (const match of text.matchAll(
    /\{T\}[^.]*:\s*Add\s+([^.;\n]+)/gi
  )) {
    const output = String(match[1] || "");
    const symbols = [
      ...output.matchAll(/\{([WUBRGC])\}/gi)
    ].map((entry) => entry[1].toUpperCase());

    if (symbols.length) {
      if (/\bor\b/i.test(output)) {
        for (const symbol of symbols) {
          options.push({ mana: { [symbol]: 1 } });
        }
      } else {
        const mana = {};
        for (const symbol of symbols) {
          mana[symbol] = (mana[symbol] || 0) + 1;
        }
        options.push({ mana });
      }
    } else if (/one mana of any color/i.test(output)) {
      for (const color of ["W", "U", "B", "R", "G"]) {
        options.push({ mana: { [color]: 1 } });
      }
    }
  }

  const seen = new Set();
  return options.filter((option) => {
    const key = COLORS.map((color) => option.mana[color] || 0).join(":");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function autoPay(room, actor, cost, deps) {
  const requirement = parseManaRequirement(cost);
  const snapshot = JSON.parse(JSON.stringify(actor.game));
  const selected = [];

  function spendPool(color, amount) {
    const available = Number(actor.game.manaPool?.[color]) || 0;
    const spent = Math.min(available, amount);
    actor.game.manaPool[color] = available - spent;
    return amount - spent;
  }

  for (const color of COLORS) {
    requirement[color] = spendPool(color, requirement[color]);
  }

  const sources = [];
  for (const card of actor.game.battlefield || []) {
    const options = manaOptions(card, deps);
    if (options.length) sources.push({ card, options });
  }

  for (const color of COLORS) {
    while (requirement[color] > 0) {
      const source = sources.find(
        (entry) =>
          !selected.includes(entry.card.id) &&
          entry.options.some((option) => (option.mana[color] || 0) > 0)
      );

      if (!source) {
        actor.game = snapshot;
        return {
          success: false,
          error: `Auto-pay could not produce enough ${color} mana.`
        };
      }

      const option = source.options.find(
        (entry) => (entry.mana[color] || 0) > 0
      );
      source.card.tapped = true;
      selected.push(source.card.id);

      for (const produced of COLORS) {
        actor.game.manaPool[produced] =
          (Number(actor.game.manaPool[produced]) || 0) +
          (Number(option.mana[produced]) || 0);
      }

      requirement[color] = spendPool(color, requirement[color]);
    }
  }

  let generic = Math.max(0, requirement.generic);

  for (const color of COLORS) {
    generic = spendPool(color, generic);
    if (generic <= 0) break;
  }

  while (generic > 0) {
    const source = sources.find(
      (entry) => !selected.includes(entry.card.id)
    );

    if (!source) {
      actor.game = snapshot;
      return {
        success: false,
        error: "Auto-pay could not produce enough generic mana."
      };
    }

    const option = source.options[0];
    source.card.tapped = true;
    selected.push(source.card.id);

    for (const produced of COLORS) {
      actor.game.manaPool[produced] =
        (Number(actor.game.manaPool[produced]) || 0) +
        (Number(option.mana[produced]) || 0);
    }

    for (const color of COLORS) {
      generic = spendPool(color, generic);
      if (generic <= 0) break;
    }
  }

  return {
    success: true,
    tappedCardIds: selected
  };
}

function targetControllerId(room, targetKey, deps) {
  if (String(targetKey).startsWith("player:")) {
    return String(targetKey).slice(7);
  }

  const cardId = String(targetKey || "").replace(/^card:/, "");
  return deps.findBattlefieldCard(room, cardId)?.card?.controllerId || "";
}

function auraCardTargetLegal(room, controllerId, card, restriction, deps) {
  const cardType = typeLine(card, deps);

  if (restriction.zone !== "battlefield") return false;
  if (restriction.player) return false;
  if (restriction.youControl && card.controllerId !== controllerId) return false;
  if (restriction.opponentControls && card.controllerId === controllerId) {
    return false;
  }
  if (restriction.creature && !deps.isCreatureCard(card)) return false;
  if (restriction.artifact && !/\bArtifact\b/i.test(cardType)) return false;
  if (restriction.enchantment && !/\bEnchantment\b/i.test(cardType)) {
    return false;
  }
  if (restriction.land && !/\bLand\b/i.test(cardType)) return false;
  if (restriction.planeswalker && !/\bPlaneswalker\b/i.test(cardType)) {
    return false;
  }
  if (restriction.battle && !/\bBattle\b/i.test(cardType)) return false;
  if (restriction.nonland && /\bLand\b/i.test(cardType)) return false;
  if (restriction.noncreature && deps.isCreatureCard(card)) return false;
  if (restriction.tapped && !card.tapped) return false;
  if (restriction.untapped && card.tapped) return false;

  const anyTypedRestriction =
    restriction.creature ||
    restriction.artifact ||
    restriction.enchantment ||
    restriction.land ||
    restriction.planeswalker ||
    restriction.battle ||
    restriction.permanent;

  return anyTypedRestriction || Boolean(cardType);
}

function auraTargetLegal(room, controllerId, aura, targetKey, deps) {
  const restriction = parseEnchant(aura, deps);
  if (!restriction) return false;

  if (String(targetKey).startsWith("player:")) {
    const player = deps.findPlayer(room, String(targetKey).slice(7));
    if (!player?.game || !restriction.player) return false;
    if (restriction.youControl && player.id !== controllerId) return false;
    if (restriction.opponentControls && player.id === controllerId) return false;
    return true;
  }

  const cardId = String(targetKey || "").replace(/^card:/, "");
  const located = deps.findBattlefieldCard(room, cardId);
  if (!located) return false;

  return auraCardTargetLegal(
    room,
    controllerId,
    located.card,
    restriction,
    deps
  );
}

function auraTargetCandidates(room, controllerId, aura, deps) {
  const restriction = parseEnchant(aura, deps);
  if (!restriction) return [];

  const candidates = [];

  if (restriction.player) {
    for (const player of room.players) {
      if (!player.game || player.game.lost || player.game.conceded) continue;
      const targetKey = `player:${player.id}`;
      if (!auraTargetLegal(room, controllerId, aura, targetKey, deps)) {
        continue;
      }

      candidates.push({
        targetKey,
        kind: "player",
        id: player.id,
        name: player.name,
        controllerId: player.id
      });
    }
  }

  if (restriction.zone === "battlefield" && !restriction.player) {
    for (const player of room.players) {
      for (const card of player.game?.battlefield || []) {
        const targetKey = `card:${card.id}`;
        if (!auraTargetLegal(room, controllerId, aura, targetKey, deps)) {
          continue;
        }

        candidates.push({
          targetKey,
          kind: "card",
          id: card.id,
          name: card.name,
          controllerId: card.controllerId,
          typeLine: typeLine(card, deps),
          card: deps.publicCard(card)
        });
      }
    }
  }

  return candidates;
}

function equipmentQualifierLegal(card, qualifier, deps) {
  const normalized = String(qualifier || "").trim().toLowerCase();
  if (!normalized || normalized === "creature") return true;
  if (normalized.includes("commander")) return Boolean(card.commander);
  if (normalized.includes("legendary") && !/\bLegendary\b/i.test(typeLine(card, deps))) {
    return false;
  }

  const cleaned = normalized
    .replace(/\b(?:legendary|creature|you control|only)\b/g, "")
    .trim();

  if (!cleaned) return true;

  return new RegExp(
    `\\b${cleaned.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
    "i"
  ).test(typeLine(card, deps));
}

function activationTargetLegal(
  room,
  controllerId,
  attachment,
  targetCard,
  mode,
  deps
) {
  if (!attachment || !targetCard) return false;

  if (mode === "equip") {
    const equip = parseEquip(attachment, deps);
    return Boolean(
      equip &&
      targetCard.controllerId === controllerId &&
      deps.isCreatureCard(targetCard) &&
      equipmentQualifierLegal(targetCard, equip.qualifier, deps)
    );
  }

  if (mode === "fortify") {
    return Boolean(
      parseFortify(attachment, deps) &&
      targetCard.controllerId === controllerId &&
      /\bLand\b/i.test(typeLine(targetCard, deps))
    );
  }

  if (mode === "reconfigure") {
    return Boolean(
      parseReconfigure(attachment, deps) &&
      targetCard.controllerId === controllerId &&
      deps.isCreatureCard(targetCard) &&
      targetCard.id !== attachment.id
    );
  }

  return false;
}

function attachedTarget(room, attachment, deps) {
  const attachedToId = String(attachment?.attachedToId || "");
  if (!attachedToId) return null;

  if (attachedToId.startsWith("player:")) {
    const player = deps.findPlayer(room, attachedToId.slice(7));
    return player ? { kind: "player", player } : null;
  }

  const located = deps.findBattlefieldCard(room, attachedToId);
  return located
    ? {
        kind: "card",
        ...located
      }
    : null;
}

function removeAttachmentEffects(room) {
  for (const player of room.players) {
    for (const card of player.game?.battlefield || []) {
      card.temporaryEffects = list(card.temporaryEffects).filter(
        (effect) => effect.expires !== "attachment-v53"
      );
    }
  }
}

function applyAttachmentEffects(room, deps) {
  removeAttachmentEffects(room);

  for (const player of room.players) {
    for (const attachment of player.game?.battlefield || []) {
      if (!attachment.attachedToId) continue;

      const target = attachedTarget(room, attachment, deps);
      if (target?.kind !== "card") continue;

      for (const effect of parseAttachmentEffects(attachment, deps)) {
        target.card.temporaryEffects = list(target.card.temporaryEffects);
        target.card.temporaryEffects.push({
          id: deps.createId(),
          sourceCardId: attachment.id,
          power: Number(effect.power) || 0,
          toughness: Number(effect.toughness) || 0,
          keyword: effect.keyword || "",
          expires: "attachment-v53"
        });
      }
    }
  }
}

function currentTypeContainer(card) {
  const faces = list(card?.cardData?.faces);
  if (faces.length) {
    return faces[Math.max(0, Number(card.activeFaceIndex) || 0)] || card.cardData;
  }
  return card.cardData;
}

function setVehicleCreatureType(card, active) {
  const container = currentTypeContainer(card);
  if (!container) return;

  card.specialState = card.specialState || {};

  if (active) {
    if (!card.specialState.vehicleBaseTypeLineV53) {
      card.specialState.vehicleBaseTypeLineV53 =
        String(container.typeLine || card.cardData?.typeLine || "");
    }

    const base = card.specialState.vehicleBaseTypeLineV53;
    container.typeLine = /\bCreature\b/i.test(base)
      ? base
      : base.replace(/\bArtifact\b/i, "Artifact Creature");
    card.specialState.crewedV53 = true;
    return;
  }

  if (card.specialState.vehicleBaseTypeLineV53) {
    container.typeLine = card.specialState.vehicleBaseTypeLineV53;
  }
  delete card.specialState.vehicleBaseTypeLineV53;
  delete card.specialState.crewedV53;
}

function setReconfiguredType(card, attached) {
  const container = currentTypeContainer(card);
  if (!container) return;

  card.specialState = card.specialState || {};

  if (attached) {
    if (!card.specialState.reconfigureBaseTypeLineV53) {
      card.specialState.reconfigureBaseTypeLineV53 =
        String(container.typeLine || card.cardData?.typeLine || "");
    }

    container.typeLine = card.specialState.reconfigureBaseTypeLineV53
      .replace(/\bArtifact Creature\b/i, "Artifact")
      .replace(/\s{2,}/g, " ")
      .trim();
    card.specialState.reconfiguredV53 = true;
    return;
  }

  if (card.specialState.reconfigureBaseTypeLineV53) {
    container.typeLine = card.specialState.reconfigureBaseTypeLineV53;
  }
  delete card.specialState.reconfigureBaseTypeLineV53;
  delete card.specialState.reconfiguredV53;
}

function detachAttachment(attachment, deps) {
  attachment.attachedToId = null;
  attachment.specialState = attachment.specialState || {};

  if (parseReconfigure(attachment, deps)) {
    setReconfiguredType(attachment, false);
  }

  delete attachment.specialState.attachedModeV53;
  delete attachment.specialState.attachedAtV53;
}

function attachCard(room, attachment, targetKey, mode, deps) {
  if (mode === "aura") {
    if (
      !auraTargetLegal(
        room,
        attachment.controllerId,
        attachment,
        targetKey,
        deps
      )
    ) {
      return { success: false, error: "The Aura target is no longer legal." };
    }
  } else {
    const targetId = String(targetKey || "").replace(/^card:/, "");
    const located = deps.findBattlefieldCard(room, targetId);
    if (
      !located ||
      !activationTargetLegal(
        room,
        attachment.controllerId,
        attachment,
        located.card,
        mode,
        deps
      )
    ) {
      return {
        success: false,
        error: `The ${mode} target is no longer legal.`
      };
    }
  }

  detachAttachment(attachment, deps);
  attachment.attachedToId = String(targetKey).startsWith("player:")
    ? String(targetKey)
    : String(targetKey).replace(/^card:/, "");
  attachment.specialState = attachment.specialState || {};
  attachment.specialState.attachedModeV53 = mode;
  attachment.specialState.attachedAtV53 = deps.nowIso();

  if (mode === "reconfigure") {
    setReconfiguredType(attachment, true);
  }

  applyAttachmentEffects(room, deps);
  deps.queueSuggestedTriggers(room, "BECAME_ATTACHED", {
    attachment,
    targetKey,
    controllerId: attachment.controllerId
  });

  return { success: true };
}

function moveAuraToGraveyard(room, located, reason, deps) {
  const [aura] = located.player.game.battlefield.splice(located.index, 1);
  detachAttachment(aura, deps);

  if (!aura.token) {
    const owner = deps.findPlayer(room, aura.ownerId) || located.player;
    owner.game.graveyard.unshift(aura);
  }

  deps.addLog(
    room,
    `${aura.name} was put into its owner's graveyard${reason ? ` ${reason}` : ""}.`,
    "attachment"
  );
  return aura;
}

function auraStillLegal(room, aura, deps) {
  if (!aura.attachedToId) return false;

  const targetKey = String(aura.attachedToId).startsWith("player:")
    ? String(aura.attachedToId)
    : `card:${aura.attachedToId}`;

  return auraTargetLegal(
    room,
    aura.controllerId,
    aura,
    targetKey,
    deps
  );
}

function attachedPermanentStillLegal(room, attachment, deps) {
  const target = attachedTarget(room, attachment, deps);
  if (!target) return false;

  if (isEquipment(attachment, deps)) {
    return target.kind === "card" && deps.isCreatureCard(target.card);
  }
  if (isFortification(attachment, deps)) {
    return target.kind === "card" &&
      /\bLand\b/i.test(typeLine(target.card, deps));
  }
  if (parseReconfigure(attachment, deps)) {
    return target.kind === "card" &&
      deps.isCreatureCard(target.card) &&
      target.card.id !== attachment.id;
  }

  return true;
}

function enforceAttachmentState(room, deps) {
  let changed = false;

  for (const player of room.players) {
    for (let index = player.game?.battlefield?.length - 1; index >= 0; index -= 1) {
      const card = player.game.battlefield[index];

      if (isAura(card, deps)) {
        const pending =
          card.specialState?.pendingAuraTargetV53 ||
          card.specialState?.awaitingAuraChoiceV53;

        if (!card.attachedToId && pending) continue;

        if (!auraStillLegal(room, card, deps)) {
          moveAuraToGraveyard(
            room,
            { player, card, index, zone: "battlefield" },
            "because it was not legally attached",
            deps
          );
          changed = true;
        }
        continue;
      }

      if (
        card.attachedToId &&
        (isEquipment(card, deps) ||
          isFortification(card, deps) ||
          parseReconfigure(card, deps)) &&
        !attachedPermanentStillLegal(room, card, deps)
      ) {
        detachAttachment(card, deps);
        deps.addLog(
          room,
          `${card.name} became unattached because its attachment was no longer legal.`,
          "attachment"
        );
        changed = true;
      }
    }
  }

  if (changed) applyAttachmentEffects(room, deps);
  return changed;
}

function createAuraChoice(room, aura, deps) {
  const state = normalizeState(room);
  const existing = state.choices.find(
    (choice) =>
      choice.kind === "aura-enter" &&
      choice.sourceCardId === aura.id &&
      choice.status === "open"
  );
  if (existing) return existing;

  const candidates = auraTargetCandidates(
    room,
    aura.controllerId,
    aura,
    deps
  );

  if (!candidates.length) return null;

  const choice = {
    id: deps.createId(),
    status: "open",
    kind: "aura-enter",
    playerId: aura.controllerId,
    sourceCardId: aura.id,
    sourceName: aura.name,
    createdAt: deps.nowIso(),
    candidateKeys: candidates.map((entry) => entry.targetKey)
  };

  aura.specialState = aura.specialState || {};
  aura.specialState.awaitingAuraChoiceV53 = true;
  state.choices.push(choice);
  return choice;
}

function initializeAuraOnBattlefield(room, aura, deps) {
  aura.specialState = aura.specialState || {};
  const pendingTarget = String(
    aura.specialState.pendingAuraTargetV53 || ""
  );
  const wasCast = Boolean(aura.specialState.auraCastV53);

  if (pendingTarget) {
    const result = attachCard(
      room,
      aura,
      pendingTarget,
      "aura",
      deps
    );

    delete aura.specialState.pendingAuraTargetV53;
    delete aura.specialState.auraCastV53;

    if (result.success) {
      delete aura.specialState.awaitingAuraChoiceV53;
      deps.addLog(
        room,
        `${aura.name} entered attached to ${
          attachedTarget(room, aura, deps)?.card?.name ||
          attachedTarget(room, aura, deps)?.player?.name ||
          "its target"
        }.`,
        "attachment"
      );
      return result;
    }

    const located = deps.findBattlefieldCard(room, aura.id);
    if (located) {
      moveAuraToGraveyard(
        room,
        located,
        "because its spell target was illegal",
        deps
      );
    }
    return result;
  }

  if (wasCast) {
    const located = deps.findBattlefieldCard(room, aura.id);
    if (located) {
      moveAuraToGraveyard(
        room,
        located,
        "because it had no legal spell target",
        deps
      );
    }
    return { success: false, error: "The Aura had no legal target." };
  }

  const choice = createAuraChoice(room, aura, deps);
  if (choice) return { success: true, waiting: true };

  const located = deps.findBattlefieldCard(room, aura.id);
  if (located) {
    moveAuraToGraveyard(
      room,
      located,
      "because no legal object could be chosen",
      deps
    );
  }
  return {
    success: false,
    error: "No legal object could be chosen for the Aura."
  };
}

function initializeNewPermanents(room, beforeIds, deps) {
  const before = new Set(beforeIds);

  for (const player of room.players) {
    for (const card of player.game?.battlefield || []) {
      if (before.has(card.id) && card.specialState?.initializedV53) continue;

      card.specialState = card.specialState || {};
      card.specialState.initializedV53 = true;

      if (isAura(card, deps) && !card.attachedToId) {
        initializeAuraOnBattlefield(room, card, deps);
      }
    }
  }

  enforceAttachmentState(room, deps);
  applyAttachmentEffects(room, deps);
}

function resolveAuraChoice(room, actor, action, deps) {
  const state = normalizeState(room);
  const choice = state.choices.find(
    (entry) =>
      entry.id === action?.choiceId &&
      entry.kind === "aura-enter" &&
      entry.status === "open"
  );

  if (!choice) {
    return { success: false, error: "That Aura choice is unavailable." };
  }
  if (choice.playerId !== actor.id && room.hostId !== actor.id) {
    return { success: false, error: "That Aura belongs to another player." };
  }

  const targetKey = String(action?.targetKey || "");
  if (!choice.candidateKeys.includes(targetKey)) {
    return { success: false, error: "Choose a legal object for the Aura." };
  }

  const located = deps.findBattlefieldCard(room, choice.sourceCardId);
  if (!located) {
    choice.status = "resolved";
    state.choices = state.choices.filter((entry) => entry.status === "open");
    return { success: true };
  }

  const result = attachCard(
    room,
    located.card,
    targetKey,
    "aura",
    deps
  );
  if (!result.success) return result;

  delete located.card.specialState.awaitingAuraChoiceV53;
  choice.status = "resolved";
  state.choices = state.choices.filter((entry) => entry.status === "open");

  deps.addLog(
    room,
    `${actor.name} attached ${located.card.name}.`,
    "attachment"
  );

  return { success: true };
}

function sorceryTimingError(room, actor, deps) {
  const phase = deps.PHASES[room.turn?.phaseIndex || 0] || "";

  if (room.turn?.activePlayerId !== actor.id) {
    return "This attachment ability can normally be activated only during your turn.";
  }
  if (!["Main 1", "Main 2"].includes(phase)) {
    return "This attachment ability requires one of your main phases.";
  }
  if (room.stack?.length) {
    return "This attachment ability requires an empty stack.";
  }
  if (
    room.priority?.playerId &&
    room.priority.playerId !== actor.id
  ) {
    return "You do not currently have priority.";
  }
  return "";
}

function activationCost(attachment, mode, deps) {
  if (mode === "equip") return parseEquip(attachment, deps);
  if (mode === "fortify") return parseFortify(attachment, deps);
  if (mode === "reconfigure") return parseReconfigure(attachment, deps);
  return null;
}

function activateAttachment(room, actor, action, deps) {
  const mode = String(action?.mode || "");
  if (!["equip", "fortify", "reconfigure"].includes(mode)) {
    return { success: false, error: "Choose Equip, Fortify, or Reconfigure." };
  }

  const timingError = sorceryTimingError(room, actor, deps);
  if (timingError) return { success: false, error: timingError };

  const located = deps.findBattlefieldCard(
    room,
    String(action?.attachmentCardId || "")
  );
  if (!located || located.card.controllerId !== actor.id) {
    return { success: false, error: "Choose an attachment you control." };
  }

  const attachment = located.card;
  const parsed = activationCost(attachment, mode, deps);
  if (!parsed) {
    return {
      success: false,
      error: `${attachment.name} has no ${mode} ability.`
    };
  }

  const targetCardId = String(action?.targetCardId || "");

  if (
    mode === "reconfigure" &&
    !targetCardId &&
    attachment.attachedToId
  ) {
    const payment = autoPay(room, actor, parsed.manaCost, deps);
    if (!payment.success) return payment;

    const item = deps.pushStack(
      room,
      {
        kind: "ability",
        name: `${attachment.name} — Reconfigure`,
        controllerId: actor.id,
        sourceCardId: attachment.id,
        text: "Unattach this Equipment.",
        targets: [],
        createdAt: deps.nowIso()
      },
      actor.id
    );
    if (!item) return { success: false, error: "The ability could not be placed on the stack." };

    normalizeState(room).stackMeta[item.id] = {
      kind: "detach",
      mode,
      attachmentCardId: attachment.id,
      controllerId: actor.id
    };

    return { success: true, stackItemId: item.id };
  }

  const target = deps.findBattlefieldCard(room, targetCardId);
  if (
    !target ||
    !activationTargetLegal(
      room,
      actor.id,
      attachment,
      target.card,
      mode,
      deps
    )
  ) {
    return { success: false, error: `Choose a legal ${mode} target.` };
  }

  const payment = autoPay(room, actor, parsed.manaCost, deps);
  if (!payment.success) return payment;

  const item = deps.pushStack(
    room,
    {
      kind: "ability",
      name: `${attachment.name} — ${
        mode.charAt(0).toUpperCase() + mode.slice(1)
      }`,
      controllerId: actor.id,
      sourceCardId: attachment.id,
      text: `Attach ${attachment.name} to ${target.card.name}.`,
      targets: [`card:${target.card.id}`],
      createdAt: deps.nowIso()
    },
    actor.id
  );
  if (!item) return { success: false, error: "The ability could not be placed on the stack." };

  normalizeState(room).stackMeta[item.id] = {
    kind: "attach",
    mode,
    attachmentCardId: attachment.id,
    targetCardId: target.card.id,
    controllerId: actor.id
  };

  deps.addLog(
    room,
    `${actor.name} activated ${attachment.name}'s ${mode} ability.`,
    "attachment"
  );

  return { success: true, stackItemId: item.id };
}

function totalSelectedPower(cards, deps) {
  return cards.reduce((sum, card) => {
    const stats = deps.effectiveStats(card);
    return sum + Math.max(0, Number(stats?.power) || 0);
  }, 0);
}

function selectedTapCreatures(room, actor, cardIds, excludedId, deps) {
  const ids = unique(cardIds);
  const cards = [];

  for (const id of ids) {
    const located = deps.findBattlefieldCard(room, id);
    if (
      !located ||
      located.card.controllerId !== actor.id ||
      located.card.id === excludedId ||
      located.card.tapped ||
      located.card.phasedOut ||
      !deps.isCreatureCard(located.card) ||
      (isVehicle(located.card, deps) &&
        !located.card.specialState?.crewedV53)
    ) {
      return {
        success: false,
        error: "Every selected Crew or Saddle creature must be another untapped creature you control."
      };
    }

    cards.push(located.card);
  }

  return {
    success: true,
    cards
  };
}

function activateCrewOrSaddle(room, actor, action, kind, deps) {
  const source = deps.findBattlefieldCard(
    room,
    String(action?.sourceCardId || "")
  );
  if (!source || source.card.controllerId !== actor.id) {
    return { success: false, error: "Choose a permanent you control." };
  }

  const sourceCard = source.card;
  const parsed =
    kind === "crew"
      ? parseCrew(sourceCard, deps)
      : parseSaddle(sourceCard, deps);

  if (!parsed) {
    return {
      success: false,
      error: `${sourceCard.name} has no ${kind} ability.`
    };
  }

  if (kind === "crew" && !isVehicle(sourceCard, deps)) {
    return { success: false, error: "Crew requires a Vehicle." };
  }
  if (kind === "saddle" && !isMount(sourceCard, deps)) {
    return { success: false, error: "Saddle requires a Mount." };
  }

  if (
    room.priority?.playerId &&
    room.priority.playerId !== actor.id
  ) {
    return { success: false, error: "You do not currently have priority." };
  }

  if (kind === "saddle") {
    const timingError = sorceryTimingError(room, actor, deps);
    if (timingError) return { success: false, error: timingError };
  }

  const selection = selectedTapCreatures(
    room,
    actor,
    action?.creatureCardIds,
    sourceCard.id,
    deps
  );
  if (!selection.success) return selection;

  const totalPower = totalSelectedPower(selection.cards, deps);
  if (totalPower < parsed.power) {
    return {
      success: false,
      error: `${kind === "crew" ? "Crew" : "Saddle"} ${parsed.power} needs at least ${parsed.power} total power; the selected creatures have ${totalPower}.`
    };
  }

  for (const card of selection.cards) card.tapped = true;

  const item = deps.pushStack(
    room,
    {
      kind: "ability",
      name: `${sourceCard.name} — ${
        kind === "crew" ? "Crew" : "Saddle"
      } ${parsed.power}`,
      controllerId: actor.id,
      sourceCardId: sourceCard.id,
      text:
        kind === "crew"
          ? "This Vehicle becomes an artifact creature until end of turn."
          : "This Mount becomes saddled until end of turn.",
      targets: [],
      createdAt: deps.nowIso()
    },
    actor.id
  );

  if (!item) {
    return { success: false, error: "The ability could not be placed on the stack." };
  }

  normalizeState(room).stackMeta[item.id] = {
    kind,
    sourceCardId: sourceCard.id,
    controllerId: actor.id,
    paidPower: totalPower,
    tappedCardIds: selection.cards.map((card) => card.id)
  };

  deps.addLog(
    room,
    `${actor.name} activated ${kind} ${parsed.power} on ${sourceCard.name}.`,
    "attachment"
  );

  return {
    success: true,
    stackItemId: item.id,
    totalPower
  };
}

function resolveStackMeta(room, item, deps) {
  const state = normalizeState(room);
  const meta = state.stackMeta[item?.id];
  if (!meta) return false;

  delete state.stackMeta[item.id];

  if (meta.kind === "attach") {
    const attachment = deps.findBattlefieldCard(
      room,
      meta.attachmentCardId
    )?.card;
    const target = deps.findBattlefieldCard(
      room,
      meta.targetCardId
    )?.card;

    if (
      attachment &&
      target &&
      activationTargetLegal(
        room,
        attachment.controllerId,
        attachment,
        target,
        meta.mode,
        deps
      )
    ) {
      attachCard(
        room,
        attachment,
        `card:${target.id}`,
        meta.mode,
        deps
      );
      deps.addLog(
        room,
        `${attachment.name} became attached to ${target.name}.`,
        "attachment"
      );
    } else {
      deps.addLog(
        room,
        "The attachment ability resolved without attaching because its target was illegal.",
        "attachment"
      );
    }
    return true;
  }

  if (meta.kind === "detach") {
    const attachment = deps.findBattlefieldCard(
      room,
      meta.attachmentCardId
    )?.card;
    if (attachment) {
      detachAttachment(attachment, deps);
      applyAttachmentEffects(room, deps);
      deps.addLog(
        room,
        `${attachment.name} became unattached.`,
        "attachment"
      );
    }
    return true;
  }

  if (meta.kind === "crew") {
    const vehicle = deps.findBattlefieldCard(
      room,
      meta.sourceCardId
    )?.card;
    if (vehicle) {
      setVehicleCreatureType(vehicle, true);
      vehicle.specialState = vehicle.specialState || {};
      vehicle.specialState.crewedTurnV53 =
        Number(room.turn?.number) || 0;
      vehicle.summoningSick = Boolean(vehicle.summoningSick);
      deps.queueSuggestedTriggers(room, "VEHICLE_CREWED", {
        card: vehicle,
        controllerId: vehicle.controllerId
      });
      deps.addLog(
        room,
        `${vehicle.name} became an artifact creature until end of turn.`,
        "attachment"
      );
    }
    return true;
  }

  if (meta.kind === "saddle") {
    const mount = deps.findBattlefieldCard(
      room,
      meta.sourceCardId
    )?.card;
    if (mount) {
      mount.specialState = mount.specialState || {};
      mount.specialState.saddledV53 = true;
      mount.specialState.saddledTurnV53 =
        Number(room.turn?.number) || 0;
      deps.queueSuggestedTriggers(room, "MOUNT_SADDLED", {
        card: mount,
        controllerId: mount.controllerId
      });
      deps.addLog(
        room,
        `${mount.name} became saddled until end of turn.`,
        "attachment"
      );
    }
    return true;
  }

  return false;
}

function cleanupTurnEffects(room, deps) {
  const currentTurn = Number(room.turn?.number) || 0;

  for (const player of room.players) {
    for (const card of player.game?.battlefield || []) {
      if (
        card.specialState?.crewedV53 &&
        Number(card.specialState?.crewedTurnV53) !== currentTurn
      ) {
        setVehicleCreatureType(card, false);
        delete card.specialState.crewedTurnV53;
      }

      if (
        card.specialState?.saddledV53 &&
        Number(card.specialState?.saddledTurnV53) !== currentTurn
      ) {
        delete card.specialState.saddledV53;
        delete card.specialState.saddledTurnV53;
      }
    }
  }
}

function cleanupAtEndStep(room, deps) {
  const phase = deps.PHASES[room.turn?.phaseIndex || 0] || "";
  if (!["Cleanup", "Untap"].includes(phase)) return;

  for (const player of room.players) {
    for (const card of player.game?.battlefield || []) {
      if (card.specialState?.crewedV53) {
        setVehicleCreatureType(card, false);
        delete card.specialState.crewedTurnV53;
      }
      delete card.specialState?.saddledV53;
      delete card.specialState?.saddledTurnV53;
    }
  }
}

function pruneStackMeta(room) {
  const state = normalizeState(room);
  const activeIds = new Set(room.stack.map((item) => item.id));

  for (const id of Object.keys(state.stackMeta)) {
    if (!activeIds.has(id)) delete state.stackMeta[id];
  }
}

function vehicleCreatureLegal(card, deps) {
  return !isVehicle(card, deps) ||
    Boolean(card.specialState?.crewedV53) ||
    /\bCreature\b/i.test(typeLine(card, deps));
}

function validateLegacyCreatureUse(room, action, deps) {
  const type = String(action?.type || "");

  if (type === "declare-attacker" || type === "clear-attacker") {
    const card = deps.findBattlefieldCard(
      room,
      String(action?.cardId || "")
    )?.card;
    if (card && !vehicleCreatureLegal(card, deps)) {
      return {
        success: false,
        error: `${card.name} is a Vehicle and must be crewed before it can attack.`
      };
    }
  }

  if (type === "block-card") {
    const blocker = deps.findBattlefieldCard(
      room,
      String(action?.sourceCardId || "")
    )?.card;
    if (blocker && !vehicleCreatureLegal(blocker, deps)) {
      return {
        success: false,
        error: `${blocker.name} is a Vehicle and must be crewed before it can block.`
      };
    }
  }

  if (type === "fight-card") {
    for (const id of [action?.sourceCardId, action?.targetCardId]) {
      const card = deps.findBattlefieldCard(room, String(id || ""))?.card;
      if (card && !vehicleCreatureLegal(card, deps)) {
        return {
          success: false,
          error: `${card.name} is not currently a creature.`
        };
      }
    }
  }

  if (type === "casting-v50-cast" && action?.casualtyCardId) {
    const card = deps.findBattlefieldCard(
      room,
      String(action.casualtyCardId)
    )?.card;
    if (card && !vehicleCreatureLegal(card, deps)) {
      return {
        success: false,
        error: "An uncrewed Vehicle cannot be sacrificed as the Casualty creature."
      };
    }
  }

  return { success: true };
}

function previewAura(room, actor, action, deps) {
  const fromZone = ["hand", "commandZone", "exile", "graveyard"].includes(
    action?.fromZone
  )
    ? action.fromZone
    : "hand";
  const located = deps.getCardFromZone(
    actor.game,
    fromZone,
    String(action?.cardId || "")
  );

  if (!located) {
    return { success: false, error: "That card is unavailable." };
  }

  const card = located.card;
  const restriction = parseEnchant(card, deps);

  return {
    success: true,
    version: "53.0.0",
    card: deps.publicCard(card),
    fromZone,
    isAura: isAura(card, deps),
    restriction,
    candidates:
      isAura(card, deps) && restriction?.zone === "battlefield"
        ? auraTargetCandidates(room, actor.id, card, deps)
        : []
  };
}

function castAura(room, actor, action, legacyProcess, deps) {
  const fromZone = ["hand", "commandZone", "exile", "graveyard"].includes(
    action?.fromZone
  )
    ? action.fromZone
    : "hand";

  const located = deps.getCardFromZone(
    actor.game,
    fromZone,
    String(action?.cardId || "")
  );
  if (!located || !isAura(located.card, deps)) {
    return { success: false, error: "Choose an Aura in a castable zone." };
  }

  const targetKey = String(action?.targetKey || "");
  if (
    !auraTargetLegal(
      room,
      actor.id,
      located.card,
      targetKey,
      deps
    )
  ) {
    return { success: false, error: "Choose a legal Aura target." };
  }

  located.card.specialState = located.card.specialState || {};
  located.card.specialState.pendingAuraTargetV53 = targetKey;
  located.card.specialState.auraCastV53 = true;

  const result = legacyProcess(room, actor, {
    ...action,
    type: "auto-cast-card",
    fromZone,
    cardId: located.card.id,
    targets: [targetKey]
  });

  if (!result?.success) {
    delete located.card.specialState.pendingAuraTargetV53;
    delete located.card.specialState.auraCastV53;
  }

  return result;
}

function stateForViewer(room, viewerId, deps) {
  const player = deps.findPlayer(room, viewerId);
  if (!player?.game) {
    return {
      success: true,
      version: "53.0.0",
      attachments: [],
      vehicles: [],
      mounts: [],
      attached: []
    };
  }

  const attachments = player.game.battlefield
    .filter(
      (card) =>
        isEquipment(card, deps) ||
        isFortification(card, deps) ||
        Boolean(parseReconfigure(card, deps))
    )
    .map((card) => {
      const equip = parseEquip(card, deps);
      const fortify = parseFortify(card, deps);
      const reconfigure = parseReconfigure(card, deps);

      let mode = "equip";
      let parsed = equip;

      if (fortify) {
        mode = "fortify";
        parsed = fortify;
      }
      if (reconfigure) {
        mode = "reconfigure";
        parsed = reconfigure;
      }

      const candidates = player.game.battlefield
        .filter((target) =>
          activationTargetLegal(
            room,
            player.id,
            card,
            target,
            mode,
            deps
          )
        )
        .map(deps.publicCard);

      return {
        card: deps.publicCard(card),
        mode,
        manaCost: parsed?.manaCost || "",
        qualifier: parsed?.qualifier || "",
        attachedToId: card.attachedToId || null,
        target: attachedTarget(room, card, deps)?.card
          ? deps.publicCard(attachedTarget(room, card, deps).card)
          : null,
        candidates,
        canDetach:
          mode === "reconfigure" && Boolean(card.attachedToId)
      };
    });

  const crewCandidates = player.game.battlefield
    .filter(
      (card) =>
        deps.isCreatureCard(card) &&
        !card.tapped &&
        !card.phasedOut &&
        (!isVehicle(card, deps) || card.specialState?.crewedV53)
    )
    .map((card) => ({
      card: deps.publicCard(card),
      power: Math.max(
        0,
        Number(deps.effectiveStats(card)?.power) || 0
      )
    }));

  return {
    success: true,
    version: "53.0.0",
    phase: deps.PHASES[room.turn?.phaseIndex || 0] || "",
    activePlayerId: room.turn?.activePlayerId || null,
    attachments,
    vehicles: player.game.battlefield
      .filter((card) => isVehicle(card, deps))
      .map((card) => ({
        card: deps.publicCard(card),
        crew: parseCrew(card, deps),
        crewed: Boolean(card.specialState?.crewedV53),
        candidates: crewCandidates.filter(
          (entry) => entry.card.id !== card.id
        )
      })),
    mounts: player.game.battlefield
      .filter((card) => isMount(card, deps) && parseSaddle(card, deps))
      .map((card) => ({
        card: deps.publicCard(card),
        saddle: parseSaddle(card, deps),
        saddled: Boolean(card.specialState?.saddledV53),
        candidates: crewCandidates.filter(
          (entry) => entry.card.id !== card.id
        )
      })),
    attached: room.players.flatMap((controller) =>
      (controller.game?.battlefield || [])
        .filter((card) => card.attachedToId)
        .map((card) => ({
          card: deps.publicCard(card),
          controllerId: controller.id,
          controllerName: controller.name,
          attachedToId: card.attachedToId,
          targetName:
            attachedTarget(room, card, deps)?.card?.name ||
            attachedTarget(room, card, deps)?.player?.name ||
            "Unknown"
        }))
    )
  };
}

function pendingForViewer(room, viewerId, deps) {
  const choice = normalizeState(room).choices.find(
    (entry) =>
      entry.status === "open" &&
      (entry.playerId === viewerId || room.hostId === viewerId)
  );

  if (!choice) {
    return { success: true, version: "53.0.0", choice: null };
  }

  const aura = deps.findBattlefieldCard(room, choice.sourceCardId)?.card;
  const candidates = aura
    ? auraTargetCandidates(room, aura.controllerId, aura, deps)
        .filter((entry) => choice.candidateKeys.includes(entry.targetKey))
    : [];

  return {
    success: true,
    version: "53.0.0",
    choice: {
      ...choice,
      candidates
    }
  };
}

function processGameAction(room, actor, action, legacyProcess, deps) {
  const type = String(action?.type || "");
  const state = normalizeState(room);

  if (type === "attachments-v53-resolve-aura") {
    return resolveAuraChoice(room, actor, action, deps);
  }
  if (type === "attachments-v53-cast-aura") {
    return castAura(room, actor, action, legacyProcess, deps);
  }
  if (type === "attachments-v53-activate") {
    return activateAttachment(room, actor, action, deps);
  }
  if (type === "attachments-v53-crew") {
    return activateCrewOrSaddle(room, actor, action, "crew", deps);
  }
  if (type === "attachments-v53-saddle") {
    return activateCrewOrSaddle(room, actor, action, "saddle", deps);
  }

  if (
    state.choices.length &&
    !["judge-action", "undo-last", "check-state-based"].includes(type)
  ) {
    const waiting = deps.findPlayer(room, state.choices[0].playerId);
    return {
      success: false,
      error: `${waiting?.name || "A player"} must choose what an Aura enters attached to.`
    };
  }

  const creatureValidation = validateLegacyCreatureUse(
    room,
    action,
    deps
  );
  if (!creatureValidation.success) return creatureValidation;

  const beforeIds = room.players.flatMap((player) =>
    (player.game?.battlefield || []).map((card) => card.id)
  );
  const previousTurn = Number(room.turn?.number) || 0;

  const result = legacyProcess(room, actor, action);
  if (!result?.success) return result;

  initializeNewPermanents(room, beforeIds, deps);
  enforceAttachmentState(room, deps);
  applyAttachmentEffects(room, deps);

  if (previousTurn !== Number(room.turn?.number || 0)) {
    cleanupTurnEffects(room, deps);
  }
  if (type === "next-phase") cleanupAtEndStep(room, deps);

  pruneStackMeta(room);
  return result;
}

function afterResolve(room, item, beforeIds, deps) {
  initializeNewPermanents(room, beforeIds, deps);
  resolveStackMeta(room, item, deps);
  enforceAttachmentState(room, deps);
  applyAttachmentEffects(room, deps);
  deps.runStateBasedActions(room, "attachments-v53");
}

function summary(room) {
  const state = normalizeState(room);
  return {
    version: "53.0.0",
    pendingAuraChoices: state.choices.length,
    pendingAttachmentAbilities: Object.keys(state.stackMeta).length,
    attachedPermanentCount: room.players.reduce(
      (sum, player) =>
        sum +
        (player.game?.battlefield || []).filter(
          (card) => card.attachedToId
        ).length,
      0
    )
  };
}

function createAttachmentRulesEngine(deps) {
  return {
    version: "53.0.0",

    preview(room, actor, action) {
      return previewAura(room, actor, action, deps);
    },

    processGameAction(room, actor, action, legacyProcess) {
      return processGameAction(room, actor, action, legacyProcess, deps);
    },

    beforeResolve(room) {
      return room.players.flatMap((player) =>
        (player.game?.battlefield || []).map((card) => card.id)
      );
    },

    afterResolve(room, item, beforeIds) {
      return afterResolve(room, item, beforeIds, deps);
    },

    state(room, viewerId) {
      return stateForViewer(room, viewerId, deps);
    },

    pending(room, viewerId) {
      return pendingForViewer(room, viewerId, deps);
    },

    summary(room) {
      return summary(room);
    },

    status() {
      return {
        success: true,
        version: "53.0.0",
        automatic: [
          "Aura spell target selection",
          "Aura enter-attached choices",
          "Aura enchant legality checks",
          "unattached and illegal Aura state handling",
          "Equipment activation and legal creature targets",
          "qualified Equip targets such as legendary creatures and commanders",
          "Fortification activation and legal land targets",
          "Reconfigure attach and unattach activation",
          "reconfigured Equipment stopping and resuming being a creature",
          "attachment power and toughness modifiers",
          "attachment keyword grants",
          "automatic detachment when an Equipment or Fortification target becomes illegal",
          "Crew power validation and tapping as an activation cost",
          "Vehicle artifact-creature status until end of turn",
          "Saddle power validation and sorcery timing",
          "saddled-until-end-of-turn tracking",
          "Vehicle attack, block and fight enforcement",
          "server-side attachment cleanup after zone changes"
        ],
        assisted: [
          "Auras enchanting cards in graveyards, exile, hands, libraries, or the stack",
          "Bestow",
          "Living Weapon and For Mirrodin token creation",
          "Equip and Fortify costs with nonmana actions",
          "continuous effects that change attachment restrictions",
          "control-changing and copy-layer attachment corner cases",
          "Crew and Saddle abilities granted by other cards",
          "multiple dynamic power values such as star power",
          "card-specific attached triggered abilities"
        ]
      };
    }
  };
}

module.exports = {
  createAttachmentRulesEngine,
  _test: {
    isAura,
    isEquipment,
    isFortification,
    isVehicle,
    isMount,
    parseEquip,
    parseFortify,
    parseReconfigure,
    parseCrew,
    parseSaddle,
    parseEnchant,
    parseAttachmentEffects,
    parseManaRequirement,
    auraTargetLegal,
    auraTargetCandidates,
    equipmentQualifierLegal,
    activationTargetLegal,
    attachCard,
    detachAttachment,
    applyAttachmentEffects,
    enforceAttachmentState,
    setVehicleCreatureType,
    setReconfiguredType,
    totalSelectedPower,
    resolveStackMeta,
    cleanupAtEndStep,
    validateLegacyCreatureUse
  }
};
