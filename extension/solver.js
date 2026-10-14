function cleanBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

// Runs in the scanned page, so it only reads the current, user-authorized tab.
function extractVisibleMcqText() {
  const isVisible = (element) => {
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  };
  const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const textFrom = (element) => clean(element?.innerText || element?.textContent);
  const radios = [...document.querySelectorAll('input[type="radio"]')]
    .map((input) => {
      const forLabel = input.id && document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
      const label = forLabel || input.closest("label") || input.parentElement;
      return { input, label, text: textFrom(label) };
    })
    .filter(({ input, label, text }) => (isVisible(input) || (label && isVisible(label))) && text);

  if (radios.length >= 2) {
    const firstLabel = radios[0].label;
    const container = firstLabel?.closest("fieldset, [role='radiogroup'], [role='group'], [data-question], .question, .quiz-question, form");
    const choices = [...new Set(radios.map(({ text }) => text))].slice(0, 10);
    const containerText = textFrom(container);
    const question = ["[data-question-text]", ".question-text", ".question-title", ".question", "h1", "h2", "h3"]
      .map((selector) => [...document.querySelectorAll(selector)].find(isVisible))
      .map(textFrom)
      .find(Boolean);
    return clean([
      question && `Question: ${question}`,
      containerText && `Visible question area: ${containerText}`,
      `Options:\n${choices.map((choice, index) => `${String.fromCharCode(65 + index)}. ${choice}`).join("\n")}`
    ].filter(Boolean).join("\n\n")).slice(0, 8000);
  }

  const questionBlock = ["[data-question]", ".question", ".quiz-question", "fieldset", "[role='group']"]
    .map((selector) => [...document.querySelectorAll(selector)].find(isVisible))
    .find(Boolean);
  return (textFrom(questionBlock) || textFrom(document.body)).slice(0, 8000);
}

function selectUnambiguousPracticeAnswer(answer) {
  const visible = (element) => {
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  };
  const normalise = (value) => String(value || "").toLowerCase().replace(/\s+/g, " ").replace(/["'`]/g, "").trim();
  const withoutOptionPrefix = (value) => normalise(value).replace(/^(?:option\s*)?[a-z0-9]+\s*[.)\-:]\s*/, "").trim();
  if (!/\bpractice\s+mode\b/.test(normalise(document.body?.innerText))) return { selected: false, reason: "not-practice-mode" };

  const answerText = normalise(answer);
  const answerValue = withoutOptionPrefix(answer);
  if (!answerText || !answerValue) return { selected: false, reason: "no-match" };
  const options = [...document.querySelectorAll('input[type="radio"]')]
    .map((input) => {
      const idLabel = input.id && document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
      const label = idLabel || input.closest("label") || input.parentElement;
      const text = normalise(label?.innerText || label?.textContent);
      return { input, label, text, value: withoutOptionPrefix(text) };
    })
    .filter((option) => (visible(option.input) || (option.label && visible(option.label))) && option.text && option.value);
  let matches = options.filter((option) => option.text === answerText || option.value === answerValue);
  if (matches.length === 0) {
    const marker = answerText.match(/^(?:option\s*)?([a-z])\s*[.)\-:]/)?.[1];
    if (marker && options.length >= 2 && options.length <= 26) {
      const indexedOption = options[marker.charCodeAt(0) - 97];
      const optionMarker = indexedOption?.text.match(/^(?:option\s*)?([a-z])\s*[.)\-:]/)?.[1];
      if (indexedOption && optionMarker === marker) matches = [indexedOption];
    }
  }
  if (matches.length !== 1) return { selected: false, reason: "no-unique-match" };
  if (!matches[0].input.checked) matches[0].input.click();
  // Never submit or advance a quiz. The learner remains in control.
  return { selected: true };
}

async function solveVisibleQuestion(tabId) {
  await chrome.storage.session.set({ solverResult: null, solverError: "" });
  try {
    const { backendUrl = "http://localhost:3000" } = await chrome.storage.sync.get({ backendUrl: "http://localhost:3000" });
    const [extraction] = await chrome.scripting.executeScript({ target: { tabId }, func: extractVisibleMcqText });
    const questionText = extraction?.result?.trim();
    if (!questionText) throw new Error("No readable question text was found on this page.");

    const response = await fetch(`${cleanBaseUrl(backendUrl)}/api/solve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ questionText })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Server error (${response.status})`);
    if (!payload.answer) throw new Error("The AI could not identify a clear answer from the visible question.");
    try {
      await chrome.scripting.executeScript({ target: { tabId }, func: selectUnambiguousPracticeAnswer, args: [payload.answer] });
    } catch (selectionError) {
      console.warn("Could not select a practice answer:", selectionError);
    }
    await chrome.storage.session.set({ solverResult: payload, solverError: "" });
  } catch (error) {
    const message = error?.message || "Could not solve this page.";
    await chrome.storage.session.set({
      solverResult: null,
      solverError: message.includes("Cannot access") || message.includes("Missing host permission")
        ? "This Chrome page is restricted or the extension does not have permission to read it."
        : message
    });
  }
}
