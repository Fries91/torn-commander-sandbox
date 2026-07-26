export class RulesError extends Error {
  constructor(message, code = "RULES_ERROR", details = {}) {
    super(message);
    this.name = "RulesError";
    this.code = code;
    this.details = details;
  }
}

export function assertRule(condition, message, code = "ILLEGAL_ACTION", details = {}) {
  if (!condition) throw new RulesError(message, code, details);
}
