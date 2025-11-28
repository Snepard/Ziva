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
// Replace with your preferred voice ID if needed
const VOICE_ID = "21m00Tcm4TlvDq8ikWAM"; 

// VALID ACTIONS (Must match your Ziva.tsx)
const VALID_EXPRESSIONS = ['default', 'smile', 'funnyFace', 'sad', 'surprised', 'angry', 'crazy'];
const VALID_ANIMATIONS = ['Idle', 'Talking', 'Dancing', 'Greeting']; 

const SYSTEM_INSTRUCTION = `
You are Ziva, a friendly 3D avatar. 
1. Reply to the user's message in a conversational, concise way.
2. Select the most appropriate facial expression from this list: ${VALID_EXPRESSIONS.join(', ')}.
3. Select an animation from this list: ${VALID_ANIMATIONS.join(', ')}.
4. If the user explicitly asks for an action (e.g. "Dance for me", "Look angry"), prioritize that.
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
async function textToSpeech(text) {
    try {
        const response = await axios({
            method: 'POST',
            url: `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`,
            data: { 
                text, 
                model_id: "eleven_flash_v2_5" // Use Flash for lower latency
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
        const { message } = req.body;
        console.log("Received chat:", message);
        
        const aiResponse = await processWithGemini(message);
        console.log("Gemini response:", aiResponse);
        
        const audioUrl = await textToSpeech(aiResponse.text);

        res.json({ ...aiResponse, audio: audioUrl });
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
        const audioUrl = await textToSpeech(aiResponse.text);

        res.json({ 
            userText, 
            ...aiResponse, 
            audio: audioUrl 
        });

    } catch (error) {
        console.error("Voice processing error:", error.response ? error.response.data : error.message);
        res.status(500).json({ error: "Voice processing failed", details: error.message });
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