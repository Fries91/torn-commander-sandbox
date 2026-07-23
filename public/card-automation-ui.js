(() => {
  "use strict";

  const app = document.getElementById("app");
  if (!app) return;

  const cache = new Map();
  let scanTimer = null;
  let requestRunning = false;

  function cleanName(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .replace(/\s+[×x]\d+$/, "")
      .trim()
      .slice(0, 150);
  }

  function cardNameFromElement(element) {
    const named = element.querySelector(".arena-card-name, .card-name, [data-card-name]");
    if (named) return cleanName(named.dataset.cardName || named.textContent);
    const strong = [...element.querySelectorAll("strong")].find((entry) => cleanName(entry.textContent).length > 1);
    return cleanName(strong?.textContent || element.getAttribute("aria-label") || element.title);
  }

  function badgeFor(profile) {
    const span = document.createElement("span");
    span.className = `card-automation-badge automation-${profile.level || "manual"}`;
    span.textContent = profile.level === "full" ? "AUTO" : profile.level === "assisted" ? "ASSIST" : "MANUAL";
    span.title = profile.level === "full"
      ? "This card's recognized actions can resolve automatically."
      : profile.level === "assisted"
        ? "Some choices or targets still require player confirmation."
        : "Use normal table controls or Judge Mode for this card.";
    return span;
  }

  function applyCachedBadges() {
    for (const element of app.querySelectorAll("[data-card-id]")) {
      if (element.querySelector(":scope > .card-automation-badge")) continue;
      const name = cardNameFromElement(element);
      const profile = cache.get(name.toLocaleLowerCase("en-US"));
      if (profile) element.appendChild(badgeFor(profile));
    }
    updateSummary();
  }

  function updateSummary() {
    const drawer = app.querySelector(".rules-drawer");
    if (!drawer) return;
    let panel = drawer.querySelector("[data-automation-summary]");
    if (!panel) {
      panel = document.createElement("section");
      panel.className = "drawer-section card-automation-summary";
      panel.dataset.automationSummary = "1";
      drawer.prepend(panel);
    }
    const badges = [...app.querySelectorAll(".card-automation-badge")];
    const full = badges.filter((badge) => badge.classList.contains("automation-full")).length;
    const assisted = badges.filter((badge) => badge.classList.contains("automation-assisted")).length;
    const manual = badges.filter((badge) => badge.classList.contains("automation-manual")).length;
    panel.innerHTML = `<div class="section-heading"><div><p class="eyebrow">Card Mechanics Engine v40</p><h3>Automation coverage</h3></div><span class="badge success">ACTIVE</span></div><div class="automation-summary-grid"><span><b>${full}</b> Full Auto</span><span><b>${assisted}</b> Assisted</span><span><b>${manual}</b> Manual</span></div><p class="muted">Supported triggers go onto the stack automatically. Cards needing targets or unusual choices remain assisted so the engine never guesses incorrectly.</p>`;
  }

  async function requestProfiles(names) {
    if (!names.length || requestRunning) return;
    requestRunning = true;
    try {
      const response = await fetch("/api/cards/automation/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        cache: "no-store",
        body: JSON.stringify({ names })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) return;
      for (const entry of payload.cards || []) {
        cache.set(cleanName(entry.requestedName).toLocaleLowerCase("en-US"), entry.automation);
        cache.set(cleanName(entry.cardName).toLocaleLowerCase("en-US"), entry.automation);
      }
      for (const name of payload.notFound || []) cache.set(cleanName(name).toLocaleLowerCase("en-US"), { level: "manual" });
      applyCachedBadges();
    } catch {
      // The game remains fully usable if the coverage endpoint is unavailable.
    } finally {
      requestRunning = false;
    }
  }

  function scan() {
    scanTimer = null;
    const unknown = [];
    const seen = new Set();
    for (const element of app.querySelectorAll("[data-card-id]")) {
      const name = cardNameFromElement(element);
      const key = name.toLocaleLowerCase("en-US");
      if (!name || seen.has(key)) continue;
      seen.add(key);
      if (!cache.has(key)) unknown.push(name);
    }
    applyCachedBadges();
    requestProfiles(unknown.slice(0, 100));
  }

  function queueScan() {
    if (scanTimer) return;
    scanTimer = window.setTimeout(scan, 180);
  }

  const observer = new MutationObserver(queueScan);
  observer.observe(app, { childList: true, subtree: true });
  queueScan();
})();
