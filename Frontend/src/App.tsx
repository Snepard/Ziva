import { Canvas } from "@react-three/fiber";
import { Suspense, useState, useRef } from "react";
import { Experience } from "./components/Experience";

function App() {
  const VOICE_ID = (import.meta as any).env?.VITE_TTS_VOICE_ID as string | undefined;
  const TTS_MODEL = ((import.meta as any).env?.VITE_TTS_MODEL as string | undefined) || 'eleven_flash_v2_5';
  const [input, setInput] = useState("");
  const [chatHistory, setChatHistory] = useState<string[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [isHover, setIsHover] = useState(false);
  
  // Ziva State
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [expression, setExpression] = useState("default");
  const [animation, setAnimation] = useState("Idle");
  const [animationTrigger, setAnimationTrigger] = useState(0);
  
  const [loading, setLoading] = useState(false);
  const [recording, setRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);

  // ... (Keep your handleSend, startRecording, stopRecording, sendAudio functions exactly as they were) ...
  const handleSend = async (text: string) => {
    if (!text) return;
    setLoading(true);
    setChatHistory(prev => [...prev, `You: ${text}`]);

    try {
      const res = await fetch("http://localhost:3000/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          message: text,
          voiceId: VOICE_ID,
          ttsModel: TTS_MODEL
        }),
      });
      const data = await res.json();
      updateAvatarState(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setInput("");
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      const chunks: BlobPart[] = [];

      mediaRecorder.ondataavailable = (e) => chunks.push(e.data);
      mediaRecorder.onstop = async () => {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        await sendAudio(blob);
      };

      mediaRecorder.start();
      setRecording(true);
    } catch (err) {
      console.error("Microphone access denied", err);
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    setRecording(false);
  };

  const sendAudio = async (audioBlob: Blob) => {
    setLoading(true);
    const formData = new FormData();
    formData.append("audio", audioBlob);
    if (VOICE_ID) formData.append('voiceId', VOICE_ID);
    if (TTS_MODEL) formData.append('ttsModel', TTS_MODEL);

    try {
      const res = await fetch("http://localhost:3000/talk", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      
      setChatHistory(prev => [...prev, `You (Voice): ${data.userText}`]);
      updateAvatarState(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const updateAvatarState = (data: any) => {
    console.log("Received from backend:", data);
    setChatHistory(prev => [...prev, `Ziva: ${data.text}`]);
    setAudioUrl(data.audio);
    if(data.facialExpression) {
      console.log("Setting expression to:", data.facialExpression);
      setExpression(data.facialExpression);
    }
    if(data.animation) {
      console.log("Setting animation to:", data.animation);
      setAnimation(data.animation);
      setAnimationTrigger(prev => prev + 1); // Trigger animation replay
    }
  };

  const activeGlass = isTyping || isHover;

  return (
    <>
      {/* Chat Overlay */}
      <div 
        className="fixed bottom-4 left-4 z-10 pointer-events-none"
        onMouseEnter={() => setIsHover(true)}
        onMouseLeave={() => setIsHover(false)}
      >
        <div
          className={`pointer-events-auto w-[360px] p-4 rounded-xl border shadow-lg transition-colors duration-300 backdrop-blur-xl ${activeGlass ? 'bg-white/50 border-white/40' : 'bg-white/15 border-white/30'} hover:shadow-xl`}
        >
          {/* Chat History */}
          <div className="h-48 overflow-y-auto mb-4 text-sm space-y-2 border-b border-white/20 pb-2 scrollbar-thin">
             {chatHistory.map((msg, i) => (
               <div key={i} className={`p-2 rounded ${msg.startsWith("You") ? "bg-blue-50 text-right" : "bg-gray-50"}`}>
                 {msg}
               </div>
             ))}
             {loading && <div className="text-gray-500 italic text-xs animate-pulse">Ziva is thinking...</div>}
          </div>

          {/* Controls */}
          <div className="flex gap-2">
            <input 
              className="border p-2 rounded flex-1 focus:outline-none focus:ring-2 focus:ring-blue-400"
              value={input}
              onChange={(e) => {
                const v = e.target.value;
                setInput(v);
                setIsTyping(v.length > 0);
              }}
              placeholder="Type or speak..."
              disabled={loading || recording}
              onKeyDown={(e) => e.key === 'Enter' && handleSend(input)}
              onFocus={() => setIsTyping(true)}
              onBlur={() => setIsTyping(input.length > 0)}
            />
            
            <button 
              onMouseDown={startRecording}
              onMouseUp={stopRecording}
              className={`px-4 py-2 rounded text-white transition-colors ${recording ? 'bg-red-500 animate-pulse' : 'bg-blue-500 hover:bg-blue-600'}`}
              disabled={loading}
            >
              {recording ? '🛑' : '🎤'}
            </button>

            <button 
              onClick={() => handleSend(input)}
              className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded transition-colors"
              disabled={loading || recording}
            >
              Send
            </button>
          </div>
          <div className="text-xs text-gray-300 mt-2 text-center">
            Hold 🎤 to speak, release to send.
          </div>
        </div>
      </div>

      {/* 3D Scene */}
      <Canvas 
          shadows 
          camera={{ position: [0, 0.5, 2.5], fov: 30 }} 
          className="h-screen w-full block bg-black"
      >
        <Suspense fallback={null}>
          <Experience 
            audioUrl={audioUrl} 
            expression={expression} 
            animation={animation}
            animationTrigger={animationTrigger}
          />
        </Suspense>
      </Canvas>
    </>
  );
}

export default App;