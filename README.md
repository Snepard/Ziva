<div align="center">
  <h1 align="center">Ziva</h1>

  <p align="center">
    <strong>Intelligent. Responsive. Vocal.</strong><br/>
    A next-generation AI chatbot capable of natural, context-aware, and voice-enabled conversations.
  </p>

  <p align="center">
    <a href="https://react.dev/">
      <img alt="React" src="https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white"/>
    </a>
    <a href="https://nodejs.org/">
      <img alt="Node.js" src="https://img.shields.io/badge/Node.js-Express-339933?logo=nodedotjs&logoColor=white"/>
    </a>
    <a href="https://ai.google.dev/">
      <img alt="Gemini API" src="https://img.shields.io/badge/AI-Gemini%20API-8E75B2?logo=google&logoColor=white"/>
    </a>
    <a href="https://elevenlabs.io/">
      <img alt="ElevenLabs" src="https://img.shields.io/badge/Voice-ElevenLabs-000000?logo=audio-technica&logoColor=white"/>
    </a>
  </p>
</div>

---

## 🤖 Overview

**Ziva** is a sophisticated AI chatbot application designed to bridge the gap between human users and Large Language Models (LLMs). Unlike standard text-based bots, Ziva offers a fully immersive experience with **bi-directional voice interaction**.

You can speak to Ziva naturally, and it will respond with a lifelike human voice, maintaining conversation context and emotional nuance.

---

## ✨ Key Features

### 🎙️ Voice Interaction (TTS & STT)
- **Speech-to-Text (STT):** Talk to Ziva directly using your microphone; your voice is instantly transcribed into text.
- **Text-to-Speech (TTS):** Hear Ziva's responses in high-quality, realistic voices powered by **ElevenLabs**.

### 🧠 Context-Aware Conversations
- Remembers previous turns in the conversation.
- Understands follow-up questions without needing context restated.

### ⚡ Real-Time Streaming
- Responses are streamed in real-time (typewriter effect) for a fluid UX.
- Audio playback begins as soon as the text is generated.

### 📝 Rich Text Formatting
- **Markdown Support:** Renders bold, italics, lists, and headers perfectly.
- **Code Highlighting:** Automatically detects programming languages and formats code blocks.

---

## 🧩 Tech Stack

### **Frontend (Client)**
- **Framework:** React.js (Vite)
- **Styling:** Tailwind CSS + Framer Motion
- **Audio:** Web Audio API (for recording)
- **State Management:** React Hooks / Context API

### **Backend (Server)**
- **Runtime:** Node.js + Express.js
- **AI Brain:** Google Gemini API / OpenAI API
- **Voice Engine:** **ElevenLabs API** (TTS & STT)
- **Multimedia:** `multer` (for handling audio file uploads)

---

## 🔄 How Ziva Works

1.  **Voice Input:** User speaks into the microphone.
2.  **Transcription (STT):** Audio is sent to **ElevenLabs** (or Whisper) to convert speech to text.
3.  **LLM Processing:** The text prompt is forwarded to the **Gemini/OpenAI API**.
4.  **Response Generation:** The AI generates a text response.
5.  **Voice Synthesis (TTS):** The text response is sent to **ElevenLabs**, which returns an audio stream of the spoken answer.
6.  **Playback:** The frontend plays the audio while typing out the text on screen.

---

## 📁 Repository Structure

```bash
Ziva/
│
├── frontend/                 # React client
│   ├── src/
│   │   ├── components/       # ChatBubble, AudioRecorder, Visualizer
│   │   ├── api/              # API connectors (LLM + ElevenLabs)
│   │   └── hooks/            # useAudio, useRecorder
│   └── public/
│
├── backend/                  # Node.js Server
│   ├── config/               # API Keys configuration
│   ├── controllers/          # Voice processing & Chat logic
│   ├── services/             # ElevenLabsService.js
│   ├── routes/               # API Endpoints
│   └── server.js             # Entry point
│
└── README.md
```
---

## 🚀 Getting Started   

1️⃣ Clone the Repository
```bash
git clone [https://github.com/Snepard/Ziva.git](https://github.com/Snepard/Ziva.git)
cd Ziva
```

2️⃣ API Configuration
You will need an API key from your AI provider (e.g., Google AI Studio).
Create a .env file in the backend folder:
```bash
GEMINI_API_KEY=....
ELEVENLABS_API_KEY=....
ELEVENLABS_VOICE_ID=ecp3DWciuUyW7BYM7II1
ELEVENLABS_TTS_MODEL=eleven_flash_v2_5
```

3️⃣ Backend Setup
```bash
cd backend
npm install
npm run dev
```

4️⃣ Frontend Setup
Open a new terminal:
```bash
cd frontend
npm install
npm run dev
```
Visit http://localhost:5173 to start chatting with Ziva!

---

## 🧠 Author’s Note

Ziva is my exploration into Conversational AI and Prompt Engineering. The goal was to create a UI that feels as polished as proprietary tools like ChatGPT, while maintaining control over the underlying data and model parameters.

---

## 🧾 License
This project is licensed under the MIT License.


### Next Steps
Would you like me to help you set up the **deployable version** of Ziva on Vercel (Frontend) and Ren
