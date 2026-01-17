import { Canvas } from "@react-three/fiber";
import { Suspense, useEffect, useState, useRef } from "react";
import { Experience } from "./components/Experience";
import { Toaster, toast } from "react-hot-toast";

const FACIAL_EXPRESSIONS = ['default', 'smile', 'sad', 'surprised', 'angry', 'crazy'] as const;
const ANIMATIONS = [
  'Angry',
  'Arguing',
  'BlowKiss',
  'Clapping',
  'Excited',
  'GangamStyleDance',
  'Greeting',
  'Happy',
  'Idle',
  'LookAround',
  'No',
  'SalsaDance',
  'SambaDance',
  'Talking',
  'Thankful',
  'Thinking',
  'ThoughtfulHeadNod',
  'ThoughtfulHeadShake',
] as const;

const INTRO_AUDIO_PATH = '/audio/intro.mp3';

function App() {
  const VOICE_ID = (import.meta as any).env?.VITE_TTS_VOICE_ID as string | undefined;
  const TTS_MODEL = ((import.meta as any).env?.VITE_TTS_MODEL as string | undefined) || 'eleven_flash_v2_5';
  
  // Generate a unique session ID on mount
  const [sessionId] = useState(() => `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`);
  
  const [input, setInput] = useState("");
  const [chatHistory, setChatHistory] = useState<string[]>([]);
  // Removed unused: isTyping, setIsTyping
  // Removed unused: isHover, setIsHover
  
  // Ziva State
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [expression, setExpression] = useState("default");
  const [expressionTrigger, setExpressionTrigger] = useState(0);
  const [animation, setAnimation] = useState("Idle");
  const [animationTrigger, setAnimationTrigger] = useState(0);
  const [pipelineStage, setPipelineStage] = useState<string>('');
  
  const [loading, setLoading] = useState(false);
  const [recording, setRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const didAutoIntroRef = useRef(false);

  // Mobile UX: allow collapsing the chat overlay so the model stays visible.
  const [isMobile, setIsMobile] = useState(false);
  const [isChatHiddenMobile, setIsChatHiddenMobile] = useState(false);
  const didUserToggleChatRef = useRef(false);

  const playIntro = async () => {
    // Small "hello" animation for first load + manual testing.
    setExpression('smile');
    setExpressionTrigger(prev => prev + 1);
    setAnimation('Greeting');
    setAnimationTrigger(prev => prev + 1);
    setChatHistory(prev => {
      // avoid duplicating intro message too aggressively
      if (prev.some(m => m.startsWith('Ziva: Hey, I am Ziva!!'))) return prev;
      return ['Ziva: Hey, I am Ziva!! Your Virtual Friend.', ...prev];
    });

    // Play pre-generated intro audio from the frontend public folder.
    // Cache-bust so clicking "Play intro" replays reliably.
    setAudioUrl(`${INTRO_AUDIO_PATH}?v=${Date.now()}`);
  };

  useEffect(() => {
    // React 18 StrictMode runs effects twice in dev; guard so intro only triggers once.
    if (didAutoIntroRef.current) return;
    didAutoIntroRef.current = true;
    void playIntro();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const mql = window.matchMedia('(max-width: 639px)'); // Tailwind sm breakpoint is 640px
    const update = () => {
      const mobileNow = mql.matches;
      setIsMobile(mobileNow);
      // Default to hidden on mobile (unless user explicitly toggled).
      if (mobileNow && !didUserToggleChatRef.current) setIsChatHiddenMobile(true);
      if (!mobileNow) setIsChatHiddenMobile(false);
    };

    update();
    // Safari compatibility: use addListener/removeListener when needed.
    if ('addEventListener' in mql) {
      mql.addEventListener('change', update);
      return () => mql.removeEventListener('change', update);
    }
    // @ts-ignore
    mql.addListener(update);
    // @ts-ignore
    return () => mql.removeListener(update);
  }, []);

  // Stream backend pipeline logs live to the browser console
  useEffect(() => {
    const baseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined) || '';
    if (!baseUrl) return;

    const streamUrl = `${baseUrl}/logs/stream?sessionId=${encodeURIComponent(sessionId)}`;
    const es = new EventSource(streamUrl);

    const onLog = (ev: MessageEvent) => {
      try {
        const payload = JSON.parse(ev.data);
        const prefix = `[${payload.reqId}] [session:${payload.sessionId}] [${payload.stage}]`;

        const stage = String(payload.stage || '');
        if (stage) setPipelineStage(stage);

        // Map backend stages to UX toasts
        const toastId = payload?.reqId ? `${payload.reqId}:${stage}` : undefined;
        const quickPromise = new Promise<void>((resolve) => window.setTimeout(resolve, 350));

        if (stage === 'audio-received') {
          toast.promise(
            quickPromise,
            {
              loading: 'Receiving speech...',
              success: <b>Speech received!</b>,
              error: <b>Could not save.</b>,
            },
            toastId ? { id: toastId } : undefined
          );
        }
        if (stage === 'stt-complete') {
          toast.promise(
            quickPromise,
            {
              loading: 'Converting speech to text...',
              success: <b>Speech converted to text!</b>,
              error: <b>Could not save.</b>,
            },
            toastId ? { id: toastId } : undefined
          );
        }
        if (stage === 'gemini-received') {
          toast.promise(
            quickPromise,
            {
              loading: 'Waiting for AI response...',
              success: <b>AI agent response received!</b>,
              error: <b>Could not save.</b>,
            },
            toastId ? { id: toastId } : undefined
          );
        }
        if (stage === 'tts-complete') {
          toast.promise(
            quickPromise,
            {
              loading: 'Generating speech...',
              success: <b>Text to speech complete!</b>,
              error: <b>Could not save.</b>,
            },
            toastId ? { id: toastId } : undefined
          );
        }

        if (payload.level === 'error') {
          console.error(prefix, payload.message, payload.extra);
        }
      } catch {
        // ignore malformed SSE payloads
      }
    };

    es.addEventListener('log', onLog as any);
    es.onerror = () => {
      // Keep quiet; EventSource will auto-reconnect.
    };

    return () => {
      es.removeEventListener('log', onLog as any);
      es.close();
    };
  }, [sessionId]);

  // Smooth avatar animations while processing (fallback loop)
  useEffect(() => {
    if (!loading) return;

    // Cycle through a few "processing" animations so Ziva feels alive.
    const processingAnims: Array<(typeof ANIMATIONS)[number]> = [
      'Thinking',
      'LookAround',
      'ThoughtfulHeadNod',
    ];

    let i = 0;
    const tick = () => {
      // If a specific pipeline stage is driving animation (handled below), don't fight it.
      if (pipelineStage) return;
      setAnimation(processingAnims[i % processingAnims.length]);
      setAnimationTrigger((prev) => prev + 1);
      i++;
    };

    // Start immediately, then loop.
    tick();
    const timer = window.setInterval(tick, 2600);
    return () => window.clearInterval(timer);
  }, [loading, pipelineStage]);

  // Pipeline stage -> animation mapping (more "appropriate" transitions)
  useEffect(() => {
    if (!loading) return;
    if (!pipelineStage) return;

    const stageToAnim: Record<string, (typeof ANIMATIONS)[number]> = {
      'audio-received': 'LookAround',
      'stt-convert-start': 'LookAround',
      'stt-start': 'LookAround',
      'stt-complete': 'Thinking',
      'gemini-request': 'Thinking',
      'gemini-send': 'Thinking',
      'gemini-received': 'ThoughtfulHeadNod',
      'tts-requested': 'Talking',
      'tts-start': 'Talking',
      'tts-complete': 'Talking',
    };

    const next = stageToAnim[pipelineStage];
    if (!next) return;

    setAnimation(next);
    setAnimationTrigger((prev) => prev + 1);
  }, [loading, pipelineStage]);

  // ... (Keep your handleSend, startRecording, stopRecording, sendAudio functions exactly as they were) ...
  const handleSend = async (text: string) => {
    if (!text) return;
    
    // Clear input immediately
    const messageToSend = text;
    setInput("");
    // setIsTyping(false); // removed unused
    
    // Set thinking animation
    setAnimation("Thinking");
    setAnimationTrigger(prev => prev + 1);

    // Clear any previous stage so the fallback loop can run until we get new SSE events.
    setPipelineStage('');
    
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
          sessionId: sessionId,
          availableFacialExpressions: FACIAL_EXPRESSIONS,
          availableAnimations: ANIMATIONS,
        }),
      });
      if (res.status === 401) {
        const err = await res.json();
        if (err.status === 'detected_unusual_activity') {
          setChatHistory(prev => [...prev, "Ziva: Unusual activity detected. Please switch your WiFi or network and try again."]);
          return;
        }
      }
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
      // "Listening" vibe while recording
      setAnimation('LookAround');
      setAnimationTrigger((prev) => prev + 1);

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

    setPipelineStage('');
    
    setLoading(true);
    const formData = new FormData();
    formData.append("audio", audioBlob);
    if (VOICE_ID) formData.append('voiceId', VOICE_ID);
    if (TTS_MODEL) formData.append('ttsModel', TTS_MODEL);
    formData.append('sessionId', sessionId);
    formData.append('availableFacialExpressions', JSON.stringify(FACIAL_EXPRESSIONS));
    formData.append('availableAnimations', JSON.stringify(ANIMATIONS));

    try {
      const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/talk`, {
        method: "POST",
        body: formData,
      });
      if (res.status === 401) {
        const err = await res.json();
        if (err.status === 'detected_unusual_activity') {
          setChatHistory(prev => [...prev, "Ziva: Unusual activity detected. Please switch your WiFi or network and try again."]);
          return;
        }
      }

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Request failed' }));
        setChatHistory(prev => [...prev, `Ziva: ${err.details || err.error || 'Voice request failed'}`]);
        return;
      }
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
    if(data.facialExpression) {
      setExpression(data.facialExpression);
      setExpressionTrigger(prev => prev + 1);
    }
    if(data.animation) {
      setAnimation(data.animation);
      setAnimationTrigger(prev => prev + 1); // Trigger animation replay
    }
  };

  return (
    <>
      {/* Toasts */}
      <div>
        <Toaster
          position="top-left"
          reverseOrder={false}
          toastOptions={{
            duration: 2200,
            style: {
              background: 'rgba(255, 255, 255, 0.10)',
              color: '#ffffff',
              border: '1px solid rgba(255, 255, 255, 0.28)',
              padding: '10px 12px',
              borderRadius: '12px',
              fontSize: '12px',
              lineHeight: '1.15',
              maxWidth: '260px',
              boxShadow: '0 12px 30px rgba(0,0,0,0.25)',
              backdropFilter: 'blur(14px)',
              WebkitBackdropFilter: 'blur(14px)',
            },
          }}
        />
      </div>

      {/* Chat Overlay */}
      {isMobile && isChatHiddenMobile ? (
        <div className="fixed bottom-4 left-4 z-10 flex items-center gap-2">
          <button
            onClick={() => {
              if (recording) {
                stopRecording();
              } else {
                startRecording();
              }
            }}
            className={`px-4 py-3 rounded-xl transition-all font-medium ${
              recording
                ? 'bg-red-500 hover:bg-red-600 text-white animate-pulse shadow-lg shadow-red-500/50'
                : 'bg-slate-800/80 hover:bg-slate-700/80 text-white'
            } border border-slate-700/60 backdrop-blur-xl`}
            disabled={loading}
            title={recording ? 'Stop recording' : 'Start recording'}
            type="button"
          >
            {recording ? '⏹' : '🎤'}
          </button>

          <button
            onClick={() => {
              didUserToggleChatRef.current = true;
              setIsChatHiddenMobile(false);
            }}
            className="px-4 py-3 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 text-white border border-slate-700/60 backdrop-blur-xl"
            type="button"
          >
            Chat
          </button>
        </div>
      ) : (
        <div className="fixed bottom-4 left-4 right-4 z-10 w-auto sm:bottom-6 sm:left-6 sm:right-auto sm:w-[420px]">
          <div className="bg-linear-to-br from-slate-900/95 to-slate-800/95 backdrop-blur-2xl rounded-2xl border border-slate-700/50 shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="bg-linear-to-r from-blue-600 to-purple-600 px-4 py-2 flex items-center justify-between sm:px-5 sm:py-2.5">
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse sm:w-2.5 sm:h-2.5"></div>
                <span className="text-white font-semibold text-xs sm:text-sm">Ziva</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="text-white/70 text-[10px] sm:text-xs">Online</div>
                <button
                  onClick={() => {
                    didUserToggleChatRef.current = true;
                    setIsChatHiddenMobile(true);
                  }}
                  className="sm:hidden w-7 h-7 grid place-items-center rounded-lg bg-white/15 hover:bg-white/20 text-white"
                  type="button"
                  aria-label="Hide chat"
                  title="Hide chat"
                >
                  ▾
                </button>
              </div>
            </div>

          {/* Avatar test dropdown (hide on mobile to keep model visible) */}
          <div className="hidden sm:block px-4 py-3 border-b border-slate-700/40 bg-slate-900/40">
            <details className="select-none">
              <summary className="cursor-pointer text-xs text-slate-200/90 font-medium">Avatar tester (expressions / animations)</summary>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="col-span-2">
                  <button
                    onClick={playIntro}
                    className="w-full bg-slate-700/60 hover:bg-slate-700 text-white text-xs px-3 py-2 rounded-lg border border-slate-600/40"
                    type="button"
                  >
                    Play intro
                  </button>
                </div>

                <label className="text-xs text-slate-300 flex flex-col gap-1">
                  Expression
                  <select
                    className="bg-slate-800/60 text-slate-100 px-3 py-2 rounded-lg border border-slate-600/40"
                    value={expression}
                    onChange={(e) => {
                      setExpression(e.target.value);
                      setExpressionTrigger(prev => prev + 1);
                    }}
                  >
                    {FACIAL_EXPRESSIONS.map((exp) => (
                      <option key={exp} value={exp}>{exp}</option>
                    ))}
                  </select>
                </label>

                <label className="text-xs text-slate-300 flex flex-col gap-1">
                  Animation
                  <select
                    className="bg-slate-800/60 text-slate-100 px-3 py-2 rounded-lg border border-slate-600/40"
                    value={animation}
                    onChange={(e) => {
                      setAnimation(e.target.value);
                      setAnimationTrigger(prev => prev + 1);
                    }}
                  >
                    {ANIMATIONS.map((anim) => (
                      <option key={anim} value={anim}>{anim}</option>
                    ))}
                  </select>
                </label>

                <button
                  onClick={() => setAnimation('Idle')}
                  className="col-span-1 bg-slate-800/60 hover:bg-slate-800 text-white text-xs px-3 py-2 rounded-lg border border-slate-600/40"
                  type="button"
                >
                  Set Idle
                </button>
                <button
                  onClick={() => {
                    setExpression('default');
                    setExpressionTrigger(prev => prev + 1);
                  }}
                  className="col-span-1 bg-slate-800/60 hover:bg-slate-800 text-white text-xs px-3 py-2 rounded-lg border border-slate-600/40"
                  type="button"
                >
                  Reset face
                </button>
              </div>
              <div className="mt-2 text-[11px] text-slate-400">
                Note: expressions auto-reset after ~2s.
              </div>
            </details>
          </div>

          {/* Chat History */}
          <div className="h-[22vh] sm:h-64 overflow-y-auto p-3 sm:p-4 space-y-3 scrollbar-thin scrollbar-thumb-slate-600 scrollbar-track-transparent">
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
                    <p className="text-xs sm:text-sm leading-relaxed">{cleanMsg}</p>
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
          <div className="p-3 sm:p-4 bg-slate-800/50 border-t border-slate-700/50">
            <div className="flex gap-2">
              <input 
                className="flex-1 bg-slate-700/50 text-white placeholder-slate-400 px-3 sm:px-4 py-3 rounded-xl border border-slate-600/50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                value={input}
                onChange={(e) => {
                  const v = e.target.value;
                  setInput(v);
                }}
                placeholder="Type a message..."
                disabled={loading || recording}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend(input)}
              />
              
              <button
                onClick={() => {
                  if (recording) {
                    stopRecording();
                  } else {
                    startRecording();
                  }
                }}
                className={`px-3 sm:px-4 py-3 rounded-xl transition-all font-medium ${
                  recording
                    ? 'bg-red-500 hover:bg-red-600 text-white animate-pulse shadow-lg shadow-red-500/50'
                    : 'bg-slate-700 hover:bg-slate-600 text-white'
                }`}
                disabled={loading}
                title={recording ? "Stop recording" : "Start recording"}
              >
                {recording ? '⏹' : '🎤'}
              </button>

              <button 
                onClick={() => handleSend(input)}
                className="bg-linear-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white px-4 sm:px-5 py-3 rounded-xl transition-all font-medium shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={loading || recording || !input.trim()}
              >
                Send
              </button>
            </div>
            <div className="text-xs text-slate-400 mt-2 text-center">
              Click 🎤 to speak • Press Enter to send
            </div>
          </div>
          </div>
        </div>
      )}

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
            expressionTrigger={expressionTrigger}
            animation={animation}
            animationTrigger={animationTrigger}
          />
        </Suspense>
      </Canvas>
    </>
  );
}

export default App;