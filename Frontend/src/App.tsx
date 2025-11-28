import { Canvas } from "@react-three/fiber";
import { Suspense, useState, useRef } from "react";
import { Experience } from "./components/Experience";

function App() {
  const [input, setInput] = useState("");
  const [chatHistory, setChatHistory] = useState<string[]>([]);
  
  // Ziva State
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [expression, setExpression] = useState("default");
  const [animation, setAnimation] = useState("Idle");
  
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
        body: JSON.stringify({ message: text }),
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
    setChatHistory(prev => [...prev, `Ziva: ${data.text}`]);
    setAudioUrl(data.audio);
    if(data.facialExpression) setExpression(data.facialExpression);
    if(data.animation) setAnimation(data.animation);
  };

  return (
    <>
      {/* UI Overlay */}
      <div className="absolute top-0 left-0 z-10 w-full p-4 flex flex-col items-center pointer-events-none">
        <div className="bg-white/90 p-4 rounded-xl shadow-xl pointer-events-auto w-full max-w-md backdrop-blur-sm">
          {/* Chat History */}
          <div className="h-48 overflow-y-auto mb-4 text-sm space-y-2 border-b pb-2 scrollbar-thin">
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
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type or speak..."
              disabled={loading || recording}
              onKeyDown={(e) => e.key === 'Enter' && handleSend(input)}
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
          <div className="text-xs text-gray-500 mt-2 text-center">
            Hold 🎤 to speak, release to send.
          </div>
        </div>
      </div>

      {/* 3D Scene */}
      <Canvas shadows camera={{ position: [0, 0, 5], fov: 30 }} className="h-screen w-full block bg-black">
        <Suspense fallback={null}>
          <Experience 
            audioUrl={audioUrl} 
            expression={expression} 
            animation={animation} 
          />
        </Suspense>
      </Canvas>
    </>
  );
}

export default App;