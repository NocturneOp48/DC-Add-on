/**
 * DC Add-on Popup
 *
 * Toggles (dView, autoRefresh) → chrome.storage.local
 * Actions (block, rPick) → chrome.tabs.sendMessage to active tab
 */

const toggleDView = document.getElementById("toggle-dview");
const toggleAutoRefresh = document.getElementById("toggle-autorefresh");
const refreshInterval = document.getElementById("refresh-interval");
const dviewHint = document.getElementById("dview-hint");
const actionBtns = document.querySelectorAll(".popup-action");

function updateDviewHint() {
  dviewHint.classList.toggle("visible", toggleDView.checked);
}

// Load saved state
chrome.storage.local.get(["dViewMode", "autoRefreshMode", "refreshInterval"], (data) => {
  toggleDView.checked = !!data.dViewMode;
  toggleAutoRefresh.checked = !!data.autoRefreshMode;
  if (data.refreshInterval) refreshInterval.value = String(data.refreshInterval);
  updateDviewHint();
});

// Disable actions if not on DC Inside
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  const url = tabs[0]?.url || "";
  const isDC = url.includes("gall.dcinside.com");
  for (const btn of actionBtns) {
    btn.disabled = !isDC;
    if (!isDC) btn.classList.add("disabled");
  }
});

// Toggle handlers
toggleDView.addEventListener("change", () => {
  chrome.storage.local.set({ dViewMode: toggleDView.checked });
  updateDviewHint();
});

toggleAutoRefresh.addEventListener("change", () => {
  chrome.storage.local.set({ autoRefreshMode: toggleAutoRefresh.checked });
});

refreshInterval.addEventListener("change", () => {
  chrome.storage.local.set({ refreshInterval: Number(refreshInterval.value) });
});

// Action buttons → send message to content script
function sendAction(action) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]?.id) {
      chrome.tabs.sendMessage(tabs[0].id, { action }, () => {
        if (chrome.runtime.lastError) {
          console.warn("[dc add-on]", chrome.runtime.lastError.message);
        }
      });
      window.close();
    }
  });
}

document.getElementById("btn-block").addEventListener("click", () => sendAction("edit"));
document.getElementById("btn-rpick").addEventListener("click", () => sendAction("rPick"));
