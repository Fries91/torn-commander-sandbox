import { assertRule } from "./errors.mjs";

export function registerDefaultMechanics(game) {
  game.mechanics
    .register("draw", async ({ game: current, playerId }, { count = 1 } = {}) => {
      const player = current.players.get(playerId);
      assertRule(player, "Unknown player.");
      for (let i = 0; i < count; i += 1) {
        const topId = player.zones.library[0];
        assertRule(topId, `${player.name} cannot draw from an empty library.`, "DRAW_FROM_EMPTY_LIBRARY");
        await current.moveObject(topId, "hand", { reason: "draw" });
      }
    })
    .register("destroy", async ({ game: current }, { objectId }) => {
      const object = current.objects.get(objectId);
      assertRule(object?.zone === "battlefield", "Destroy requires a permanent on the battlefield.");
      await current.moveObject(objectId, "graveyard", { reason: "destroy" });
    })
    .register("sacrifice", async ({ game: current, playerId }, { objectId }) => {
      const object = current.objects.get(objectId);
      assertRule(object?.zone === "battlefield" && object.controllerId === playerId,
        "A player can sacrifice only a permanent they control.");
      await current.moveObject(objectId, "graveyard", { reason: "sacrifice" });
    })
    .register("tap", async ({ game: current }, { objectId }) => {
      const object = current.objects.get(objectId);
      assertRule(object?.zone === "battlefield", "Only a permanent can be tapped.");
      object.tapped = true;
      await current.commitEvent({ type: "PERMANENT_TAPPED", objectId });
    })
    .register("untap", async ({ game: current }, { objectId }) => {
      const object = current.objects.get(objectId);
      assertRule(object?.zone === "battlefield", "Only a permanent can be untapped.");
      object.tapped = false;
      await current.commitEvent({ type: "PERMANENT_UNTAPPED", objectId });
    })
    .register("conjure", async ({ game: current, playerId }, { definition, zone = "hand" }) => {
      const object = current.createCardInstance(definition, {
        ownerId: playerId,
        controllerId: playerId,
        zone,
        conjured: true
      });
      await current.commitEvent({ type: "CARD_CONJURED", objectId: object.id, playerId, zone });
      return object;
    })
    .register("perpetual", async ({ game: current }, { objectId, modifier }) => {
      current.addPerpetualModifier(objectId, modifier);
      await current.commitEvent({ type: "PERPETUAL_APPLIED", objectId, modifier });
    })
    .register("seek", async ({ game: current, playerId }, { predicate, destination = "hand" }) => {
      assertRule(typeof predicate === "function", "Seek requires a predicate function.");
      const player = current.players.get(playerId);
      const matches = player.zones.library.filter((id) => predicate(current.objects.get(id)?.base));
      assertRule(matches.length > 0, "No card in the library matches the seek condition.", "SEEK_FAILED");
      const selected = matches[Math.floor(current.random() * matches.length)];
      return current.moveObject(selected, destination, { reason: "seek" });
    });

  return game;
}
