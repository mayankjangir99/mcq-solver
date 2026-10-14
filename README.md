# AI MCQ Solver (Chrome)

This Chrome extension reads a visible multiple-choice question and its options, sends the extracted text (and, for the regular scan, an optional visible-page screenshot) to a local Gemini backend, then shows a suggested answer and explanation. It is intended for practice and revision.

## Project layout

- `extension/` — Chrome Manifest V3 extension
- `backend/` — Node.js + Express API; the Gemini API key stays on the server

## Requirements

- Google Chrome 102 or later
- Node.js 20 or later
- A Google Gemini API key with access to a supported image-capable Gemini model

## Windows setup

Start the backend in PowerShell:

```powershell
cd C:\Users\Asus\Desktop\ai-mcq-solver\backend
npm.cmd install
Copy-Item .env.example .env
notepad .env
```

Set the values in `.env`:

```env
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-2.5-flash
PORT=3000
```

Never commit or share `.env`. Then start the server:

```powershell
npm.cmd start
```

Open `http://localhost:3000/health`; it should return JSON with `"ok": true`.

## Load or reload the extension

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Select **Load unpacked** and choose the `extension` folder.
4. Reload the target webpage, then click the AI MCQ Solver extension icon.
5. Optional: at `chrome://extensions/shortcuts`, assign a Chrome-compatible shortcut to **Activate AI MCQ Solver**. Open the popup afterwards to see its result.

The shortcut and text-selection modes send extracted text only. The regular Scan action may also send a screenshot of the currently visible tab when available. The backend sends this data to Gemini; no API key is stored in the extension. In pages explicitly marked as practice mode, the extension can select one unambiguous matching radio option but never submits or advances a quiz.

## Backend URL

The popup defaults to `http://localhost:3000`. To use a different server, enter its URL in the popup and click **Save backend URL**. A deployed backend should use HTTPS, and its exact URL pattern must be added under `host_permissions` in `extension/manifest.json` before reloading the unpacked extension.

## Privacy and limitations

- Keep one complete question and all choices visible for the best result.
- Do not scan private, personal, or confidential information.
- Extracted question data is sent to your backend and Gemini. The backend does not persist requests, but provider-side processing and operational logs may apply.
- Chrome blocks extensions from reading restricted pages such as `chrome://` pages and the Chrome Web Store.
- Verify answers against course materials; unusual markup, image-only questions, overlays, and multiple visible questions can reduce accuracy.
