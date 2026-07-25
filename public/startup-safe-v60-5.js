(() => {
  "use strict";

  const SESSION_KEY = "tornCommander.session.v5";
  const SPECTATOR_KEY = "tornCommander.spectator.v20";
  const BACKUP_KEY = "arenaCommander.savedRoom.v60.5";
  const RESUME_PARAMETER = "resumeRoom";

  const parameters = new URLSearchParams(location.search);
  const resumeRequested = parameters.get(RESUME_PARAMETER) === "1";

  function storeBackup(value) {
    if (!value) return;
    try {
      sessionStorage.setItem(BACKUP_KEY, value);
    } catch {}
  }

  function pauseAutomaticRejoin() {
    try {
      const current = localStorage.getItem(SESSION_KEY);
      if (current) storeBackup(current);

      localStorage.removeItem(SESSION_KEY);
      localStorage.removeItem(SPECTATOR_KEY);
    } catch {}
  }

  function clearOldPendingFlags() {
    try {
      for (const key of [
        "arenaCommander.pendingMetaMatch.v60.3",
        "arenaCommander.pendingMetaMatch.v60.4"
      ]) {
        sessionStorage.removeItem(key);
      }
    } catch {}
  }

  if (!resumeRequested) {
    pauseAutomaticRejoin();
  } else {
    parameters.delete(RESUME_PARAMETER);

    const cleanQuery = parameters.toString();
    const cleanUrl =
      location.pathname +
      (cleanQuery ? `?${cleanQuery}` : "") +
      location.hash;

    try {
      history.replaceState(null, "", cleanUrl);
    } catch {}
  }

  clearOldPendingFlags();

  window.ArenaCommanderSafeStartV605 = {
    version: "60.5.0",
    sessionKey: SESSION_KEY,
    backupKey: BACKUP_KEY
  };
})();
