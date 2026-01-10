import { Environment, OrbitControls, Sparkles, ContactShadows } from "@react-three/drei";
import { Ziva } from "./Ziva";

interface ExperienceProps {
    audioUrl: string | null;
    expression: string;
    animation: string;
    animationTrigger: number;
}

export const Experience = ({ audioUrl, expression, animation, animationTrigger }: ExperienceProps) => {
    return (
        <>
            {/* 1. Controls */}
            <OrbitControls 
                enablePan={false} 
                minPolarAngle={0.5} 
                maxPolarAngle={1.5} 
                target={[0, 0.5, 0]} 
            />

            {/* 2. Environment */}
            <Environment
                files="/home.exr"
                background
                
            />

            {/* 3. Extra Particles for "Tech" Feel */}
            <Sparkles
                count={50}
                scale={5}
                size={4}
                speed={0.4}
                opacity={0.5}
                color="#b0c4de"
                position={[0, 1, -2]} // Slightly behind the model
            />

            {/* 4. Shadows on the floor */}
            <ContactShadows opacity={0.4} scale={10} blur={2.5} far={4} resolution={256} color="#000000" />

            {/* 5. The Avatar */}
            {/* Shift X to the right for equal spacing between chat and right edge. Adjust 0.4 as needed. */}
            <group position={[0.4, -1.3, 0]} scale={1.3}>
                <Ziva
                    audioUrl={audioUrl}
                    expression={expression}
                    animation={animation}
                    animationTrigger={animationTrigger}
                />
            </group>
        </>
    );
};