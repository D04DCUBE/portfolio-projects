// Popup: reads the findings for the active tab from session storage and shows them.
// Uses textContent (never innerHTML) so page-derived text can't inject markup.
const statusEl = document.getElementById("status");
const listEl = document.getElementById("list");
const toggle = document.getElementById("toggle");

const RANK = { high: 3, warn: 2, info: 1 };
const LABEL = { high: "High risk", warn: "Warning", info: "Note" };

async function render() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  const all = await chrome.storage.session.get(null);
  const prefix = "tab_" + tab.id + "_";
  const frames = Object.entries(all).filter(([k]) => k.startsWith(prefix)).map(([, v]) => v);

  if (!frames.some((f) => f.hasPassword)) {
    statusEl.textContent = "No password fields on this page.";
    return;
  }
  const findings = new Map();
  frames.forEach((f) => f.findings.forEach((x) => findings.set(x.id, x)));

  if (findings.size === 0) {
    statusEl.textContent = "No issues found in the sign-in setup.";
    return;
  }
  statusEl.textContent = findings.size + (findings.size === 1 ? " thing to look at" : " things to look at");
  [...findings.values()]
    .sort((a, b) => RANK[b.severity] - RANK[a.severity])
    .forEach((f) => {
      const li = document.createElement("li");
      li.className = f.severity;
      const tag = document.createElement("b");
      tag.textContent = LABEL[f.severity];
      const text = document.createElement("span");
      text.textContent = f.text;
      li.append(tag, text);
      listEl.append(li);
    });
}

chrome.storage.sync.get({ highlight: true }, (s) => (toggle.checked = s.highlight));
toggle.addEventListener("change", () => chrome.storage.sync.set({ highlight: toggle.checked }));
render();
