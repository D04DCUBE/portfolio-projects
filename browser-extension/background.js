// Service worker: no DOM, and Chrome stops it when idle.
// So no state lives in variables. Everything goes in chrome.storage.session.
// One key per tab AND frame (tab_<tabId>_<frameId>), so two frames never overwrite each other.

const COLORS = { high: "#c62828", warn: "#d4a017", info: "#607d8b", ok: "#2e7d32" };
const RANK = { high: 3, warn: 2, info: 1 };

async function framesOf(tabId) {
  const all = await chrome.storage.session.get(null);
  const prefix = "tab_" + tabId + "_";
  return Object.entries(all).filter(([k]) => k.startsWith(prefix)).map(([, v]) => v);
}

async function updateBadge(tabId) {
  const frames = await framesOf(tabId);
  const hasPassword = frames.some((f) => f.hasPassword);
  const findings = new Map();
  frames.forEach((f) => f.findings.forEach((x) => findings.set(x.id, x)));

  if (!hasPassword) {
    chrome.action.setBadgeText({ tabId, text: "" });
    return;
  }
  if (findings.size === 0) {
    chrome.action.setBadgeText({ tabId, text: "OK" });
    chrome.action.setBadgeBackgroundColor({ tabId, color: COLORS.ok });
    return;
  }
  const worst = [...findings.values()].reduce((a, b) => (RANK[b.severity] > RANK[a] ? b.severity : a), "info");
  chrome.action.setBadgeText({ tabId, text: String(findings.size) });
  chrome.action.setBadgeBackgroundColor({ tabId, color: COLORS[worst] });
}

async function clearTab(tabId) {
  const all = await chrome.storage.session.get(null);
  const prefix = "tab_" + tabId + "_";
  const keys = Object.keys(all).filter((k) => k.startsWith(prefix));
  if (keys.length) await chrome.storage.session.remove(keys);
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type !== "FINDINGS" || !sender.tab) return;
  const key = "tab_" + sender.tab.id + "_" + (sender.frameId ?? 0);
  chrome.storage.session
    .set({ [key]: { hasPassword: msg.hasPassword, findings: msg.findings } })
    .then(() => updateBadge(sender.tab.id));
});

// A new page load in a tab: forget the old results.
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === "loading") {
    clearTab(tabId).then(() => chrome.action.setBadgeText({ tabId, text: "" }));
  }
});
chrome.tabs.onRemoved.addListener((tabId) => clearTab(tabId));
