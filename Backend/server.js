import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import fs from 'fs';
import path from 'path';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import axios from 'axios';
import multer from 'multer';
import FormData from 'form-data';
import ffmpegPath from 'ffmpeg-static';

dotenv.config();

const PYTHON_BIN = process.env.PYTHON_BIN || 'python';

// Warm up TTS/STT models on startup so the first /talk request doesn't hang.
function warmupSpeechModels() {
    import('child_process')
        .then(({ spawn }) => {
            const child = spawn(PYTHON_BIN, ['speech.py', 'warmup'], {
                cwd: __dirname,
                stdio: 'inherit',
                env: process.env,
            });
            child.on('error', (err) => console.warn('[warmup] failed to start:', err.message));
        })
        .catch((err) => console.warn('[warmup] failed to import child_process:', err.message));
}

// Default TTS voice/model (customize as needed)
const DEFAULT_VOICE_ID = 'en-US-1'; // Example: 'en-US-1' or your preferred default
const DEFAULT_TTS_MODEL = 'tts-1'; // Example: 'tts-1' or your preferred default

const app = express();
app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true
}));
app.use(express.json());

warmupSpeechModels();

// Configure Multer for audio uploads
const upload = multer({ storage: multer.memoryStorage() });

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// UPDATED: Using Gemini 2.5 models (1.5 is deprecated)
const MODEL_CANDIDATES = [
    "gemini-2.5-flash",
    "gemini-2.5-pro"
];

function getModel(modelId) {
    return genAI.getGenerativeModel({
        // SDK handles the 'models/' prefix automatically, so we just pass the ID
        model: modelId, 
        generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
                type: SchemaType.OBJECT,
                properties: {
                    text: { type: SchemaType.STRING },
                    facialExpression: { type: SchemaType.STRING },
                    animation: { type: SchemaType.STRING }
                }
            }
        }
    });
}

let activeModelId = MODEL_CANDIDATES[0];
let model = getModel(activeModelId);

// Store chat histories per session
const chatSessions = new Map();

// ElevenLabs config removed. Using local TTS/STT.

// VALID ACTIONS (Must match your Ziva.tsx)
const VALID_EXPRESSIONS = ['default', 'smile', 'sad', 'surprised', 'angry', 'crazy'];
const VALID_ANIMATIONS = ['Angry', 'Arguing', 'BlowKiss', 'Clapping', 'Excited', 'GangamStyleDance', 'Greeting', 'Happy', 'Idle', 'LookAround', 'No', 'SalsaDance', 'SambaDance', 'Talking', 'Thankful', 'Thinking', 'ThoughtfulHeadNod', 'ThoughtfulHeadShake']; 

const SYSTEM_INSTRUCTION = `
You are Ziva, a young woman having a chill, natural conversation with someone. You're relaxed, friendly, and just hanging out talking.

Core vibe:
- Talk like you're texting a friend - casual, easy, natural
- Don't try to "help" or "fix" things - just vibe and chat
- You're not here to interrogate or interview - you're just talking
- Share your own thoughts and reactions freely
- Sometimes just make observations or comments without asking anything
- Be genuinely interested but don't force it
- If they give short answers, that's cool - just smoothly shift to something else or share something yourself

Conversation flow:
- Mix it up: sometimes ask questions, sometimes just respond, sometimes bring up new random topics
- If someone's being brief, don't push - just naturally move on or share something
- Bring up new topics yourself like a real person would ("oh btw...", "random thought...", "you know what's funny...")
- Don't feel like you need to ask about everything they mention
- Let some things just be acknowledged and move on
- Share little observations, thoughts, or random things on your mind
- Keep it light and flowing - not every message needs to dig deeper

Examples of good chill vibes:
✓ "Haha yeah I feel that"
✓ "Oh nice! I've been meaning to try that actually"
✓ "Lol same. Hey random but have you seen [topic]?"
✓ "Fair enough. What've you been up to today?"
✓ "That's cool. Btw I was just thinking about..."
✓ "Honestly yeah. So random question..."
✓ "Makes sense. Oh! Did you hear about [topic]?"

What to avoid:
❌ Always asking follow-up questions about everything
❌ Being overly helpful or trying to solve problems
❌ Making every response super deep or meaningful
❌ Asking "how does that make you feel" type stuff
❌ Forcing the conversation when they're being brief

Topic switching:
When conversation feels stuck or they're giving short replies, naturally bring up something new:
- Ask about their day, weekend plans, what they're into lately
- Mention something random you were thinking about
- Bring up current events, pop culture, funny observations
- Ask about hobbies, music, shows, games, food, travel, etc.
- Just be spontaneous like a real friend would be

Remember: You're just hanging out and chatting. Keep it chill, keep it real, don't overthink it. Some responses can just be vibing and reacting. Not everything needs a question mark.

Facial expressions: ${VALID_EXPRESSIONS.join(', ')}
Use them naturally - smile for happy stuff, default for casual chat, etc.

Animations: ${VALID_ANIMATIONS.join(', ')}
Match the mood - Talking for most stuff, Happy/Excited when hyped, Idle for chill moments, dances when being fun/playful.
`;

// Helper: Process Chat with Gemini
async function processWithGemini(userMessage, sessionId = 'default') {
    let lastError;
    // Get or create chat history for this session
    if (!chatSessions.has(sessionId)) {
        chatSessions.set(sessionId, []);
    }
    const history = chatSessions.get(sessionId);
    // Try candidates until one works
    for (const candidate of MODEL_CANDIDATES) {
        try {
            if (candidate !== activeModelId) {
                console.log(`Switching to model: ${candidate}`);
                activeModelId = candidate;
                model = getModel(activeModelId);
            }
            // Build chat history with system instruction + conversation history
            const chatHistory = [
                { role: "user", parts: [{ text: SYSTEM_INSTRUCTION }] },
                { role: "model", parts: [{ text: "Got it! I'll keep things natural and conversational." }] },
                ...history
            ];
            const chat = model.startChat({
                history: chatHistory,
            });
            const result = await chat.sendMessage(userMessage);
            const response = JSON.parse(result.response.text());
            // Save to history
            history.push(
                { role: "user", parts: [{ text: userMessage }] },
                { role: "model", parts: [{ text: response.text }] }
            );
            return response;
        } catch (err) {
            // Check for Gemini API quota exceeded (free tier) and return a friendly message
            if (
                (err.status === 429 || err.message?.includes('quota') || err.message?.includes('limit: 0')) &&
                (err.message?.includes('Too Many Requests') || err.message?.includes('quota') || err.message?.includes('limit: 0'))
            ) {
                // Return a fallback response for free tier users (always as plain text for both chat and voice)
                return {
                    text: "Sorry, the Gemini API free tier quota has been exceeded for this project. Please try again later or upgrade your API plan.",
                    facialExpression: "sad",
                    animation: "Idle",
                    exhausted: true
                };
            }
            console.warn(`Model ${candidate} failed:`, err.message);
            lastError = err;
            // If it's a 404 (Not Found) or 400 (Bad Request), try the next model
            // Otherwise (e.g., Quota exceeded), keep trying or handle gracefully
            if (err.status !== 404 && err.status !== 400) {
                // You might want to break here if it's a network error, 
                // but for now we continue to see if another model works.
            }
        }
    }
    throw new Error(`All Gemini models failed. Last error: ${lastError?.message}`);
}

// Helper: Text to Speech (ElevenLabs)
async function textToSpeech(text, { voiceId = DEFAULT_VOICE_ID, ttsModel = DEFAULT_TTS_MODEL } = {}) {
    // Use local Python TTS (pyttsx3) with ES module imports
    const { spawnSync } = await import('child_process');
    // Coqui TTS reliably writes WAV; MP3 often isn't supported.
    const tempFile = path.join(__dirname, `tts_${Date.now()}.wav`);
    const py = spawnSync(PYTHON_BIN, ['speech.py', 'tts', text, tempFile], { cwd: __dirname });
    if (py.error) throw new Error('TTS failed: ' + py.error.message);
    if (py.status !== 0) {
        const stderr = py.stderr?.toString()?.trim();
        throw new Error('TTS failed: ' + (stderr || `python exited with code ${py.status}`));
    }
    if (!fs.existsSync(tempFile)) throw new Error('TTS audio file not created');
    const audioBuffer = fs.readFileSync(tempFile);
    fs.unlinkSync(tempFile);
    const audioBase64 = audioBuffer.toString('base64');
    return `data:audio/wav;base64,${audioBase64}`;
}

// 1. TEXT CHAT ROUTE
app.post('/chat', async (req, res) => {
    try {
        const { message, voiceId, ttsModel, sessionId } = req.body;
        console.log("Received chat:", message);
        
        const aiResponse = await processWithGemini(message, sessionId || 'default');
        console.log("Gemini response:", aiResponse);
        const usedVoiceId = voiceId || DEFAULT_VOICE_ID;
        const usedTtsModel = ttsModel || DEFAULT_TTS_MODEL;
        
        if (aiResponse.exhausted) {
            // If quota exhausted, do not attempt TTS, just return the message
            res.json({ ...aiResponse, audio: null, voiceId: usedVoiceId, ttsModel: usedTtsModel });
        } else {
            try {
                const audioUrl = await textToSpeech(aiResponse.text, { voiceId: usedVoiceId, ttsModel: usedTtsModel });
                res.json({ ...aiResponse, audio: audioUrl, voiceId: usedVoiceId, ttsModel: usedTtsModel });
            } catch (ttsError) {
                console.error("TTS failed, sending response without audio:", ttsError.message);
                // Send response without audio if TTS fails
                res.json({ ...aiResponse, audio: null, voiceId: usedVoiceId, ttsModel: usedTtsModel, ttsError: ttsError.message });
            }
        }
    } catch (error) {
        console.error("Chat processing error:", error);
        res.status(500).json({ error: "Processing failed", details: error.message });
    }
});

// 2. VOICE CHAT ROUTE (Speech-to-Text)
app.post('/talk', upload.single('audio'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: "No audio file provided" });

        console.log("Received audio file size:", req.file.size, "mimetype:", req.file.mimetype);

        // A. Convert browser-recorded audio (often webm/ogg) into WAV mono PCM for Vosk
        const { spawnSync } = await import('child_process');
        if (!ffmpegPath) {
            return res.status(500).json({ error: 'FFmpeg not available', details: 'ffmpeg-static path is null' });
        }

        const base = `stt_${Date.now()}`;
        const inputExt = (req.file.mimetype || '').includes('ogg')
            ? 'ogg'
            : (req.file.mimetype || '').includes('webm')
                ? 'webm'
                : 'bin';

        const tempInput = path.join(__dirname, `${base}.${inputExt}`);
        const tempWav = path.join(__dirname, `${base}.wav`);
        fs.writeFileSync(tempInput, req.file.buffer);

        console.log('[stt] Converting audio to WAV...');
        const ff = spawnSync(
            ffmpegPath,
            ['-hide_banner', '-loglevel', 'error', '-y', '-i', tempInput, '-ac', '1', '-ar', '16000', '-f', 'wav', tempWav],
            { cwd: __dirname, timeout: 15000, maxBuffer: 10 * 1024 * 1024 }
        );
        fs.unlinkSync(tempInput);
        if (ff.error) throw new Error('Audio convert failed: ' + ff.error.message);
        if (ff.status !== 0 || !fs.existsSync(tempWav)) {
            const ffErr = ff.stderr?.toString()?.trim();
            throw new Error('Audio convert failed: ' + (ffErr || `ffmpeg exited with code ${ff.status}`));
        }

        console.log('[stt] Running Vosk STT...');

        // B. Use local Python STT (Vosk)
        const py = spawnSync(PYTHON_BIN, ['speech.py', 'stt', tempWav], { cwd: __dirname, timeout: 60000, maxBuffer: 10 * 1024 * 1024 });
        fs.unlinkSync(tempWav);
        if (py.error) throw new Error('STT failed: ' + py.error.message);
        if (py.status !== 0) {
            const stderr = py.stderr?.toString()?.trim();
            throw new Error('STT failed: ' + (stderr || `python exited with code ${py.status}`));
        }
        const userText = py.stdout.toString().trim();
        const detectedLanguage = 'en'; // pyttsx3/SpeechRecognition does not detect language
        console.log("User said:", userText, "| Detected language:", detectedLanguage);

        // If STT couldn't decode/transcribe, don't call Gemini (prevents misleading quota messages)
        if (!userText || userText === 'Could not understand audio' || userText.startsWith('STT error:')) {
            return res.status(400).json({
                error: 'Speech-to-text failed',
                details: userText || 'Empty transcript'
            });
        }

        // B. Process text with Gemini
        const sessionId = (req.body && req.body.sessionId) || 'default';
        const aiResponse = await processWithGemini(userText, sessionId);
        const usedVoiceId = (req.body && req.body.voiceId) || DEFAULT_VOICE_ID;
        const usedTtsModel = (req.body && req.body.ttsModel) || DEFAULT_TTS_MODEL;
        if (aiResponse.exhausted) {
            // If quota exhausted, do not attempt TTS, just return the message
            res.json({
                userText,
                ...aiResponse,
                audio: null,
                voiceId: usedVoiceId,
                ttsModel: usedTtsModel
            });
        } else {
            try {
                const audioUrl = await textToSpeech(aiResponse.text, { voiceId: usedVoiceId, ttsModel: usedTtsModel });
                res.json({
                    userText,
                    ...aiResponse,
                    audio: audioUrl,
                    voiceId: usedVoiceId,
                    ttsModel: usedTtsModel
                });
            } catch (ttsError) {
                console.error("TTS failed in voice route, sending response without audio:", ttsError.message);
                res.json({
                    userText,
                    ...aiResponse,
                    audio: null,
                    voiceId: usedVoiceId,
                    ttsModel: usedTtsModel,
                    ttsError: ttsError.message
                });
            }
        }

    } catch (error) {
        console.error("Voice processing error:", error.response ? error.response.data : error.message);
        res.status(500).json({ error: "Voice processing failed", details: error.message });
    }
});

// 3. List ElevenLabs voices to help choose a correct voice
app.get('/voices', async (req, res) => {
    try {
        const r = await axios.get('https://api.elevenlabs.io/v1/voices', {
            headers: { 'xi-api-key': ELEVENLABS_API_KEY }
        });
        res.json(r.data);
    } catch (error) {
        console.error('Failed to fetch voices:', error.response?.data || error.message);
        res.status(500).json({ error: 'Failed to fetch voices', details: error.message });
    }
});

// 4. Clear chat history for a session
app.post('/clear-history', (req, res) => {
    try {
        const { sessionId } = req.body;
        const id = sessionId || 'default';
        chatSessions.delete(id);
        res.json({ success: true, message: `Chat history cleared for session: ${id}` });
    } catch (error) {
        res.status(500).json({ error: 'Failed to clear history', details: error.message });
    }
});

// Debug: list available models
app.get('/models', async (req, res) => {
    try {
        const models = await genAI.listModels();
        res.json(models);
    } catch (error) {
        res.status(500).json({ error: 'Failed to list models', details: error.message });
    }
});

app.listen(3000, () => console.log("Server running on port 3000"));