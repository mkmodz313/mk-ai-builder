# MK AI BUILDER — Phase 1 (AI chat core)

Build anything with AI. Node/Express backend + glassmorphism chat UI.

## Run
```
npm install
cp .env.example .env   # optional; or add keys in the app's Settings
export $(grep -v '^#' .env | xargs)   # load env vars
npm start              # http://localhost:3000
```
Requires Node 18+.

## API keys
Gemini: https://aistudio.google.com/apikey · Groq: https://console.groq.com/keys · OpenRouter: https://openrouter.ai/keys
Set them as environment variables on the server, or paste them in Settings (stored in your browser, sent per request over HTTPS, never logged).
Use Test in Settings to verify each provider.

## Deploy
Any Node host (Render, Railway, Fly.io, VPS) behind HTTPS. Set env vars there. Set ACCESS_TOKEN to require a token for /api.

## Included
Streaming chat, 3 providers, model select, automatic fallback, rate limiting (30 req/min/IP), request validation, chat history, edit/regenerate/copy, code highlighting, dark/light mode.

## Not yet built (later phases)
Monaco workspace, live preview, ZIP export, project manager, Capacitor/Android package, APK builds.
