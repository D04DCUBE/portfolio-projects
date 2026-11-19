// Content script: runs inside every page and frame (isolated world).
//
// PRIVACY RULE: this file only looks at page STRUCTURE (attributes, form targets,
// the address). It never reads .value of any field, never listens to keystrokes,
// and never makes a network request. Keep it that way.

const SEVERITY_RANK = { high: 3, warn: 2, info: 1 };
const COLORS = { high: "#c62828", warn: "#d4a017", info: "#607d8b" };
const MARK = "data-sis-flag";

let highlightOn = true;
let lastSent = "";

function hasAccessibleName(el) {
  // A placeholder is NOT a label. Screen readers need a real one.
  return (
    (el.labels && el.labels.length > 0) ||
    !!el.getAttribute("aria-label") ||
    !!el.getAttribute("aria-labelledby")
  );
}

function topIsCrossOrigin() {
  if (window === window.top) return false;
  try {
    void window.top.location.href; // throws if the top page is another origin
    return false;
  } catch {
    return true;
  }
}

function runChecks() {
  const passwordFields = [...document.querySelectorAll('input[type="password"]')];
  const found = new Map(); // id -> finding (so the same issue is reported once)
  const flagged = new Map(); // element -> worst severity

  if (passwordFields.length === 0) return { hasPassword: false, findings: [], flagged };

  const add = (severity, id, text, el) => {
    if (!found.has(id)) found.set(id, { severity, id, text });
    if (el) {
      const prev = flagged.get(el);
      if (!prev || SEVERITY_RANK[severity] > SEVERITY_RANK[prev]) flagged.set(el, severity);
    }
  };

  // Page-level checks
  if (!window.isSecureContext) {
    add("high", "insecure-page", "This page is not served over HTTPS. A password typed here can be read on the network.");
  }
  if (location.hostname.split(".").some((part) => part.startsWith("xn--"))) {
    add("high", "punycode", "The domain uses punycode (xn--). Lookalike characters can disguise a fake site.");
  }
  if (topIsCrossOrigin()) {
    add("info", "third-party-frame", "A password field sits inside a frame from another site. Sometimes legitimate, so check who owns it.");
  }

  // Field-level checks
  for (const el of passwordFields) {
    const form = el.form;
    if (form) {
      const method = (form.getAttribute("method") || "").toLowerCase();
      if (method === "get") {
        add("high", "get-method", "The form submits with GET, so the password would end up in the web address.", el);
      }
      try {
        const target = new URL(form.getAttribute("action") || location.href, location.href);
        if (target.protocol === "http:" && location.protocol === "https:") {
          add("high", "insecure-action", "The form sends the password to an insecure (http) address.", el);
        } else if (target.origin !== location.origin) {
          add("warn", "cross-origin-action", "The form submits to a different site: " + target.host + ".", el);
        }
      } catch {
        /* unparseable action: ignore */
      }
    }
    if ((el.getAttribute("autocomplete") || "").toLowerCase() === "off") {
      add("info", "autocomplete-off", 'autocomplete="off" on a password field. Use "current-password" or "new-password" so password managers work.', el);
    }
    if (!hasAccessibleName(el)) {
      add("warn", "no-label", "The password field has no label. A placeholder alone is not read reliably by screen readers.", el);
    }
  }

  return { hasPassword: true, findings: [...found.values()], flagged };
}

function applyHighlights(flagged) {
  document.querySelectorAll("[" + MARK + "]").forEach((el) => {
    el.removeAttribute(MARK);
    el.style.outline = "";
    el.style.outlineOffset = "";
  });
  if (!highlightOn) return;
  flagged.forEach((severity, el) => {
    el.setAttribute(MARK, severity);
    el.style.outline = "2px solid " + COLORS[severity];
    el.style.outlineOffset = "2px";
  });
}

function scan() {
  const { hasPassword, findings, flagged } = runChecks();
  applyHighlights(flagged);

  // Only message the service worker when something changed.
  const payload = JSON.stringify({ hasPassword, findings });
  if (payload === lastSent) return;
  lastSent = payload;
  chrome.runtime.sendMessage({ type: "FINDINGS", hasPassword, findings });
}

// Pages change after load (React, Angular...). Re-scan on DOM changes, debounced.
let timer;
new MutationObserver(() => {
  clearTimeout(timer);
  timer = setTimeout(scan, 300);
}).observe(document.documentElement, { childList: true, subtree: true });

// The popup toggles highlighting through storage.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.highlight) {
    highlightOn = changes.highlight.newValue !== false;
    scan();
  }
});

chrome.storage.sync.get({ highlight: true }, (s) => {
  highlightOn = s.highlight;
  scan();
});
