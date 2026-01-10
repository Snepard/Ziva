import { Canvas } from "@react-three/fiber";
import { Suspense, useState, useRef, useEffect } from "react";
import { Experience } from "./components/Experience";

function App() {
  const VOICE_ID = (import.meta as any).env?.VITE_TTS_VOICE_ID as string | undefined;
  const TTS_MODEL = ((import.meta as any).env?.VITE_TTS_MODEL as string | undefined) || 'eleven_flash_v2_5';
  
  // Generate a unique session ID on mount
  const [sessionId] = useState(() => `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`);
  
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
    
    // Clear input immediately
    const messageToSend = text;
    setInput("");
    setIsTyping(false);
    
    // Set thinking animation
    setAnimation("Thinking");
    setAnimationTrigger(prev => prev + 1);
    
    setLoading(true);
    setChatHistory(prev => [...prev, `You: ${messageToSend}`]);

    try {
      const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          message: messageToSend,
          voiceId: VOICE_ID,
          ttsModel: TTS_MODEL,
          sessionId: sessionId
        }),
      });
      const data = await res.json();
      updateAvatarState(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
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
    // Set thinking animation
    setAnimation("Thinking");
    setAnimationTrigger(prev => prev + 1);
    
    setLoading(true);
    const formData = new FormData();
    formData.append("audio", audioBlob);
    if (VOICE_ID) formData.append('voiceId', VOICE_ID);
    if (TTS_MODEL) formData.append('ttsModel', TTS_MODEL);
    formData.append('sessionId', sessionId);

    try {
      const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/talk`, {
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

  return (
    <>
      {/* Chat Overlay */}
      <div className="fixed bottom-6 left-6 z-10 w-[420px]">
        <div className="bg-linear-to-br from-slate-900/95 to-slate-800/95 backdrop-blur-2xl rounded-2xl border border-slate-700/50 shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="bg-linear-to-r from-blue-600 to-purple-600 px-5 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-2.5 h-2.5 bg-green-400 rounded-full animate-pulse"></div>
              <span className="text-white font-semibold text-sm">Ziva</span>
            </div>
            <div className="text-white/70 text-xs">Online</div>
          </div>

          {/* Chat History */}
          <div className="h-80 overflow-y-auto p-4 space-y-3 scrollbar-thin scrollbar-thumb-slate-600 scrollbar-track-transparent">
            {chatHistory.map((msg, i) => {
              const isUser = msg.startsWith("You");
              const cleanMsg = msg.replace(/^(You:|You \(Voice\):|Ziva:)\s*/, '');
              
              return (
                <div key={i} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[75%] px-4 py-2.5 rounded-2xl ${
                    isUser 
                      ? 'bg-linear-to-r from-blue-500 to-blue-600 text-white rounded-br-md' 
                      : 'bg-slate-700/80 text-slate-100 rounded-bl-md'
                  } shadow-lg`}>
                    <p className="text-sm leading-relaxed">{cleanMsg}</p>
                  </div>
                </div>
              );
            })}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-slate-700/80 px-4 py-2.5 rounded-2xl rounded-bl-md shadow-lg">
                  <div className="flex gap-1.5">
                    <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                    <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                    <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Input Area */}
          <div className="p-4 bg-slate-800/50 border-t border-slate-700/50">
            <div className="flex gap-2">
              <input 
                className="flex-1 bg-slate-700/50 text-white placeholder-slate-400 px-4 py-3 rounded-xl border border-slate-600/50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                value={input}
                onChange={(e) => {
                  const v = e.target.value;
                  setInput(v);
                  setIsTyping(v.length > 0);
                }}
                placeholder="Type a message..."
                disabled={loading || recording}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend(input)}
              />
              
              <button 
                onMouseDown={startRecording}
                onMouseUp={stopRecording}
                className={`px-4 py-3 rounded-xl transition-all font-medium ${
                  recording 
                    ? 'bg-red-500 hover:bg-red-600 text-white animate-pulse shadow-lg shadow-red-500/50' 
                    : 'bg-slate-700 hover:bg-slate-600 text-white'
                }`}
                disabled={loading}
                title="Hold to record"
              >
                {recording ? '⏹' : '🎤'}
              </button>

              <button 
                onClick={() => handleSend(input)}
                className="bg-linear-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white px-5 py-3 rounded-xl transition-all font-medium shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={loading || recording || !input.trim()}
              >
                Send
              </button>
            </div>
            <div className="text-xs text-slate-400 mt-2 text-center">
              Hold 🎤 to speak • Press Enter to send
            </div>
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