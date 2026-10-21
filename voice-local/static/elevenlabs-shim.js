// Drop-in for the part of `@elevenlabs/client` the demo-reps pages use.
// nginx rewrites the pages' SDK import to this file. With the local engine
// selected (static/switch.js) a conversation runs against the hub's own voice
// service (/voice-local/ws: Whisper + Ollama + Piper); otherwise this hands
// straight over to the real ElevenLabs SDK, so nothing changes for anyone else.
//
// Implemented: Conversation.startSession({ overrides.agent.prompt.prompt,
// overrides.agent.firstMessage, textOnly, onConnect, onDisconnect, onMessage,
// onModeChange, onStatusChange, onError, onAudio, onInterruption }) and the
// session's endSession, sendUserMessage, sendContextualUpdate, setMicMuted,
// setVolume, getId. Not implemented: word timings (onAudioAlignment), so live
// captions appear when a reply finishes rather than word by word.

const REAL_SDK = "https://cdn.jsdelivr.net/npm/@elevenlabs/client@1.26.0/+esm";
const ENGINE_KEY = "reps.voice.engine";
const RATE = 16000;

export function engine() {
  try {
    const q = new URLSearchParams(location.search).get("voice");
    if (q === "local" || q === "elevenlabs") localStorage.setItem(ENGINE_KEY, q);
    return localStorage.getItem(ENGINE_KEY) === "local" ? "local" : "elevenlabs";
  } catch {
    return "elevenlabs";
  }
}

export class Conversation {
  static async startSession(options = {}) {
    if (engine() !== "local") {
      const real = await import(REAL_SDK);
      return real.Conversation.startSession(options);
    }
    return LocalConversation.start(options);
  }
}

const toB64 = (buf) => {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

class LocalConversation {
  static async start(o) {
    const c = new LocalConversation(o);
    await c.connect();
    return c;
  }

  constructor(o) {
    this.o = o;
    this.textOnly = !!(o.textOnly || o.overrides?.conversation?.textOnly);
    this.id = null;
    this.ws = null;
    this.ctx = null;
    this.gain = null;
    this.stream = null;
    this.muted = false;
    this.sources = new Set();
    this.playHead = 0;
    this.mode = "listening";
    this.ended = false;
    this.userEnded = false;
  }

  cb(name, ...args) {
    try {
      this.o[name]?.(...args);
    } catch (e) {
      console.error(`[voice-local] ${name} handler failed`, e);
    }
  }

  setMode(mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.cb("onModeChange", { mode });
  }

  async connect() {
    this.cb("onStatusChange", { status: "connecting" });
    if (!this.textOnly) {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      this.ctx = new AudioContext({ sampleRate: RATE });
      if (this.ctx.state === "suspended") await this.ctx.resume();
      this.gain = this.ctx.createGain();
      this.gain.connect(this.ctx.destination);
      await this.ctx.audioWorklet.addModule("/voice-local/mic-worklet.js");
      const mic = this.ctx.createMediaStreamSource(this.stream);
      this.worklet = new AudioWorkletNode(this.ctx, "mic-pcm16");
      this.worklet.port.onmessage = (e) => {
        if (!this.muted && this.ws?.readyState === WebSocket.OPEN) this.ws.send(e.data);
      };
      mic.connect(this.worklet);
      this.modeTimer = setInterval(() => {
        if (this.mode === "speaking" && this.ctx.currentTime >= this.playHead) this.setMode("listening");
      }, 100);
    }

    const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/voice-local/ws`;
    this.ws = new WebSocket(url);
    this.ws.binaryType = "arraybuffer";
    await new Promise((resolve, reject) => {
      this.ws.onopen = () =>
        this.ws.send(
          JSON.stringify({
            type: "init",
            prompt: this.o.overrides?.agent?.prompt?.prompt || "",
            first_message: this.o.overrides?.agent?.firstMessage || "",
            text_only: this.textOnly,
          }),
        );
      this.ws.onmessage = (e) => {
        if (typeof e.data === "string") {
          const m = JSON.parse(e.data);
          if (m.type === "ready") {
            this.id = m.conversation_id;
            this.ws.onmessage = (ev) => this.onMessage(ev);
            resolve();
          } else if (m.type === "error") reject(new Error(m.message));
        }
      };
      this.ws.onerror = () => reject(new Error("Could not reach the local voice engine."));
      this.ws.onclose = (e) => reject(new Error(e.reason || "The local voice engine closed the connection."));
    }).catch((err) => {
      this.cleanup();
      throw err;
    });
    this.ws.onclose = (e) => this.finish(e);
    this.cb("onStatusChange", { status: "connected" });
    this.cb("onConnect", { conversationId: this.id });
    this.cb("onModeChange", { mode: "listening" });
  }

  onMessage(e) {
    if (typeof e.data !== "string") return this.play(e.data);
    const m = JSON.parse(e.data);
    if (m.type === "user_transcript") this.cb("onMessage", { source: "user", role: "user", message: m.text });
    else if (m.type === "agent_response") this.cb("onMessage", { source: "ai", role: "agent", message: m.text });
    else if (m.type === "interruption") this.interrupt();
    else if (m.type === "error") this.cb("onError", m.message);
  }

  play(buf) {
    if (!this.ctx || !buf.byteLength) return;
    const pcm = new Int16Array(buf);
    const audio = this.ctx.createBuffer(1, pcm.length, RATE);
    const ch = audio.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 0x8000;
    const src = this.ctx.createBufferSource();
    src.buffer = audio;
    src.connect(this.gain);
    const at = Math.max(this.ctx.currentTime + 0.05, this.playHead);
    src.start(at);
    this.playHead = at + audio.duration;
    this.sources.add(src);
    src.onended = () => this.sources.delete(src);
    this.setMode("speaking");
    this.cb("onAudio", toB64(buf));
  }

  interrupt() {
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    }
    this.sources.clear();
    if (this.ctx) this.playHead = this.ctx.currentTime;
    this.cb("onInterruption", {});
    this.setMode("listening");
  }

  sendUserMessage(text) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: "user_message", text }));
  }

  sendContextualUpdate(text) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: "contextual_update", text }));
  }

  setMicMuted(muted) {
    this.muted = !!muted;
  }

  setVolume({ volume }) {
    if (this.gain) this.gain.gain.value = volume;
  }

  getId() {
    return this.id;
  }

  getInputVolume() {
    return 0;
  }

  getOutputVolume() {
    return 0;
  }

  async endSession() {
    this.userEnded = true;
    try {
      this.ws?.close(1000, "user");
    } catch {
      /* already closed */
    }
    this.finish({ reason: "user" });
  }

  cleanup() {
    clearInterval(this.modeTimer);
    this.interruptSilently();
    this.stream?.getTracks().forEach((t) => t.stop());
    try {
      this.ctx?.close();
    } catch {
      /* closed */
    }
  }

  interruptSilently() {
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        /* stopped */
      }
    }
    this.sources.clear();
  }

  finish(e = {}) {
    if (this.ended) return;
    this.ended = true;
    this.cleanup();
    this.cb("onStatusChange", { status: "disconnected" });
    const user = this.userEnded || e.reason === "user";
    this.cb(
      "onDisconnect",
      user
        ? { reason: "user" }
        : { reason: "error", message: e.reason || "Connection closed", closeReason: e.reason || "", closeCode: e.code },
    );
  }
}
