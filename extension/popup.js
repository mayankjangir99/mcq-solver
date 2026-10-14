const $ = (id) => document.getElementById(id);

async function loadSettings() {
  const saved = await chrome.storage.sync.get({ backendUrl: "http://localhost:3000" });
  $("backendUrl").value = saved.backendUrl;
}
function setStatus(message, type = "") {
  const el = $("status");
  el.textContent = message;
  el.className = "status" + (type ? ` ${type}` : "");
}
$("saveUrl").addEventListener("click", async () => {
  const value = cleanBaseUrl($("backendUrl").value);
  try {
    const parsed = new URL(value);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
    await chrome.storage.sync.set({ backendUrl: value });
    setStatus("Backend URL saved.", "success");
  } catch {
    setStatus("Enter a valid http:// or https:// backend URL.", "error");
  }
});

$("scanBtn").addEventListener("click", async () => {
  $("scanBtn").disabled = true;
  $("result").classList.add("hidden");
  setStatus("Reading the visible question text...");
  try {
    const { backendUrl = "http://localhost:3000" } =
      await chrome.storage.sync.get({ backendUrl: cleanBaseUrl($("backendUrl").value) });

    const [extraction] = await chrome.scripting.executeScript({
      target: { tabId: (await chrome.tabs.query({ active: true, currentWindow: true }))[0].id },
      func: extractVisibleMcqText
    });
    const questionText = extraction?.result?.trim();
    if (!questionText) {
      setStatus("Text was not readable. Capturing the visible question image...");
    }
    const screenshot = await chrome.tabs.captureVisibleTab(null, { format: "png" });
    setStatus("Sending question text for AI analysis...");
    const response = await fetch(`${cleanBaseUrl(backendUrl)}/api/solve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ questionText, screenshot })
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Server error (${response.status})`);
    if (!payload.answer) throw new Error("The AI could not identify a clear answer. Check that the question and choices contain readable text.");

    $("answer").textContent = payload.answer;
    $("explanation").textContent = payload.explanation || "No explanation was returned.";
    $("confidence").textContent = payload.confidence ? `Confidence: ${payload.confidence}` : "";
    $("result").classList.remove("hidden");

    let selected = false;
    try {
      const [selection] = await chrome.scripting.executeScript({
        target: { tabId: (await chrome.tabs.query({ active: true, currentWindow: true }))[0].id },
        func: selectUnambiguousPracticeAnswer,
        args: [payload.answer]
      });
      selected = selection?.result?.selected === true;
    } catch (selectionError) {
      // Still show the AI result if the active page disallows script injection.
      console.warn("Could not select a practice answer:", selectionError);
    }
    setStatus(
      selected
        ? "Analysis complete. Selected the matching practice answer; it was not submitted."
        : "Analysis complete. Check the suggested answer.",
      "success"
    );
  } catch (error) {
    let message = error?.message || "Something went wrong.";
    if (message.includes("Failed to fetch")) {
      message = "Could not reach the backend. Start the server and check the Backend URL.";
    }
    setStatus(message, "error");
  } finally {
    $("scanBtn").disabled = false;
  }
});

$("selectedTextBtn").addEventListener("click", async () => {
  $("selectedTextBtn").disabled = true;
  $("result").classList.add("hidden");
  setStatus("Reading selected text...");
  try {
    const { backendUrl = "http://localhost:3000" } =
      await chrome.storage.sync.get({ backendUrl: cleanBaseUrl($("backendUrl").value) });
    const [selection] = await chrome.scripting.executeScript({
      target: { tabId: (await chrome.tabs.query({ active: true, currentWindow: true }))[0].id },
      func: () => window.getSelection?.().toString().replace(/\s+/g, " ").trim() || ""
    });
    const questionText = selection?.result || "";
    if (!questionText) {
      throw new Error("No text is selected. Highlight the question and all answer choices on the page first.");
    }

    setStatus("Sending selected text for AI analysis...");
    const response = await fetch(`${cleanBaseUrl(backendUrl)}/api/solve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ questionText })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Server error (${response.status})`);
    if (!payload.answer) throw new Error("The AI could not identify a clear answer from the selected text.");

    $("answer").textContent = payload.answer;
    $("explanation").textContent = payload.explanation || "No explanation was returned.";
    $("confidence").textContent = payload.confidence ? `Confidence: ${payload.confidence}` : "";
    $("result").classList.remove("hidden");
    setStatus("Analysis complete. Check the suggested answer.", "success");
  } catch (error) {
    let message = error?.message || "Something went wrong.";
    if (message.includes("Failed to fetch")) {
      message = "Could not reach the backend. Start the server and check the Backend URL.";
    }
    setStatus(message, "error");
  } finally {
    $("selectedTextBtn").disabled = false;
  }
});

$("selectAreaBtn").addEventListener("click", async () => {
  $("selectAreaBtn").disabled = true;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("Could not find the active page.");
    const backendUrl = cleanBaseUrl($("backendUrl").value);
    await chrome.runtime.sendMessage({ type: "solve-region-text", tabId: tab.id, backendUrl });
    setStatus("Draw a border around the question and choices. Reopen this popup for the result.", "success");
  } catch (error) {
    setStatus(error?.message || "Could not start area selection.", "error");
    $("selectAreaBtn").disabled = false;
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "session") return;
  if (changes.regionSolveResult?.newValue) {
    const payload = changes.regionSolveResult.newValue;
    $("answer").textContent = payload.answer;
    $("explanation").textContent = payload.explanation || "No explanation was returned.";
    $("confidence").textContent = payload.confidence ? `Confidence: ${payload.confidence}` : "";
    $("result").classList.remove("hidden");
    setStatus("Analysis complete. Check the suggested answer.", "success");
  }
  if (changes.solverResult || changes.solverError) loadShortcutResult();
});

async function loadRegionResult() {
  const { regionSolveResult, regionSolveError } = await chrome.storage.session.get({
    regionSolveResult: null,
    regionSolveError: ""
  });
  if (regionSolveResult) {
    $("answer").textContent = regionSolveResult.answer;
    $("explanation").textContent = regionSolveResult.explanation || "No explanation was returned.";
    $("confidence").textContent = regionSolveResult.confidence ? `Confidence: ${regionSolveResult.confidence}` : "";
    $("result").classList.remove("hidden");
    setStatus("Analysis complete. Check the suggested answer.", "success");
  } else if (regionSolveError) {
    setStatus(regionSolveError, "error");
  }
}

async function loadShortcutResult() {
  const { solverResult, solverError } = await chrome.storage.session.get({ solverResult: null, solverError: "" });
  if (solverResult) {
    $("answer").textContent = solverResult.answer;
    $("explanation").textContent = solverResult.explanation || "No explanation was returned.";
    $("confidence").textContent = solverResult.confidence ? `Confidence: ${solverResult.confidence}` : "";
    $("result").classList.remove("hidden");
    setStatus("Analysis complete. Check the suggested answer.", "success");
  } else if (solverError) {
    setStatus(solverError, "error");
  }
}

loadSettings();
loadRegionResult();
loadShortcutResult();
