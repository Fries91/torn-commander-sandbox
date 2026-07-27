import { assertRule } from "./errors.mjs";

export class EventBus {
  #listeners = new Map();
  #replacements = [];
  #preventions = [];

  on(type, listener, { once = false, priority = 0 } = {}) {
    assertRule(typeof listener === "function", "Event listener must be a function.");
    const list = this.#listeners.get(type) ?? [];
    const entry = { listener, once, priority };
    list.push(entry);
    list.sort((a, b) => b.priority - a.priority);
    this.#listeners.set(type, list);
    return () => this.off(type, listener);
  }

  off(type, listener) {
    const list = this.#listeners.get(type) ?? [];
    this.#listeners.set(type, list.filter((entry) => entry.listener !== listener));
  }

  addReplacement(test, replace, { priority = 0, id = crypto.randomUUID() } = {}) {
    const entry = { id, test, replace, priority };
    this.#replacements.push(entry);
    this.#replacements.sort((a, b) => b.priority - a.priority);
    return () => {
      this.#replacements = this.#replacements.filter((item) => item.id !== id);
    };
  }

  addPrevention(test, prevent, { priority = 0, id = crypto.randomUUID() } = {}) {
    const entry = { id, test, prevent, priority };
    this.#preventions.push(entry);
    this.#preventions.sort((a, b) => b.priority - a.priority);
    return () => {
      this.#preventions = this.#preventions.filter((item) => item.id !== id);
    };
  }

  applyReplacements(event, context) {
    let current = structuredClone(event);
    const used = new Set();

    for (let guard = 0; guard < 100; guard += 1) {
      const candidate = this.#replacements.find(
        (entry) => !used.has(entry.id) && entry.test(current, context)
      );
      if (!candidate) return current;

      used.add(candidate.id);
      current = candidate.replace(current, context);
      if (current === null) return null;
    }
    throw new Error("Replacement-effect loop exceeded safety limit.");
  }

  applyPrevention(event, context) {
    let current = structuredClone(event);
    for (const entry of this.#preventions) {
      if (!entry.test(current, context)) continue;
      current = entry.prevent(current, context);
      if (current === null) return null;
    }
    return current;
  }

  async emitCommitted(event, context) {
    const exact = [...(this.#listeners.get(event.type) ?? [])];
    const wildcard = [...(this.#listeners.get("*") ?? [])];
    for (const entry of [...exact, ...wildcard]) {
      await entry.listener(event, context);
      if (entry.once) this.off(event.type, entry.listener);
    }
  }
}
