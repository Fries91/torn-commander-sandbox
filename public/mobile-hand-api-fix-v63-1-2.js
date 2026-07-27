(() => {
  "use strict";

  const VERSION = "63.1.2";
  const STATUS_URL = "/api/hidden-v59/status";
  let hiddenApiReady = null;
  let checkPromise = null;

  function toast(message, type = "warning") {
    const region = document.getElementById("toastRegion");
    if (!region) return;
    const item = document.createElement("div");
    item.className = `toast ${type}`;
    item.textContent = message;
    region.appendChild(item);
    window.setTimeout(() => item.remove(), 4800);
  }

  function updateLibraryButton() {
    const button = document.getElementById("v59HiddenButton");
    if (!button) return;
    button.classList.toggle("v6312-api-offline", hiddenApiReady === false);
    button.title = hiddenApiReady === false
      ? "Library tools are waiting for the server integration."
      : "Library, search, reveal and shuffle tools.";
  }

  async function checkHiddenApi(force = false) {
    if (checkPromise && !force) return checkPromise;
    checkPromise = fetch(STATUS_URL, {
      method: "GET",
      cache: "no-store",
      headers: { Accept: "application/json" }
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        hiddenApiReady = Boolean(response.ok && payload?.error !== "API route not found.");
        updateLibraryButton();
        return hiddenApiReady;
      })
      .catch(() => {
        hiddenApiReady = false;
        updateLibraryButton();
        return false;
      })
      .finally(() => {
        checkPromise = null;
      });
    return checkPromise;
  }

  function isHiddenToolControl(element) {
    return Boolean(element?.closest?.(
      "#v59HiddenButton, " +
      "#v59HiddenSheet [data-v59-shuffle-self], " +
      "#v59HiddenSheet [data-v59-reveal-hand], " +
      "#v59HiddenSheet [data-v59-create-search], " +
      "#v59HiddenSheet [data-v59-create-look], " +
      "#v59HiddenSheet [data-v59-clear-reveal]"
    ));
  }

  document.addEventListener("click", async (event) => {
    if (!isHiddenToolControl(event.target)) return;

    if (hiddenApiReady === null) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      const ready = await checkHiddenApi(true);
      if (ready) {
        document.getElementById("v59HiddenButton")?.click();
      } else {
        toast("Library tools did not load on the server. Redeploy with the updated package.json, then reopen the app.");
      }
      return;
    }

    if (hiddenApiReady === false) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      toast("Library tools did not load on the server. Redeploy with the updated package.json, then reopen the app.");
    }
  }, true);

  const observer = new MutationObserver(() => updateLibraryButton());
  const root = document.getElementById("app") || document.body;
  observer.observe(root, { childList: true, subtree: true });

  window.addEventListener("pageshow", () => checkHiddenApi(true));
  window.addEventListener("online", () => checkHiddenApi(true));
  checkHiddenApi();

  window.ArenaCommanderHandLibraryFix = Object.freeze({
    version: VERSION,
    checkHiddenApi
  });
})();
