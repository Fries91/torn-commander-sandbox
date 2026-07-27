import { assertRule } from "./errors.mjs";

export class MechanicsRegistry {
  #handlers = new Map();

  register(name, handler, { overwrite = false } = {}) {
    const key = normalize(name);
    assertRule(key, "Mechanic name is required.");
    assertRule(typeof handler === "function", "Mechanic handler must be a function.");
    assertRule(overwrite || !this.#handlers.has(key), `Mechanic already registered: ${name}`);
    this.#handlers.set(key, handler);
    return this;
  }

  has(name) {
    return this.#handlers.has(normalize(name));
  }

  list() {
    return [...this.#handlers.keys()].sort();
  }

  async execute(name, context, parameters = {}) {
    const key = normalize(name);
    const handler = this.#handlers.get(key);
    assertRule(handler, `Unsupported mechanic: ${name}`, "UNSUPPORTED_MECHANIC", { name });
    return handler(context, structuredClone(parameters));
  }
}

function normalize(value) {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}
