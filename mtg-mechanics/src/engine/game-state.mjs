import { EventBus } from "./event-bus.mjs";
import { MechanicsRegistry } from "./mechanics-registry.mjs";
import { RulesError, assertRule } from "./errors.mjs";
import { COMMANDER_RULES, recordCommanderDamage } from "./commander.mjs";

const TURN_SEQUENCE = Object.freeze([
  "untap",
  "upkeep",
  "draw",
  "precombat_main",
  "begin_combat",
  "declare_attackers",
  "declare_blockers",
  "combat_damage",
  "end_combat",
  "postcombat_main",
  "end",
  "cleanup"
]);

const PUBLIC_ZONES = new Set(["battlefield", "graveyard", "stack", "exile", "command"]);

export class GameState {
  constructor({ players, format = "commander", startingPlayerId, random = Math.random } = {}) {
    assertRule(Array.isArray(players) && players.length >= 2, "At least two players are required.");
    assertRule(players.length <= 10, "This starter supports no more than ten players.");
    this.id = crypto.randomUUID();
    this.format = format;
    this.random = random;
    this.events = new EventBus();
    this.mechanics = new MechanicsRegistry();
    this.players = new Map();
    this.objects = new Map();
    this.stack = [];
    this.triggerQueue = [];
    this.pendingChoices = new Map();
    this.log = [];
    this.commanderDamage = new Map();
    this.revision = 0;
    this.turnNumber = 1;
    this.stepIndex = 0;
    this.activePlayerId = startingPlayerId ?? players[0].id;
    this.priorityPlayerId = this.activePlayerId;
    this.consecutivePasses = 0;
    this.gameOver = false;
    this.winners = [];
    this.losers = [];

    for (const player of players) {
      assertRule(player?.id, "Each player requires an id.");
      assertRule(!this.players.has(player.id), `Duplicate player id: ${player.id}`);
      this.players.set(player.id, {
        id: player.id,
        name: player.name ?? player.id,
        life: player.life ?? (format === "commander" ? COMMANDER_RULES.startingLife : 20),
        poison: 0,
        manaPool: {},
        hasLost: false,
        zones: {
          library: [],
          hand: [],
          battlefield: [],
          graveyard: [],
          exile: [],
          command: []
        }
      });
    }
    assertRule(this.players.has(this.activePlayerId), "Starting player is not in the game.");
  }

  get currentStep() {
    return TURN_SEQUENCE[this.stepIndex];
  }

  get livingPlayers() {
    return [...this.players.values()].filter((player) => !player.hasLost);
  }

  createCardInstance(definition, { ownerId, controllerId = ownerId, zone = "library", token = false, conjured = false } = {}) {
    assertRule(this.players.has(ownerId), "Card owner must be a player.");
    const id = crypto.randomUUID();
    const object = {
      id,
      lineageId: crypto.randomUUID(),
      definitionId: definition.id ?? definition.oracle_id ?? definition.name,
      name: definition.name,
      ownerId,
      controllerId,
      zone,
      token,
      conjured,
      tapped: false,
      counters: {},
      damageMarked: 0,
      base: structuredClone(definition),
      perpetualModifiers: [],
      temporaryModifiers: [],
      abilitiesRemoved: [],
      metadata: {}
    };
    this.objects.set(id, object);
    this.#zoneArray(ownerId, zone).push(id);
    this.#touch("CARD_INSTANCE_CREATED", { objectId: id, ownerId, zone, token, conjured });
    return object;
  }

  async commitEvent(event, { checkState = true } = {}) {
    assertRule(event?.type, "Every event requires a type.");
    const context = { game: this };
    let next = this.events.applyReplacements(event, context);
    if (next === null) return null;
    next = this.events.applyPrevention(next, context);
    if (next === null) return null;

    const committed = {
      id: crypto.randomUUID(),
      atRevision: this.revision + 1,
      timestamp: new Date().toISOString(),
      ...structuredClone(next)
    };
    this.log.push(committed);
    this.revision += 1;
    await this.events.emitCommitted(committed, context);
    if (checkState) await this.checkStateBasedActions();
    return committed;
  }

  async moveObject(objectId, toZone, { controllerId, position = "top", reason = "effect" } = {}) {
    const object = this.#object(objectId);
    const fromZone = object.zone;
    const oldControllerId = object.controllerId;

    const event = await this.commitEvent({
      type: "ZONE_CHANGE_ATTEMPT",
      objectId,
      fromZone,
      toZone,
      ownerId: object.ownerId,
      controllerId: controllerId ?? object.controllerId,
      reason
    }, { checkState: false });
    if (!event) return null;

    this.#removeFromAllZones(objectId);
    object.zone = event.toZone;
    object.controllerId = controllerId ?? (event.toZone === "battlefield" ? object.controllerId : object.ownerId);
    object.damageMarked = 0;
    object.temporaryModifiers = [];
    object.tapped = false;

    // A normal zone change creates a new object. The lineage ID remains available for
    // Arena-style perpetual tracking, while the instance ID changes.
    const oldId = object.id;
    const newId = crypto.randomUUID();
    object.id = newId;
    this.objects.delete(oldId);
    this.objects.set(newId, object);

    const zoneOwner = event.toZone === "battlefield"
      ? object.controllerId
      : object.ownerId;
    const destination = this.#zoneArray(zoneOwner, event.toZone);
    if (position === "bottom") destination.push(newId);
    else if (position === "random") destination.splice(this.#randomIndex(destination.length + 1), 0, newId);
    else destination.unshift(newId);

    await this.commitEvent({
      type: "ZONE_CHANGED",
      oldObjectId: oldId,
      objectId: newId,
      lineageId: object.lineageId,
      fromZone,
      toZone: event.toZone,
      oldControllerId,
      controllerId: object.controllerId,
      reason
    });
    return object;
  }

  async addToStack({ controllerId, sourceId = null, kind, label, resolve, targets = [], metadata = {} }) {
    assertRule(this.players.has(controllerId), "Stack controller must be a player.");
    assertRule(typeof resolve === "function", "Stack item requires a resolve function.");
    const item = {
      id: crypto.randomUUID(),
      controllerId,
      sourceId,
      kind,
      label,
      targets: structuredClone(targets),
      metadata: structuredClone(metadata),
      resolve
    };
    this.stack.push(item);
    this.consecutivePasses = 0;
    await this.commitEvent({ type: "STACK_ITEM_ADDED", stackItemId: item.id, controllerId, sourceId, kind, label });
    return item;
  }

  async passPriority(playerId) {
    assertRule(!this.gameOver, "The game is over.");
    assertRule(playerId === this.priorityPlayerId, "This player does not currently have priority.");
    this.consecutivePasses += 1;

    if (this.consecutivePasses >= this.livingPlayers.length) {
      this.consecutivePasses = 0;
      if (this.stack.length > 0) {
        await this.resolveTopOfStack();
      } else {
        await this.advanceStep();
      }
      return;
    }

    this.priorityPlayerId = this.#nextLivingPlayer(playerId).id;
    await this.commitEvent({ type: "PRIORITY_PASSED", playerId, nextPlayerId: this.priorityPlayerId });
  }

  async resolveTopOfStack() {
    const item = this.stack.pop();
    assertRule(item, "The stack is empty.");
    await this.commitEvent({ type: "STACK_ITEM_RESOLVING", stackItemId: item.id });
    try {
      await item.resolve({ game: this, item });
      await this.commitEvent({ type: "STACK_ITEM_RESOLVED", stackItemId: item.id });
    } catch (error) {
      if (error instanceof RulesError) {
        await this.commitEvent({
          type: "STACK_ITEM_FAILED",
          stackItemId: item.id,
          code: error.code,
          message: error.message
        });
      } else {
        throw error;
      }
    }
    this.priorityPlayerId = this.activePlayerId;
    await this.flushTriggers();
  }

  queueTrigger(trigger) {
    assertRule(trigger?.controllerId && typeof trigger.resolve === "function",
      "Trigger requires controllerId and resolve.");
    this.triggerQueue.push({
      id: crypto.randomUUID(),
      label: trigger.label ?? "Triggered ability",
      ...trigger
    });
  }

  async flushTriggers() {
    if (this.triggerQueue.length === 0) return;
    const orderedPlayers = this.#turnOrderFrom(this.activePlayerId);
    const triggers = this.triggerQueue.splice(0);
    for (const player of orderedPlayers) {
      const controlled = triggers.filter((trigger) => trigger.controllerId === player.id);
      for (const trigger of controlled) {
        await this.addToStack({
          controllerId: trigger.controllerId,
          sourceId: trigger.sourceId,
          kind: "triggered_ability",
          label: trigger.label,
          targets: trigger.targets,
          resolve: trigger.resolve,
          metadata: trigger.metadata
        });
      }
    }
  }

  async advanceStep() {
    this.stepIndex += 1;
    if (this.stepIndex >= TURN_SEQUENCE.length) {
      this.stepIndex = 0;
      this.turnNumber += 1;
      this.activePlayerId = this.#nextLivingPlayer(this.activePlayerId).id;
    }
    this.priorityPlayerId = this.activePlayerId;
    this.#emptyManaPools();
    await this.commitEvent({
      type: "STEP_STARTED",
      turnNumber: this.turnNumber,
      step: this.currentStep,
      activePlayerId: this.activePlayerId
    });
  }

  async changeLife(playerId, amount, { sourceId = null, damage = false, combat = false, commanderId = null } = {}) {
    const player = this.#player(playerId);
    const event = await this.commitEvent({
      type: damage ? "DAMAGE_ATTEMPT" : "LIFE_CHANGE_ATTEMPT",
      playerId,
      amount,
      sourceId,
      combat
    });
    if (!event) return player.life;

    player.life += event.amount;
    await this.commitEvent({
      type: damage ? "DAMAGE_DEALT" : "LIFE_CHANGED",
      playerId,
      amount: event.amount,
      life: player.life,
      sourceId,
      combat
    });

    if (damage && combat && commanderId && event.amount < 0) {
      const total = recordCommanderDamage(this, {
        sourceCommanderId: commanderId,
        damagedPlayerId: playerId,
        amount: Math.abs(event.amount)
      });
      await this.commitEvent({
        type: "COMMANDER_DAMAGE_RECORDED",
        commanderId,
        playerId,
        total
      });
    }
    return player.life;
  }

  async checkStateBasedActions() {
    let changed = true;
    let guard = 0;
    while (changed) {
      changed = false;
      guard += 1;
      if (guard > 100) throw new Error("State-based-action loop exceeded safety limit.");

      for (const player of this.livingPlayers) {
        const losesToLife = player.life <= 0;
        const losesToPoison = player.poison >= 10;
        const losesToCommander = [...this.commanderDamage.entries()]
          .some(([key, amount]) => key.endsWith(`:${player.id}`) && amount >= COMMANDER_RULES.commanderDamageToLose);

        if (losesToLife || losesToPoison || losesToCommander) {
          player.hasLost = true;
          this.losers.push(player.id);
          changed = true;
          this.#touch("PLAYER_LOST", {
            playerId: player.id,
            reason: losesToLife ? "life" : losesToPoison ? "poison" : "commander_damage"
          });
        }
      }

      for (const object of [...this.objects.values()]) {
        if (object.zone !== "battlefield") continue;
        const toughness = this.getToughness(object.id);
        if (typeof toughness === "number" && (toughness <= 0 || object.damageMarked >= toughness)) {
          await this.moveObject(object.id, "graveyard", { reason: "state_based_action" });
          changed = true;
        }
      }
    }

    if (!this.gameOver && this.livingPlayers.length <= 1) {
      this.gameOver = true;
      this.winners = this.livingPlayers.map((player) => player.id);
      this.#touch("GAME_ENDED", { winners: this.winners, losers: this.losers });
    }
  }

  getPower(objectId) {
    return this.#derivedNumber(this.#object(objectId), "power");
  }

  getToughness(objectId) {
    return this.#derivedNumber(this.#object(objectId), "toughness");
  }

  addPerpetualModifier(objectId, modifier) {
    const object = this.#object(objectId);
    object.perpetualModifiers.push(structuredClone(modifier));
    this.#touch("PERPETUAL_MODIFIER_ADDED", { objectId, modifier });
  }

  sanitizeFor(playerId) {
    assertRule(this.players.has(playerId), "Unknown viewer.");
    const publicPlayers = {};
    for (const player of this.players.values()) {
      publicPlayers[player.id] = {
        id: player.id,
        name: player.name,
        life: player.life,
        poison: player.poison,
        hasLost: player.hasLost,
        libraryCount: player.zones.library.length,
        handCount: player.zones.hand.length,
        hand: player.id === playerId
          ? player.zones.hand.map((id) => this.#publicObject(this.#object(id), true))
          : [],
        battlefield: player.zones.battlefield.map((id) => this.#publicObject(this.#object(id), true)),
        graveyard: player.zones.graveyard.map((id) => this.#publicObject(this.#object(id), true)),
        exile: player.zones.exile.map((id) => this.#publicObject(this.#object(id), true)),
        command: player.zones.command.map((id) => this.#publicObject(this.#object(id), true))
      };
    }

    return {
      id: this.id,
      revision: this.revision,
      format: this.format,
      turnNumber: this.turnNumber,
      step: this.currentStep,
      activePlayerId: this.activePlayerId,
      priorityPlayerId: this.priorityPlayerId,
      stack: this.stack.map((item) => ({
        id: item.id,
        controllerId: item.controllerId,
        sourceId: item.sourceId,
        kind: item.kind,
        label: item.label,
        targets: item.targets
      })),
      players: publicPlayers,
      gameOver: this.gameOver,
      winners: this.winners
    };
  }

  #derivedNumber(object, field) {
    const base = Number.parseInt(object.base?.[field], 10);
    if (!Number.isFinite(base)) return null;
    let value = base;
    for (const modifier of [...object.perpetualModifiers, ...object.temporaryModifiers]) {
      if (modifier.type === "modify" && modifier.field === field) value += Number(modifier.amount ?? 0);
      if (modifier.type === "set" && modifier.field === field) value = Number(modifier.value);
    }
    return value;
  }

  #publicObject(object, reveal) {
    if (!reveal && !PUBLIC_ZONES.has(object.zone)) return { id: object.id, hidden: true };
    return {
      id: object.id,
      lineageId: object.lineageId,
      definitionId: object.definitionId,
      name: object.name,
      ownerId: object.ownerId,
      controllerId: object.controllerId,
      zone: object.zone,
      tapped: object.tapped,
      counters: structuredClone(object.counters),
      power: this.getPower(object.id),
      toughness: this.getToughness(object.id),
      token: object.token,
      conjured: object.conjured
    };
  }

  #removeFromAllZones(objectId) {
    for (const player of this.players.values()) {
      for (const zone of Object.values(player.zones)) {
        const index = zone.indexOf(objectId);
        if (index !== -1) zone.splice(index, 1);
      }
    }
  }

  #zoneArray(playerId, zone) {
    const player = this.#player(playerId);
    const array = player.zones[zone];
    assertRule(array, `Unsupported zone: ${zone}`);
    return array;
  }

  #player(playerId) {
    const player = this.players.get(playerId);
    assertRule(player, `Unknown player: ${playerId}`);
    return player;
  }

  #object(objectId) {
    const object = this.objects.get(objectId);
    assertRule(object, `Unknown game object: ${objectId}`);
    return object;
  }

  #nextLivingPlayer(playerId) {
    const order = [...this.players.values()];
    const currentIndex = order.findIndex((player) => player.id === playerId);
    for (let offset = 1; offset <= order.length; offset += 1) {
      const candidate = order[(currentIndex + offset) % order.length];
      if (!candidate.hasLost) return candidate;
    }
    return order[currentIndex];
  }

  #turnOrderFrom(playerId) {
    const result = [];
    let current = this.#player(playerId);
    for (let count = 0; count < this.livingPlayers.length; count += 1) {
      if (!current.hasLost) result.push(current);
      current = this.#nextLivingPlayer(current.id);
    }
    return result;
  }

  #randomIndex(length) {
    return Math.floor(this.random() * length);
  }

  #emptyManaPools() {
    for (const player of this.players.values()) player.manaPool = {};
  }

  #touch(type, details) {
    this.revision += 1;
    this.log.push({
      id: crypto.randomUUID(),
      atRevision: this.revision,
      timestamp: new Date().toISOString(),
      type,
      ...structuredClone(details)
    });
  }
}

export { TURN_SEQUENCE };
