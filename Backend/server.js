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
import { performance } from 'perf_hooks';
import { spawn } from 'child_process';

dotenv.config();

const PYTHON_BIN = process.env.PYTHON_BIN || 'python';
const USE_SPEECH_WORKER = process.env.USE_SPEECH_WORKER !== '0';

let _speechWorker = null;
let _speechWorkerStdoutBuf = '';
const _speechPending = new Map();

function _rejectAllSpeechPending(err) {
    for (const [, pending] of _speechPending) {
        clearTimeout(pending.timeout);
        pending.reject(err);
    }
    _speechPending.clear();
}

function _ensureSpeechWorker(trace = null) {
    if (!USE_SPEECH_WORKER) return null;
    if (_speechWorker && !_speechWorker.killed) return _speechWorker;

    _speechWorkerStdoutBuf = '';
    _speechWorker = spawn(PYTHON_BIN, ['speech.py', 'serve'], {
        cwd: __dirname,
        env: process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
    });

    _speechWorker.on('error', (err) => {
        logError(trace, 'speech-worker-error', err);
        _rejectAllSpeechPending(err);
    });

    _speechWorker.on('exit', (code, signal) => {
        const err = new Error(`speech worker exited (code=${code}, signal=${signal})`);
        logError(trace, 'speech-worker-exit', err);
        _rejectAllSpeechPending(err);
        _speechWorker = null;
    });

    _speechWorker.stderr.on('data', (chunk) => {
        // Keep this as console output; it can help diagnose model/download issues.
        // Avoid timestamps; Render may add its own.
        const msg = chunk.toString().trim();
        if (msg) console.warn('[speech-worker]', msg);
    });

    _speechWorker.stdout.on('data', (chunk) => {
        _speechWorkerStdoutBuf += chunk.toString();
        let idx;
        while ((idx = _speechWorkerStdoutBuf.indexOf('\n')) >= 0) {
            const line = _speechWorkerStdoutBuf.slice(0, idx).trim();
            _speechWorkerStdoutBuf = _speechWorkerStdoutBuf.slice(idx + 1);
            if (!line) continue;
            let msg;
            try {
                msg = JSON.parse(line);
            } catch {
                continue;
            }
            const id = msg && msg.id;
            if (!id) continue;
            const pending = _speechPending.get(id);
            if (!pending) continue;
            _speechPending.delete(id);
            clearTimeout(pending.timeout);
            if (msg.ok) pending.resolve(msg);
            else pending.reject(new Error(msg.error || 'speech worker error'));
        }
    });

    return _speechWorker;
}

function _speechRequest(payload, { timeoutMs = 60000 } = {}) {
    const worker = _ensureSpeechWorker();
    if (!worker) {
        return Promise.reject(new Error('Speech worker disabled/unavailable'));
    }

    const id = payload.id;
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            _speechPending.delete(id);
            reject(new Error(`speech worker timeout after ${timeoutMs}ms`));
        }, timeoutMs);

        _speechPending.set(id, { resolve, reject, timeout });
        try {
            worker.stdin.write(JSON.stringify(payload) + '\n');
        } catch (e) {
            clearTimeout(timeout);
            _speechPending.delete(id);
            reject(e);
        }
    });
}

// Live logging (console + optional browser stream via SSE)
const _logStreams = new Set();

function _truncate(s, max = 250) {
    if (typeof s !== 'string') return '';
    if (s.length <= max) return s;
    return s.slice(0, max) + `…(+${s.length - max} chars)`;
}

function _makeReqId(prefix = 'req') {
    const rand = Math.random().toString(16).slice(2, 8);
    return `${prefix}-${Date.now()}-${rand}`;
}

function _emitToBrowsers(evt) {
    const payload = JSON.stringify(evt);
    for (const client of _logStreams) {
        if (!client || client.writableEnded) continue;
        if (client.sessionId && evt.sessionId && client.sessionId !== evt.sessionId) continue;
        client.res.write(`event: log\n`);
        client.res.write(`data: ${payload}\n\n`);
    }
}

function logEvent(trace, stage, message, extra) {
    const reqId = trace?.reqId || 'req-unknown';
    const sessionId = trace?.sessionId || 'default';
    const parts = [`[${reqId}]`, `[session:${sessionId}]`, `[${stage}]`, message];
    if (extra !== undefined) {
        try {
            parts.push(JSON.stringify(extra));
        } catch {
            // ignore non-serializable extras
        }
    }
    console.log(parts.join(' '));

    _emitToBrowsers({
        level: 'info',
        reqId,
        sessionId,
        stage,
        message,
        extra,
    });
}

function logError(trace, stage, err, extra) {
    const msg = err?.message || String(err);
    const data = {
        message: msg,
        ...(err?.status ? { status: err.status } : {}),
        ...(extra || {}),
    };
    const reqId = trace?.reqId || 'req-unknown';
    const sessionId = trace?.sessionId || 'default';
    console.error(`[${reqId}] [session:${sessionId}] [${stage}]`, data);

    _emitToBrowsers({
        level: 'error',
        reqId,
        sessionId,
        stage,
        message: msg,
        extra: data,
    });
}

// Warm up TTS/STT models on startup so the first /talk request doesn't hang.
function warmupSpeechModels() {
    if (USE_SPEECH_WORKER) {
        try {
            _ensureSpeechWorker({ reqId: 'warmup', sessionId: 'default' });
            // Fire-and-forget warmup command
            _speechRequest({ id: _makeReqId('warmup'), cmd: 'warmup' }, { timeoutMs: 120000 }).catch(() => {});
            return;
        } catch {
            // fall back to old warmup below
        }
    }

    import('child_process')
        .then(({ spawn: _spawn }) => {
            const child = _spawn(PYTHON_BIN, ['speech.py', 'warmup'], {
                cwd: __dirname,
                stdio: 'inherit',
                env: process.env,
            });
            child.on('error', (err) => console.warn('[warmup] failed to start:', err.message));
        })
        .catch((err) => console.warn('[warmup] failed to import child_process:', err.message));
}

// Local Piper TTS voice (set via .env PIPER_VOICE, or override per request)
const DEFAULT_PIPER_VOICE = process.env.PIPER_VOICE || 'en_US-amy-low';
const DEFAULT_PIPER_STYLE = (process.env.PIPER_TTS_STYLE || 'default').toLowerCase();
const DEFAULT_PIPER_SPEAKER_ID = (process.env.PIPER_SPEAKER_ID !== undefined && process.env.PIPER_SPEAKER_ID !== '')
    ? Number(process.env.PIPER_SPEAKER_ID)
    : null;

const app = express();
app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true
}));
app.use(express.json());

// Live log stream for browser console (Server-Sent Events)
app.get('/logs/stream', (req, res) => {
    const sessionId = (req.query && req.query.sessionId) ? String(req.query.sessionId) : null;

    res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        // If behind proxies (nginx), this helps avoid buffering
        'X-Accel-Buffering': 'no',
    });

    // Initial comment to establish the stream
    res.write(': connected\n\n');

    const client = { res, sessionId };
    _logStreams.add(client);

    // Keepalive ping
    const keepAlive = setInterval(() => {
        if (res.writableEnded) return;
        res.write(': ping\n\n');
    }, 15000);

    req.on('close', () => {
        clearInterval(keepAlive);
        _logStreams.delete(client);
    });
});

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
async function processWithGemini(userMessage, sessionId = 'default', trace = null) {
    const t = trace ? { ...trace, sessionId: trace.sessionId || sessionId } : { reqId: _makeReqId('gemini'), sessionId };
    const startedAt = performance.now();
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
                logEvent(t, 'gemini-model-switch', `Switching to model: ${candidate}`);
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

            logEvent(t, 'gemini-send', 'Sending user text to Gemini', {
                model: candidate,
                textLen: (userMessage || '').length,
                preview: _truncate(userMessage || ''),
            });

            const result = await chat.sendMessage(userMessage);
            const response = JSON.parse(result.response.text());

            logEvent(t, 'gemini-received', 'Gemini response received', {
                model: candidate,
                durMs: Math.round((performance.now() - startedAt) * 10) / 10,
                responseTextLen: (response?.text || '').length,
                responsePreview: _truncate(response?.text || ''),
            });

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
            logError(t, 'gemini-failed', err, { model: candidate });
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

// Helper: Text to Speech (local Piper)
async function textToSpeech(text, { piperVoice = DEFAULT_PIPER_VOICE, piperStyle = DEFAULT_PIPER_STYLE, piperSpeakerId = DEFAULT_PIPER_SPEAKER_ID } = {}, trace = null) {
    const t = trace ? { ...trace } : { reqId: _makeReqId('tts'), sessionId: 'default' };
    const startedAt = performance.now();
    logEvent(t, 'tts-start', 'TTS started', {
        piperVoice,
        piperStyle,
        piperSpeakerId,
        textLen: (text || '').length,
        textPreview: _truncate(text || ''),
    });

    const tempFile = path.join(__dirname, `tts_${Date.now()}.wav`);

    if (USE_SPEECH_WORKER) {
        _ensureSpeechWorker(t);
        const id = _makeReqId('tts');
        await _speechRequest(
            {
                id,
                cmd: 'tts',
                text,
                output_path: tempFile,
                voice: piperVoice,
                style: piperStyle,
                speaker_id: (piperSpeakerId !== null && piperSpeakerId !== undefined && !Number.isNaN(Number(piperSpeakerId)))
                    ? Number(piperSpeakerId)
                    : null,
            },
            { timeoutMs: 120000 }
        );
    } else {
        // Fallback: one-shot python call (slower; reloads models each request)
        const { spawnSync } = await import('child_process');
        const args = ['speech.py', 'tts', text, tempFile];
        if (piperVoice) args.push(piperVoice);
        if (piperStyle) args.push(piperStyle);
        if (piperSpeakerId !== null && piperSpeakerId !== undefined && !Number.isNaN(Number(piperSpeakerId))) {
            args.push(String(Number(piperSpeakerId)));
        }
        const py = spawnSync(PYTHON_BIN, args, { cwd: __dirname, env: { ...process.env, PIPER_VOICE: piperVoice } });
        if (py.error) throw new Error('TTS failed: ' + py.error.message);
        if (py.status !== 0) {
            const stderr = py.stderr?.toString()?.trim();
            throw new Error('TTS failed: ' + (stderr || `python exited with code ${py.status}`));
        }
    }

    if (!fs.existsSync(tempFile)) throw new Error('TTS audio file not created');
    const audioBuffer = fs.readFileSync(tempFile);
    fs.unlinkSync(tempFile);
    const audioBase64 = audioBuffer.toString('base64');

    logEvent(t, 'tts-complete', 'TTS complete', {
        durMs: Math.round((performance.now() - startedAt) * 10) / 10,
        wavBytes: audioBuffer.length,
        base64Len: audioBase64.length,
    });

    return `data:audio/wav;base64,${audioBase64}`;
}

// List downloaded Piper voices on disk
app.get('/tts/voices', (req, res) => {
    try {
        const modelsDir = process.env.PIPER_MODELS_DIR
            ? path.resolve(process.env.PIPER_MODELS_DIR)
            : path.resolve(__dirname, 'models', 'piper');

        let voices = [];
        if (fs.existsSync(modelsDir)) {
            voices = fs
                .readdirSync(modelsDir)
                .filter((f) => f.endsWith('.onnx'))
                .map((f) => f.replace(/\.onnx$/i, ''))
                .sort();
        }

        res.json({
            defaultVoice: DEFAULT_PIPER_VOICE,
            defaultStyle: DEFAULT_PIPER_STYLE,
            defaultSpeakerId: DEFAULT_PIPER_SPEAKER_ID,
            modelsDir,
            voices,
        });
    } catch (e) {
        res.status(500).json({ error: 'Failed to list voices', details: e.message });
    }
});

// 1. TEXT CHAT ROUTE
app.post('/chat', async (req, res) => {
    const sessionId = (req.body && req.body.sessionId) || 'default';
    const trace = { reqId: _makeReqId('chat'), sessionId };
    const startedAt = performance.now();
    try {
        const { message, piperVoice, piperStyle, piperSpeakerId } = req.body;
        logEvent(trace, 'chat-received', 'Chat received', {
            textLen: (message || '').length,
            preview: _truncate(message || ''),
        });
        
        const aiResponse = await processWithGemini(message, sessionId, trace);
        logEvent(trace, 'chat-gemini-done', 'Gemini processing complete', {
            durMs: Math.round((performance.now() - startedAt) * 10) / 10,
        });

        const usedPiperVoice = (piperVoice || DEFAULT_PIPER_VOICE);
        const usedPiperStyle = (piperStyle || DEFAULT_PIPER_STYLE);
        const usedPiperSpeakerId = (piperSpeakerId !== undefined && piperSpeakerId !== null && piperSpeakerId !== '')
            ? Number(piperSpeakerId)
            : DEFAULT_PIPER_SPEAKER_ID;
        
        if (aiResponse.exhausted) {
            // If quota exhausted, do not attempt TTS, just return the message
            res.json({ ...aiResponse, audio: null, piperVoice: usedPiperVoice, piperStyle: usedPiperStyle, piperSpeakerId: usedPiperSpeakerId });
        } else {
            try {
                logEvent(trace, 'tts-requested', 'Starting TTS for Gemini response', {
                    piperVoice: usedPiperVoice,
                    piperStyle: usedPiperStyle,
                    piperSpeakerId: usedPiperSpeakerId,
                    textLen: (aiResponse?.text || '').length,
                    textPreview: _truncate(aiResponse?.text || ''),
                });
                const audioUrl = await textToSpeech(aiResponse.text, { piperVoice: usedPiperVoice, piperStyle: usedPiperStyle, piperSpeakerId: usedPiperSpeakerId }, trace);
                logEvent(trace, 'chat-complete', 'Chat completed with audio', {
                    totalDurMs: Math.round((performance.now() - startedAt) * 10) / 10,
                    audioDataUrlLen: (audioUrl || '').length,
                });
                res.json({ ...aiResponse, audio: audioUrl, piperVoice: usedPiperVoice, piperStyle: usedPiperStyle, piperSpeakerId: usedPiperSpeakerId });
            } catch (ttsError) {
                logError(trace, 'tts-failed', ttsError);
                // Send response without audio if TTS fails
                res.json({ ...aiResponse, audio: null, piperVoice: usedPiperVoice, piperStyle: usedPiperStyle, piperSpeakerId: usedPiperSpeakerId, ttsError: ttsError.message });
            }
        }
    } catch (error) {
        logError(trace, 'chat-error', error);
        res.status(500).json({ error: "Processing failed", details: error.message });
    }
});

// 2. VOICE CHAT ROUTE (Speech-to-Text)
app.post('/talk', upload.single('audio'), async (req, res) => {
    const sessionId = (req.body && req.body.sessionId) || 'default';
    const trace = { reqId: _makeReqId('talk'), sessionId };
    const startedAt = performance.now();
    try {
        if (!req.file) return res.status(400).json({ error: "No audio file provided" });

        logEvent(trace, 'audio-received', 'Audio received', {
            size: req.file.size,
            mimetype: req.file.mimetype,
            fieldname: req.file.fieldname,
        });

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

        const sttConvertStartedAt = performance.now();
        logEvent(trace, 'stt-convert-start', 'Converting audio to WAV', {
            inputExt,
        });
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

        logEvent(trace, 'stt-convert-complete', 'Audio conversion complete', {
            durMs: Math.round((performance.now() - sttConvertStartedAt) * 10) / 10,
        });

        const sttStartedAt = performance.now();
        logEvent(trace, 'stt-start', 'Running Vosk STT');

        // B. Use local Python STT (Vosk)
        let userText = '';
        try {
            if (USE_SPEECH_WORKER) {
                _ensureSpeechWorker(trace);
                const id = _makeReqId('stt');
                const resp = await _speechRequest({ id, cmd: 'stt', audio_path: tempWav }, { timeoutMs: 60000 });
                userText = (resp && resp.text ? String(resp.text) : '').trim();
            } else {
                const py = spawnSync(PYTHON_BIN, ['speech.py', 'stt', tempWav], { cwd: __dirname, timeout: 60000, maxBuffer: 10 * 1024 * 1024 });
                if (py.error) throw new Error('STT failed: ' + py.error.message);
                if (py.status !== 0) {
                    const stderr = py.stderr?.toString()?.trim();
                    throw new Error('STT failed: ' + (stderr || `python exited with code ${py.status}`));
                }
                userText = py.stdout.toString().trim();
            }
        } finally {
            try { fs.unlinkSync(tempWav); } catch { }
        }
        const detectedLanguage = 'en'; // pyttsx3/SpeechRecognition does not detect language

        logEvent(trace, 'stt-complete', 'STT complete', {
            durMs: Math.round((performance.now() - sttStartedAt) * 10) / 10,
            detectedLanguage,
            textLen: (userText || '').length,
            transcript: userText,
        });

        // If STT couldn't decode/transcribe, don't call Gemini (prevents misleading quota messages)
        if (!userText || userText === 'Could not understand audio' || userText.startsWith('STT error:')) {
            logEvent(trace, 'stt-rejected', 'STT produced unusable transcript', { transcript: userText });
            return res.status(400).json({
                error: 'Speech-to-text failed',
                details: userText || 'Empty transcript'
            });
        }

        // B. Process text with Gemini
        logEvent(trace, 'gemini-request', 'Sending transcript to Gemini', {
            textLen: (userText || '').length,
            transcriptPreview: _truncate(userText || ''),
        });
        const aiResponse = await processWithGemini(userText, sessionId, trace);
        const usedPiperVoice = (req.body && req.body.piperVoice) || DEFAULT_PIPER_VOICE;
        const usedPiperStyle = (req.body && req.body.piperStyle) || DEFAULT_PIPER_STYLE;
        if (aiResponse.exhausted) {
            // If quota exhausted, do not attempt TTS, just return the message
            logEvent(trace, 'voice-complete', 'Voice request complete (quota exhausted; no TTS)', {
                totalDurMs: Math.round((performance.now() - startedAt) * 10) / 10,
            });
            res.json({
                userText,
                ...aiResponse,
                audio: null,
                piperVoice: usedPiperVoice,
                piperStyle: usedPiperStyle
            });
        } else {
            try {
                logEvent(trace, 'tts-requested', 'Starting TTS for Gemini response', {
                    piperVoice: usedPiperVoice,
                    piperStyle: usedPiperStyle,
                    textLen: (aiResponse?.text || '').length,
                    textPreview: _truncate(aiResponse?.text || ''),
                });
                const audioUrl = await textToSpeech(aiResponse.text, { piperVoice: usedPiperVoice, piperStyle: usedPiperStyle }, trace);
                logEvent(trace, 'voice-complete', 'Voice request complete (with audio)', {
                    totalDurMs: Math.round((performance.now() - startedAt) * 10) / 10,
                    audioDataUrlLen: (audioUrl || '').length,
                });
                res.json({
                    userText,
                    ...aiResponse,
                    audio: audioUrl,
                    piperVoice: usedPiperVoice,
                    piperStyle: usedPiperStyle
                });
            } catch (ttsError) {
                logError(trace, 'tts-failed', ttsError);
                res.json({
                    userText,
                    ...aiResponse,
                    audio: null,
                    piperVoice: usedPiperVoice,
                    piperStyle: usedPiperStyle,
                    ttsError: ttsError.message
                });
            }
        }

    } catch (error) {
        logError(trace, 'voice-error', error, {
            responseData: error?.response?.data,
        });
        res.status(500).json({ error: "Voice processing failed", details: error.message });
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

// 5. TTS ONLY ROUTE (no Gemini) - useful for intro/testing
app.post('/tts', async (req, res) => {
    const sessionId = (req.body && req.body.sessionId) || 'default';
    const trace = { reqId: _makeReqId('ttsroute'), sessionId };
    try {
        const { text, piperVoice, piperStyle, piperSpeakerId } = req.body || {};
        if (!text || typeof text !== 'string') {
            return res.status(400).json({ error: 'Missing text' });
        }

        const usedPiperVoice = (piperVoice || DEFAULT_PIPER_VOICE);
        const usedPiperStyle = (piperStyle || DEFAULT_PIPER_STYLE);
        const usedPiperSpeakerId = (piperSpeakerId !== undefined && piperSpeakerId !== null && piperSpeakerId !== '')
            ? Number(piperSpeakerId)
            : DEFAULT_PIPER_SPEAKER_ID;

        logEvent(trace, 'tts-requested', 'TTS-only request received', {
            piperVoice: usedPiperVoice,
            piperStyle: usedPiperStyle,
            piperSpeakerId: usedPiperSpeakerId,
            textLen: text.length,
            textPreview: _truncate(text),
        });

        const audioUrl = await textToSpeech(text, {
            piperVoice: usedPiperVoice,
            piperStyle: usedPiperStyle,
            piperSpeakerId: usedPiperSpeakerId,
        }, trace);

        res.json({ audio: audioUrl, piperVoice: usedPiperVoice, piperStyle: usedPiperStyle, piperSpeakerId: usedPiperSpeakerId });
    } catch (e) {
        logError(trace, 'tts-only-error', e);
        res.status(500).json({ error: 'TTS failed', details: e.message });
    }
});

app.listen(3000, () => console.log("Server running on port 3000"));