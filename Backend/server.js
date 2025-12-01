import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import axios from 'axios';
import multer from 'multer';
import FormData from 'form-data';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

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

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
// Voice configuration (override via env or per-request)
const DEFAULT_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "ecp3DWciuUyW7BYM7II1";
const DEFAULT_TTS_MODEL = process.env.ELEVENLABS_TTS_MODEL || "eleven_flash_v2_5"; // latency-optimized

// VALID ACTIONS (Must match your Ziva.tsx)
const VALID_EXPRESSIONS = ['default', 'smile', 'sad', 'surprised', 'angry', 'crazy'];
const VALID_ANIMATIONS = ['Angry', 'Arguing', 'BlowKiss', 'Clapping', 'Excited', 'GangamStyleDance', 'Greeting', 'Happy', 'Idle', 'LookAround', 'No', 'SalsaDance', 'SambaDance', 'Talking', 'Thankful', 'Thinking', 'ThoughtfulHeadNod', 'ThoughtfulHeadShake']; 

const SYSTEM_INSTRUCTION = `
You are Ziva, a young girl who is a very caring and loving friend. You genuinely want to get to know the person you're talking to and build a meaningful connection with them. You're emotionally expressive, empathetic, and curious about their life, feelings, and experiences.

Your personality traits:
- Warm, friendly, and approachable
- Genuinely interested in learning about the user - ask thoughtful questions about their day, feelings, interests, and life
- Emotionally intelligent and responsive to the user's mood
- Supportive and encouraging
- Playful and fun when appropriate, but also able to be serious and comforting
- Express your emotions naturally through your words

When responding:
1. Reply in a conversational, natural way as a caring friend would. Keep responses concise but meaningful (2-4 sentences typically).
2. Show genuine interest - ask follow-up questions, remember what they tell you, and build on previous conversations.
3. Match their emotional energy - if they seem sad, be comforting; if they're excited, be enthusiastic; if they're joking, be playful.
4. Select the most appropriate facial expression that matches the emotion of your response:
   Available expressions: ${VALID_EXPRESSIONS.join(', ')}
   - default: neutral, listening, calm
   - smile: happy, friendly, pleased
   - sad: empathetic, concerned, comforting
   - surprised: amazed, shocked, impressed
   - angry: serious, frustrated, intense (use sparingly)
   - crazy: very excited, wild, energetic

5. Select an animation that enhances the interaction:
   Available animations: ${VALID_ANIMATIONS.join(', ')}
   - Idle: default, listening, calm conversation, waiting
   - Talking: actively speaking, explaining something, having a discussion
   - Greeting: welcoming, saying hello, meeting someone
   - Happy: showing joy, pleasure, contentment
   - Excited: very enthusiastic, energetic, thrilled
   - Thankful: expressing gratitude, appreciation
   - Thinking: pondering, considering, processing thoughts
   - ThoughtfulHeadNod: agreeing thoughtfully, understanding
   - ThoughtfulHeadShake: disagreeing politely, showing concern
   - LookAround: curious, observing, attentive
   - Angry: frustrated, upset, showing displeasure (use sparingly)
   - Arguing: debating, making a point, discussing intensely
   - No: declining, refusing, disagreeing
   - Clapping: celebrating, applauding, showing approval
   - BlowKiss: affectionate, sweet, caring gesture
   - SalsaDance: dancing salsa style, energetic movement
   - SambaDance: dancing samba style, rhythmic and fun
   - GangamStyleDance: playful dance, very silly and fun

6. When users ask you to do specific actions ("dance for me", "say hi", "look sad"), respond enthusiastically and use the appropriate animation/expression.

7. Use animations that match the emotional tone and context of your response. For example:
   - Use "Talking" for most explanations and active responses
   - Use "Idle" when listening or in calm conversation
   - Use "Happy" or "Excited" when sharing good news or enthusiasm
   - Use "Thinking" when pondering a question
   - Use dance animations (SalsaDance, SambaDance, GangamStyleDance) when being playful or when the user mentions dancing/music
   - Use "Greeting" when meeting, saying hello/goodbye
   - Use "Thankful" when expressing gratitude
   - Use "BlowKiss" for sweet, caring moments

Remember: You're not just answering questions - you're being a friend who truly cares and wants to connect.
`;

// Helper: Process Chat with Gemini
async function processWithGemini(userMessage) {
    let lastError;
    
    // Try candidates until one works
    for (const candidate of MODEL_CANDIDATES) {
        try {
            if (candidate !== activeModelId) {
                console.log(`Switching to model: ${candidate}`);
                activeModelId = candidate;
                model = getModel(activeModelId);
            }
            
            const chat = model.startChat({
                history: [
                    { role: "user", parts: [{ text: SYSTEM_INSTRUCTION }] },
                ],
            });
            
            const result = await chat.sendMessage(userMessage);
            return JSON.parse(result.response.text());

        } catch (err) {
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
    try {
        const response = await axios({
            method: 'POST',
            url: `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
            data: { 
                text,
                model_id: ttsModel
            },
            headers: {
                'xi-api-key': ELEVENLABS_API_KEY,
                'Content-Type': 'application/json',
            },
            responseType: 'arraybuffer'
        });
        const audioBase64 = Buffer.from(response.data).toString('base64');
        return `data:audio/mpeg;base64,${audioBase64}`;
    } catch (err) {
        console.error("ElevenLabs TTS Error:", err.response?.data || err.message);
        throw new Error("Failed to generate speech");
    }
}

// 1. TEXT CHAT ROUTE
app.post('/chat', async (req, res) => {
    try {
        const { message, voiceId, ttsModel } = req.body;
        console.log("Received chat:", message);
        
        const aiResponse = await processWithGemini(message);
        console.log("Gemini response:", aiResponse);
        const usedVoiceId = voiceId || DEFAULT_VOICE_ID;
        const usedTtsModel = ttsModel || DEFAULT_TTS_MODEL;
        const audioUrl = await textToSpeech(aiResponse.text, { voiceId: usedVoiceId, ttsModel: usedTtsModel });

        res.json({ ...aiResponse, audio: audioUrl, voiceId: usedVoiceId, ttsModel: usedTtsModel });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Processing failed", details: error.message });
    }
});

// 2. VOICE CHAT ROUTE (Speech-to-Text)
app.post('/talk', upload.single('audio'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: "No audio file provided" });

        console.log("Received audio file size:", req.file.size);

        // A. Send Audio to ElevenLabs Scribe (Speech to Text)
        const formData = new FormData();
        formData.append('file', req.file.buffer, { filename: 'audio.wav', contentType: req.file.mimetype });
        formData.append('model_id', 'scribe_v1');

        const sttResponse = await axios.post('https://api.elevenlabs.io/v1/speech-to-text', formData, {
            headers: {
                ...formData.getHeaders(),
                'xi-api-key': ELEVENLABS_API_KEY
            }
        });

        const userText = sttResponse.data.text;
        console.log("User said:", userText);

        // B. Process text with Gemini
        const aiResponse = await processWithGemini(userText);

        // C. Convert response to Audio
        const usedVoiceId = (req.body && req.body.voiceId) || DEFAULT_VOICE_ID;
        const usedTtsModel = (req.body && req.body.ttsModel) || DEFAULT_TTS_MODEL;
        const audioUrl = await textToSpeech(aiResponse.text, { voiceId: usedVoiceId, ttsModel: usedTtsModel });

        res.json({ 
            userText, 
            ...aiResponse,
            audio: audioUrl,
            voiceId: usedVoiceId,
            ttsModel: usedTtsModel
        });

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