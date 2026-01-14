# Ziva Frontend

The frontend renders Ziva’s 3D avatar and chat UI.

## Tech

- React + TypeScript (Vite)
- Three.js via @react-three/fiber + @react-three/drei
- Tailwind CSS
- Lip sync via wawa-lipsync

## Setup

1) Install deps:

```bash
npm install
```

2) Configure the backend URL:

Create `Frontend/.env`:

```env
VITE_API_BASE_URL=http://localhost:3000
```

3) Run dev server:

```bash
npm run dev
```

For backend setup, see the repository root README.
