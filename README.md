<div align="center">
  <h1 align="center">Ziva</h1>

  <p align="center">
    <strong>Intelligent. Responsive. Vocal.</strong><br/>
    A voice-enabled AI avatar with local speech (Piper/Vosk) + Gemini.
  </p>

  <p align="center">
    <a href="https://react.dev/">
      <img alt="React" src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white"/>
    </a>
    <a href="https://vite.dev/">
      <img alt="Vite" src="https://img.shields.io/badge/Vite-rolldown--vite-646CFF?logo=vite&logoColor=white"/>
    </a>
    <a href="https://threejs.org/">
      <img alt="Three.js" src="https://img.shields.io/badge/Three.js-r3f-000000?logo=three.js&logoColor=white"/>
    </a>
    <a href="https://nodejs.org/">
      <img alt="Node.js" src="https://img.shields.io/badge/Node.js-Express%205-339933?logo=nodedotjs&logoColor=white"/>
    </a>
    <a href="https://ai.google.dev/">
      <img alt="Gemini API" src="https://img.shields.io/badge/AI-Gemini%20API-8E75B2?logo=google&logoColor=white"/>
    </a>
    <a href="https://github.com/rhasspy/piper">
      <img alt="Piper" src="https://img.shields.io/badge/TTS-Piper-2B579A?logo=python&logoColor=white"/>
    </a>
    <a href="https://alphacephei.com/vosk/">
      <img alt="Vosk" src="https://img.shields.io/badge/STT-Vosk-2B579A?logo=python&logoColor=white"/>
    </a>
  </p>
</div>

---

## Overview

Ziva is a voice-enabled AI chatbot with a 3D avatar. You can type or speak; Ziva responds with text plus a locally synthesized voice, while driving avatar facial expressions + animations.

At a high level:

- **Frontend (Vite dev server)** runs on `http://localhost:5173`
- **Backend (Express API)** runs on `http://localhost:3000`
- **Python speech worker** is spawned by the backend for local STT/TTS

---

## Key Features

- **Text + voice chat:** `POST /chat` for text, `POST /talk` for microphone audio.
- **Local speech:** Vosk STT + Piper TTS (no paid TTS/STT service required).
- **3D avatar:** Three.js via @react-three/fiber + @react-three/drei.
- **Lip sync:** wawa-lipsync.
- **Session memory:** backend keeps per-session chat history.

---

## Tech Stack

### Frontend

- React 19 + TypeScript
- Vite (rolldown-vite)
- Tailwind CSS v4 (via `@tailwindcss/vite`)
- Three.js via @react-three/fiber + @react-three/drei
- Lip sync: wawa-lipsync
- UI feedback: react-hot-toast
- (Optional) Leva (debug controls)

### Backend

- Node.js (ESM) + Express 5
- Google Gemini via `@google/generative-ai` (Gemini 2.5 model IDs)
- `cors`, `dotenv`
- `multer` for audio upload
- `ffmpeg-static` to convert browser audio (webm/ogg) → WAV mono PCM 16-bit
- `axios` (+ `form-data`) for HTTP calls
- Spawns Python (`Backend/speech.py`) for TTS/STT

### Speech (Python)

- Vosk (STT)
- Piper (TTS)

---

## How It Works

### Text chat (`/chat`)

1. Frontend sends `{ message, sessionId }` to the backend.
2. Backend calls Gemini and receives JSON containing `text`, `facialExpression`, `animation`.
3. Backend generates TTS audio locally with Piper and returns it as a base64 WAV data URL.
4. Frontend plays audio and applies expression/animation to the 3D avatar.

### Voice chat (`/talk`)

1. Browser records audio (usually `audio/webm`).
2. Backend converts to WAV mono PCM with FFmpeg.
3. Python transcribes with Vosk.
4. Text is sent to Gemini.
5. Python synthesizes voice with Piper.
6. Frontend plays audio and animates the 3D avatar.

### Lip sync (wawa-lipsync)

Lip sync happens entirely on the **frontend**, driven by the **same audio** that you hear.

Flow:

1. Backend returns `audio` as a base64 **WAV data URL**.
2. Frontend passes that URL into the avatar component as `audioUrl`.
3. The avatar creates an `HTMLAudioElement`, waits for `canplay`, then connects wawa-lipsync:
  - `lipsync.connectAudio(audio)`
  - `audio.play()` (with an autoplay retry on first user gesture if the browser blocks it)
4. On every render frame, while audio is playing:
  - `lipsync.processAudio()` analyzes the current audio window (wawa-lipsync uses WebAudio under the hood)
  - `lipsync.viseme` exposes the current viseme key (examples: `viseme_aa`, `viseme_sil`)
5. The avatar model is expected to have **blendshapes/morph targets named `viseme_*`**. The render loop:
  - sets the currently active `viseme_*` morph target to a configured intensity
  - lerps all viseme targets smoothly for natural mouth motion
6. Facial expressions still apply while speaking, but mouth/jaw/tongue-related expression channels are attenuated while audio is playing to avoid fighting the visemes.

Implementation lives in `Frontend/src/components/Ziva.tsx`.

---

## Repository Structure

```bash
Ziva/
├── Frontend/                 # React client (Vite + TypeScript)
│   ├── src/
│   │   ├── App.tsx            # Chat UI + recording + API calls
│   │   └── components/
│   │       ├── Experience.tsx  # Scene setup
│   │       └── Ziva.tsx        # Avatar + animations + lipsync
│   └── public/               # Static assets
│       ├── home.exr
│       └── models/            # Ziva.glb, Animations.glb, etc.
├── Backend/                  # Node.js API
│   ├── server.js             # Express app + routes
│   ├── dev.js                # Dev runner (also resolves PYTHON_BIN)
│   ├── speech.py             # Piper + Vosk
│   └── models/               # Piper voices + Vosk model
└── README.md
```

---

## Getting Started

### Prereqs

- Node.js 18+ (recommended)
- Python 3.10+ (recommended)

### 1) Backend

Recommended: create a virtual environment at the repo root (the backend runner auto-detects `./.venv`):

```bash
cd ..
python -m venv .venv
```

Activate it:

- PowerShell:

```powershell
.\.venv\Scripts\Activate.ps1
```

Install Python deps (required for voice):

```bash
python -m pip install --upgrade pip
python -m pip install -r Backend/requirements.txt
```

Install Node deps:

```bash
cd Backend
npm install
```

Create `Backend/.env` and set at least:

```env
FRONTEND_URL=http://localhost:5173
GEMINI_API_KEY=your_key_here
```

If your Python isn’t on PATH (or you don’t want to use `./.venv`), you can also set `PYTHON_BIN` in `Backend/.env`.

Run the backend:

```bash
cd Backend
npm run dev
```

Backend runs on `http://localhost:3000`.

### 2) Frontend

```bash
cd Frontend
npm install
```

Create `Frontend/.env`:

```env
VITE_API_BASE_URL=http://localhost:3000
```

Run:

```bash
npm run dev
```

Frontend runs on `http://localhost:5173`.

---

## API (Backend)

- `POST /chat` — JSON `{ message, sessionId }` → `{ text, facialExpression, animation, audio }`
- `POST /talk` — multipart form-data `audio=<blob>` (+ `sessionId`) → `{ userText, text, facialExpression, animation, audio }`
- `GET /tts/voices` — list available Piper voices
- `POST /clear-history` — JSON `{ sessionId }`

---

## Notes / Troubleshooting

- If Python isn’t found, set `PYTHON_BIN` in `Backend/.env` to your interpreter path.
- If you don’t want auto-downloads for speech models, set `VOSK_AUTO_DOWNLOAD=0` and/or `PIPER_AUTO_DOWNLOAD=0`.
- The first voice request can be slower; the backend runs a warmup on startup.

### Deployment note (Render / Linux)

If you see `ModuleNotFoundError: No module named 'vosk'` (or `piper`), it means the Python deps for `Backend/speech.py` were not installed in your deploy environment.

- Python deps live in `Backend/requirements.txt`
- `Backend/package.json` runs a `postinstall` hook to install them automatically during `npm install`

## Configuration (Optional)

Backend (`Backend/.env`):

- `PYTHON_BIN` — path to python executable (useful on Windows)
- `PIPER_VOICE` — default Piper voice (example: `en_US-amy-low`, `en_GB-semaine-medium`)
- `PIPER_TTS_STYLE` — `default` or `cheerful` (see `speech.py`)
- `PIPER_SPEAKER_ID` — speaker index for multi-speaker voices (if supported)
- `PIPER_MODELS_DIR` — where Piper `.onnx` models live
- `PIPER_AUTO_DOWNLOAD` — set `0` to disable auto-download of missing voices
- `VOSK_MODEL_PATH` — path to a Vosk model directory
- `VOSK_AUTO_DOWNLOAD` — set `0` to disable auto-download of the default Vosk model

Frontend (`Frontend/.env`):

- `VITE_API_BASE_URL` — backend base URL (default: `http://localhost:3000`)
