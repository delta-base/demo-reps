# Voice pitch practice (ElevenLabs)

A third practice category in `demo.html`, **Pitch practice · voice**. You pitch out loud to an AI buyer
in real time through an [ElevenLabs Agent](https://elevenlabs.io/docs/eleven-agents), then get a debrief.

| Exercise | Buyer | Goal |
|---|---|---|
| 01 Elevator pitch | VP Sales, between meetings | Book a discovery call in about 2 minutes |
| 02 Value pitch to finance | CFO with a frozen budget | Agree to build the business case together |
| 03 Competitive displacement | Head of Enablement with an incumbent | Find the gap and earn a pilot |

Each exercise has three difficulty levels: Friendly, Realistic and Tough.

## How it works
- `pitch-voice.js` loads `@elevenlabs/client` from jsDelivr and calls `Conversation.startSession`. Each
  scenario's persona, hidden pains, difficulty and first line are sent as **per-session overrides**,
  so a single agent covers every scenario.
- The live screen shows a volume-reactive orb, whose turn it is, a timer and a live transcript.
- The debrief runs locally on the transcript. It reports talk share, questions asked, estimated words per minute
  and filler words, plus six pitch moves: hook, discovery, quantified value, proof, objection
  exploration and a clear ask.

## Scenarios
- **Surprise pitch:** a random buyer, business, personality, product, price and goal on every run.
  You can reroll it, or edit any field to set up your own situation.
- **Pitch exercises:** the three fixed exercises in the table above.
- **All existing REPS scenarios:** every card in `demo.html` now has a **Practise by voice** button. The
  agent is built from that scenario's data in the `scenarios` object: role, context, opening line, the
  scripted replies (used as character guidance), and the behaviours it trains.

## Setup
1. In ElevenLabs, open **ElevenAgents** and create a blank agent. In its **Security** tab, enable
   overrides for **System prompt** and **First message**.
2. Copy `.env.example` to `.env` in this folder and fill it in:
   ```
   ELEVENLABS_AGENT_ID=agent_...
   ELEVENLABS_API_KEY=sk_...   # optional; only for private agents
   ```
   `.env` is gitignored, and the server refuses to serve dotfiles.
3. Run `node voice-server.mjs` (Node 20.12+) and open http://localhost:8787/demo.html

Without the server, you can still open `demo.html` on any static host and paste the agent ID on the call
screen, or pass it in the URL as `?agent=agent_...`. The microphone needs `localhost` or HTTPS.
