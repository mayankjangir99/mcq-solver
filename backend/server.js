require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { GoogleGenAI } = require("@google/genai");

const app = express();
const port = Number(process.env.PORT || 3000);
// Override the Gemini model in .env when needed.
const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";

if (!process.env.GEMINI_API_KEY) {
  console.error("Missing GEMINI_API_KEY in backend/.env");
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const answerSchema = {
  type: "object",
  properties: {
    answer: { type: "string", description: "The selected option marker and/or answer text." },
    explanation: { type: "string", description: "A concise explanation of why the answer is correct." },
    confidence: { type: "string", enum: ["High", "Medium", "Low"] }
  },
  required: ["answer", "explanation", "confidence"],
  additionalProperties: false
};

app.disable("x-powered-by");
app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    if (
      !origin ||
      origin.startsWith("chrome-extension://") ||
      origin.startsWith("moz-extension://") ||
      origin.startsWith("http://localhost:") ||
      origin.startsWith("http://127.0.0.1:")
    ) return callback(null, true);

    return callback(new Error("Origin not allowed by CORS"));
  }
}));
app.use(express.json({ limit: "12mb" }));

app.use("/api/", rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false
}));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "ai-mcq-solver-gemini" });
});

function parseModelJson(text) {
  const cleaned = String(text || "").trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  return JSON.parse(cleaned);
}

function geminiErrorResponse(error) {
  const status = Number(error?.status || error?.response?.status);
  const code = String(error?.code || error?.status || "").toUpperCase();
  const detail = String(error?.message || "").toLowerCase();

  if (status === 401 || status === 403 || /unauthenticated|permission.denied|api key/.test(code + detail)) {
    return { status: 502, message: "Gemini API key is invalid or does not have access. Check backend/.env." };
  }
  if (status === 429 || /resource.exhausted|quota|rate limit/.test(code + detail)) {
    return { status: 429, message: "Gemini rate limit or quota reached. Try again later." };
  }
  if (status === 404 || /model.*(not found|unsupported)|not found.*model/.test(detail)) {
    return { status: 502, message: "Gemini model is unavailable. Check GEMINI_MODEL in backend/.env." };
  }
  if (status === 400 && /model/.test(detail)) {
    return { status: 502, message: "Gemini model configuration is invalid. Check GEMINI_MODEL in backend/.env." };
  }
  if (/fetch|network|econn|enotfound|timeout/.test(code + detail)) {
    return { status: 502, message: "Could not connect to Gemini. Check your internet connection." };
  }
  return { status: 502, message: "Gemini request failed. Check the backend terminal." };
}

app.post("/api/solve", async (req, res) => {
  const { questionText, screenshot } = req.body || {};
  const cleanQuestionText = typeof questionText === "string" ? questionText.trim() : "";
  const imageMatch = typeof screenshot === "string"
    ? screenshot.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/)
    : null;

  if (!cleanQuestionText && !imageMatch) {
    return res.status(400).json({ error: "A readable question or screenshot is required." });
  }
  if (cleanQuestionText.length > 8000) {
    return res.status(413).json({ error: "Question text is too large. Try scanning a single question." });
  }
  if (imageMatch && imageMatch[2].length > 10 * 1024 * 1024) {
    return res.status(413).json({ error: "Screenshot is too large. Zoom in so only one question is visible and try again." });
  }

  const prompt = "You are a careful tutor for practice and revision. Analyze this multiple-choice question and its options. Return the complete matching option text (including its letter/marker when available) in answer. If the text is incomplete or does not contain a clear question and options, do not guess; state that no clear answer is available.";
  const parts = [{ text: cleanQuestionText ? `${prompt}\n\nExtracted page text:\n${cleanQuestionText}` : prompt }];
  if (imageMatch) {
    parts.push({ inlineData: { mimeType: imageMatch[1], data: imageMatch[2] } });
  }

  try {
    const response = await ai.models.generateContent({
      model,
      contents: [{
        role: "user",
        parts
      }],
      config: {
        responseMimeType: "application/json",
        responseJsonSchema: answerSchema,
        temperature: 0.2,
        maxOutputTokens: 500
      }
    });

    let result;
    try {
      result = parseModelJson(response.text);
    } catch {
      return res.status(502).json({ error: "Could not parse Gemini's response. Please try again." });
    }

    if (!result || typeof result !== "object" || !String(result.answer || "").trim()) {
      return res.status(502).json({ error: "No clear answer found. Try scanning a page with readable question text." });
    }

    return res.json({
      answer: String(result.answer).trim(),
      explanation: String(result.explanation || "").trim(),
      confidence: ["High", "Medium", "Low"].includes(result.confidence)
        ? result.confidence
        : "Medium"
    });
  } catch (error) {
    const failure = geminiErrorResponse(error);
    console.error("Gemini API error:", error?.status || error?.code || "unknown", error?.message || "Unknown error");
    return res.status(failure.status).json({ error: failure.message });
  }
});

app.listen(port, () => {
  console.log(`Gemini MCQ Solver running at http://localhost:${port}`);
});
