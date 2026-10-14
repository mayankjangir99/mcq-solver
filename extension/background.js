// Service workers do not load popup scripts automatically. Keep the shared
// extraction helpers in one file for both the popup and command handler.
importScripts("solver.js");

function selectTextFromRectangle() {
  return new Promise((resolve, reject) => {
    const overlay = document.createElement("div");
    const box = document.createElement("div");
    const guide = document.createElement("div");
    let startX = 0;
    let startY = 0;
    let dragging = false;

    Object.assign(overlay.style, {
      position: "fixed", inset: "0", zIndex: "2147483647", cursor: "crosshair",
      background: "rgba(25, 45, 110, .10)"
    });
    Object.assign(box.style, {
      position: "fixed", border: "2px solid #2638d9", background: "rgba(38, 56, 217, .12)",
      display: "none", pointerEvents: "none"
    });
    Object.assign(guide.style, {
      position: "fixed", top: "16px", left: "50%", transform: "translateX(-50%)",
      padding: "10px 14px", borderRadius: "8px", background: "#172033", color: "white",
      font: "600 14px system-ui", pointerEvents: "none", whiteSpace: "nowrap"
    });
    guide.textContent = "Drag a border around the question and options (Esc to cancel)";
    overlay.append(box, guide);
    document.documentElement.appendChild(overlay);

    const cleanup = () => {
      document.removeEventListener("keydown", onKeyDown, true);
      overlay.remove();
    };
    const rectangle = (x, y) => ({
      left: Math.min(startX, x), top: Math.min(startY, y),
      right: Math.max(startX, x), bottom: Math.max(startY, y)
    });
    const intersects = (a, b) => a.right > b.left && a.left < b.right && a.bottom > b.top && a.top < b.bottom;
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        cleanup();
        reject(new Error("Area selection cancelled."));
      }
    };
    document.addEventListener("keydown", onKeyDown, true);

    overlay.addEventListener("pointerdown", (event) => {
      dragging = true;
      startX = event.clientX;
      startY = event.clientY;
      box.style.display = "block";
      event.preventDefault();
    });
    overlay.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      const rect = rectangle(event.clientX, event.clientY);
      Object.assign(box.style, {
        left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.right - rect.left}px`, height: `${rect.bottom - rect.top}px`
      });
    });
    overlay.addEventListener("pointerup", (event) => {
      if (!dragging) return;
      dragging = false;
      const selected = rectangle(event.clientX, event.clientY);
      cleanup();
      if (selected.right - selected.left < 12 || selected.bottom - selected.top < 12) {
        reject(new Error("Select a larger area containing the question and options."));
        return;
      }

      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const texts = [];
      let node;
      while ((node = walker.nextNode())) {
        const value = node.nodeValue.replace(/\s+/g, " ").trim();
        const parent = node.parentElement;
        if (!value || !parent || getComputedStyle(parent).visibility === "hidden" || getComputedStyle(parent).display === "none") continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        if ([...range.getClientRects()].some((rect) => intersects(rect, selected))) texts.push(value);
      }
      resolve(texts.join(" ").replace(/\s+/g, " ").trim().slice(0, 8000));
    });
  });
}

async function solveRegionText({ tabId, backendUrl }) {
  await chrome.storage.session.set({ regionSolveResult: null, regionSolveError: "" });
  try {
    const [selection] = await chrome.scripting.executeScript({
      target: { tabId },
      func: selectTextFromRectangle
    });
    const questionText = selection?.result || "";
    if (!questionText) throw new Error("No readable text was found inside that area.");

    const response = await fetch(`${backendUrl.replace(/\/+$/, "")}/api/solve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ questionText })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Server error (${response.status})`);
    if (!payload.answer) throw new Error("The AI could not identify a clear answer from the selected area.");
    await chrome.storage.session.set({ regionSolveResult: payload, regionSolveError: "" });
  } catch (error) {
    await chrome.storage.session.set({ regionSolveResult: null, regionSolveError: error?.message || "Area scan failed." });
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "solve-region-text") return;
  solveRegionText(message);
  sendResponse({ started: true });
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "run-solver") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    await chrome.storage.session.set({ solverResult: null, solverError: "Could not find the active tab." });
    return;
  }
  await solveVisibleQuestion(tab.id);
});
