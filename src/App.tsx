// src/App.tsx
import { Canvas } from "@react-three/fiber";
import { Environment, OrbitControls } from "@react-three/drei";
import { Suspense } from "react";
import { Ziva } from "./components/Ziva"; 

function App() {
  return (
    <Canvas
      shadows
      camera={{ position: [0, 0, 5], fov: 30 }}
      // h-screen = 100vh, w-full = 100% width, block = display: block
      className="h-screen w-full bg-[#ececec] block"
    >
      <Suspense fallback={null}>
        <Environment preset="apartment" />
        
        {/* Center the model */}
        <group position={[0, -1, 0]}>
            <Ziva />
        </group>

      </Suspense>

      <OrbitControls />
    </Canvas>
  );
}

export default App;