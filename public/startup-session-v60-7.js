(() => {
  "use strict";

  const VERSION = "60.7.0";
  const SESSION_KEY = "tornCommander.session.v5";
  const SPECTATOR_KEY = "tornCommander.spectator.v20";
  const BACKUP_KEY = "arenaCommander.savedRoom.v60.7";

  const parameters = new URLSearchParams(location.search);
  const explicitReset =
    parameters.get("safeStart") === "1" ||
    parameters.get("roomReset") === "1";

  function validSession(value) {
    try {
      const parsed = JSON.parse(value);
      return Boolean(
        parsed?.roomCode &&
        parsed?.playerId &&
        parsed?.sessionToken
      );
    } catch {
      return false;
    }
  }

  function backupSession(value) {
    if (!validSession(value)) return;

    try {
      sessionStorage.setItem(BACKUP_KEY, value);
    } catch {}
  }

  function resetOnlyWhenRequested() {
    if (!explicitReset) return;

    try {
      const current = localStorage.getItem(SESSION_KEY);
      backupSession(current);
      localStorage.removeItem(SESSION_KEY);
      localStorage.removeItem(SPECTATOR_KEY);
    } catch {}
  }

  function cleanTemporaryParameters() {
    let changed = false;

    for (const key of [
      "resumeRoom",
      "safeStart",
      "roomReset"
    ]) {
      if (parameters.has(key)) {
        parameters.delete(key);
        changed = true;
      }
    }

    if (!changed) return;

    const query = parameters.toString();
    const cleanUrl =
      location.pathname +
      (query ? `?${query}` : "") +
      location.hash;

    try {
      history.replaceState(null, "", cleanUrl);
    } catch {}
  }

  resetOnlyWhenRequested();
  cleanTemporaryParameters();

  window.ArenaCommanderSessionHandoffV607 = {
    version: VERSION,
    sessionKey: SESSION_KEY,
    backupKey: BACKUP_KEY,
    explicitReset
  };
})();
