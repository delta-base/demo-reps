# Self-hosting on the Breakthrough hub

How this demo runs at **demo.breakthrough-insights.com**, and the optional
local voice engine used for testing. Nothing here changes the site itself:
`main` keeps working as a plain static site / with `voice-server.mjs`.

## Web container (`deploy/breakthrough-hub/`)

```sh
docker build -f deploy/breakthrough-hub/Dockerfile -t demo-reps .
docker run -p 8080:8080 -e ELEVENLABS_AGENT_ID=agent_... [-e ELEVENLABS_API_KEY=sk_...] demo-reps
```

- **`40-voice-config.sh`** writes `voice-config.js` at container start from
  `ELEVENLABS_AGENT_ID`. With `ELEVENLABS_API_KEY` also set, the page is
  pointed at `/api/voice/signed-url` instead, so the agent can be private.
  Neither set: the committed `voice-config.js` is served unchanged.
- **`nginx.conf`** (rendered from the environment at start):
  - `/api/voice/signed-url` asks ElevenLabs for a short-lived signed URL,
    adding the API key server-side (it never reaches the browser);
    rate-limited per visitor. The key needs **ElevenAgents write**
    (`convai_write`) permission, or ElevenLabs answers 401.
  - Rewrites the ElevenLabs SDK import in `demo.html`, `voice.html` and
    `pitch-voice.js` to `/voice-local/elevenlabs-shim.js`, and injects the
    tester-only engine switch (`/voice-local/switch.js`).
  - Forwards `/voice-local/` to the local voice engine (below), resolved per
    request, so the site still starts without it.
  - Never serves dotfiles; `.mhtml` legal pages get their correct type.

## Local voice engine (`voice-local/`)

An open-source stand-in for ElevenLabs Agents, for testing without
ElevenLabs: a Pipecat pipeline of Silero VAD + Smart Turn → faster-whisper
(speech-to-text) → Ollama → Piper (text-to-speech), behind one WebSocket.

- `bot.py` — the server (`/voice-local/ws`, `/voice-local/health`).
- `static/elevenlabs-shim.js` — drop-in for the part of `@elevenlabs/client`
  these pages use. It uses the **real** ElevenLabs SDK unless the local engine
  is selected, so nothing changes for normal visitors.
- `static/switch.js` — the engine switch. Hidden until a page is opened once
  with `?voicelab=1`. With the local engine selected it also answers the
  pages' signed-URL prefetch, so a missing/limited ElevenLabs key can't block
  local calls.
- `static/mic-worklet.js` — 16 kHz microphone capture.

```sh
docker build -t voice-local voice-local
docker run -e OLLAMA_URL=http://ollama:11434 voice-local
```

Settings: `VOICE_LLM_MODEL` (default `gemma3:latest`), `VOICE_WHISPER_MODEL`
(`base`; `small` is also in the image), `VOICE_PIPER_VOICE`
(`en_US-ryan-high`), `VOICE_VAD_STOP_SECS` (`0.6` — silence before a turn
ends), `VOICE_MAX_SESSIONS` (`2`).

Not emulated: ElevenLabs word timings, so captions appear per reply rather
than word by word. Piper (piper1-gpl) is GPL-3.0: fine as a separate internal
service; review before distributing it.
