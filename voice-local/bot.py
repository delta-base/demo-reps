"""
Local voice agent for testing — an open-source stand-in for ElevenLabs Agents.

Pipeline (Pipecat): browser mic → Silero VAD + turn-taking → faster-whisper
(speech-to-text) → Ollama (the hub's local model) → Piper (text-to-speech)
→ browser. Everything runs on the hub; no audio or text leaves it.

The browser side is static/elevenlabs-shim.js, a drop-in for the subset of
`@elevenlabs/client` that the demo-reps pages use, so the same pages and
scenarios run on either engine (the switch is static/switch.js).

Protocol on /voice-local/ws (one WebSocket per conversation):
  client → server  first message:  {"type":"init","prompt","first_message","text_only"}
                   then:           binary PCM16 mono 16 kHz mic audio
                                   {"type":"user_message","text"}       typed turn / start signal
                                   {"type":"contextual_update","text"}  context, no reply
  server → client  {"type":"ready","conversation_id"}
                   binary PCM16 mono 16 kHz speech (paced in real time)
                   {"type":"user_transcript","text"}
                   {"type":"agent_response","text"}   full reply text, when generated
                   {"type":"interruption"}            user spoke over the reply: stop playback
                   {"type":"error","message"}
"""

import asyncio
import json
import os
import re
import uuid
from pathlib import Path

from fastapi import FastAPI, WebSocket
from fastapi.staticfiles import StaticFiles
from loguru import logger
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.audio.vad.vad_analyzer import VADParams
from pipecat.frames.frames import (
    Frame,
    InputAudioRawFrame,
    InterruptionFrame,
    LLMFullResponseEndFrame,
    LLMFullResponseStartFrame,
    LLMMessagesAppendFrame,
    LLMTextFrame,
    OutputAudioRawFrame,
    OutputTransportMessageFrame,
    OutputTransportMessageUrgentFrame,
    TranscriptionFrame,
    TTSSpeakFrame,
)
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineParams, PipelineTask
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import (
    LLMContextAggregatorPair,
    LLMUserAggregatorParams,
)
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
from pipecat.serializers.base_serializer import FrameSerializer
from pipecat.services.ollama.llm import OLLamaLLMService
from pipecat.services.piper.tts import PiperTTSService
from pipecat.services.whisper.stt import WhisperSTTService
from pipecat.transcriptions.language import Language
from pipecat.transports.websocket.fastapi import FastAPIWebsocketParams, FastAPIWebsocketTransport
from pipecat.utils.text.base_text_filter import BaseTextFilter

SAMPLE_RATE = 16000  # both directions; what the demo pages expect (pcm_16000)
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://ollama:11434").rstrip("/")
# A separate, smaller model than REPS uses: quicker replies suit voice, and a
# different model never forces Ollama to reload the one REPS has loaded.
LLM_MODEL = os.getenv("VOICE_LLM_MODEL", "gemma3:latest")
WHISPER_MODEL = os.getenv("VOICE_WHISPER_MODEL", "base")
PIPER_VOICE = os.getenv("VOICE_PIPER_VOICE", "en_US-ryan-high")
PIPER_DIR = Path(os.getenv("VOICE_PIPER_DIR", "/models/piper"))
LANGUAGE = os.getenv("VOICE_LANGUAGE", "en")
MAX_SESSIONS = int(os.getenv("VOICE_MAX_SESSIONS", "2"))
MAX_SECONDS = int(os.getenv("VOICE_MAX_SECONDS", "1260"))  # demo calls run up to 20 minutes
# Silence needed before a turn can end. Pipecat's short default let a comma
# pause ("Hi Maya, …") end the turn; the rest then arrived as an interruption
# and could be lost. 0.6 s keeps natural mid-sentence pauses inside the turn.
VAD_STOP_SECS = float(os.getenv("VOICE_VAD_STOP_SECS", "0.6"))

app = FastAPI(title="voice-local")
_active = 0
_active_lock = asyncio.Lock()


class CueFilter(BaseTextFilter):
    """Strip what should be shown but not spoken: ElevenLabs-style voice cues
    such as [skeptical], and markdown emphasis."""

    async def filter(self, text: str) -> str:
        text = re.sub(r"\[[^\]]*\]", " ", text)
        return re.sub(r"[*_#`]+", "", text)

    async def handle_interruption(self):
        pass

    async def reset_interruption(self):
        pass


class ShimSerializer(FrameSerializer):
    """Binary frames carry PCM audio; text frames carry the JSON events above."""

    async def serialize(self, frame: Frame) -> str | bytes | None:
        if isinstance(frame, OutputAudioRawFrame):
            return frame.audio
        if isinstance(frame, InterruptionFrame):
            return json.dumps({"type": "interruption"})
        if isinstance(frame, (OutputTransportMessageFrame, OutputTransportMessageUrgentFrame)):
            if self.should_ignore_frame(frame):
                return None
            return json.dumps(frame.message)
        return None

    async def deserialize(self, data: str | bytes) -> Frame | None:
        if isinstance(data, (bytes, bytearray)):
            return InputAudioRawFrame(audio=bytes(data), sample_rate=SAMPLE_RATE, num_channels=1)
        try:
            msg = json.loads(data)
        except json.JSONDecodeError:
            return None
        text = str(msg.get("text") or "").strip()[:4000]
        if msg.get("type") == "user_message" and text:
            return LLMMessagesAppendFrame(messages=[{"role": "user", "content": text}], run_llm=True)
        if msg.get("type") == "contextual_update" and text:
            return LLMMessagesAppendFrame(
                messages=[{"role": "user", "content": f"(Context update, do not reply to this: {text})"}],
                run_llm=False,
            )
        return None


def event(payload: dict) -> OutputTransportMessageUrgentFrame:
    return OutputTransportMessageUrgentFrame(message=payload)


class UserTranscriptEvents(FrameProcessor):
    """After speech-to-text: tell the page what the learner said."""

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        if isinstance(frame, TranscriptionFrame) and frame.text.strip():
            await self.push_frame(event({"type": "user_transcript", "text": frame.text.strip()}))
        await self.push_frame(frame, direction)


class AgentResponseEvents(FrameProcessor):
    """After the model: send each reply's full text once it is generated."""

    def __init__(self):
        super().__init__()
        self._buf: list[str] | None = None

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        if isinstance(frame, LLMFullResponseStartFrame):
            self._buf = []
        elif isinstance(frame, LLMTextFrame) and self._buf is not None:
            self._buf.append(frame.text)
        elif isinstance(frame, (LLMFullResponseEndFrame, InterruptionFrame)) and self._buf is not None:
            text = "".join(self._buf).strip()
            self._buf = None
            if text:
                await self.push_frame(event({"type": "agent_response", "text": text}))
        await self.push_frame(frame, direction)


def language() -> Language:
    try:
        return Language(LANGUAGE)
    except ValueError:
        return Language.EN


@app.get("/voice-local/health")
async def health():
    return {"status": "ok", "llm": LLM_MODEL, "stt": WHISPER_MODEL, "tts": PIPER_VOICE, "active": _active}


@app.websocket("/voice-local/ws")
async def conversation(websocket: WebSocket):
    global _active
    await websocket.accept()
    async with _active_lock:
        if _active >= MAX_SESSIONS:
            await websocket.send_text(json.dumps({"type": "error", "message": "The local voice engine is busy. Try again in a minute."}))
            await websocket.close(code=1013)
            return
        _active += 1
    try:
        init = json.loads(await asyncio.wait_for(websocket.receive_text(), timeout=15))
        if init.get("type") != "init":
            raise ValueError("expected an init message")
        await run_session(websocket, init)
    except Exception as exc:  # noqa: BLE001 — report and close; one bad session must not affect others
        logger.exception("voice session failed")
        try:
            await websocket.send_text(json.dumps({"type": "error", "message": str(exc)[:300]}))
            await websocket.close(code=1011)
        except Exception:  # noqa: BLE001
            pass
    finally:
        async with _active_lock:
            _active -= 1


async def run_session(websocket: WebSocket, init: dict):
    text_only = bool(init.get("text_only"))
    prompt = str(init.get("prompt") or "You are a helpful conversation partner.")[:20000]
    first_message = str(init.get("first_message") or "").strip()
    conversation_id = f"local_{uuid.uuid4().hex[:12]}"
    spoken = (
        "\n\nThis is a live spoken conversation: reply in one to three short sentences, "
        "plain spoken language, no lists or formatting."
        if not text_only
        else ""
    )

    transport = FastAPIWebsocketTransport(
        websocket,
        FastAPIWebsocketParams(
            audio_in_enabled=not text_only,
            audio_out_enabled=not text_only,
            audio_in_sample_rate=SAMPLE_RATE,
            audio_out_sample_rate=SAMPLE_RATE,
            add_wav_header=False,
            serializer=ShimSerializer(),
            session_timeout=MAX_SECONDS,
        ),
    )
    llm = OLLamaLLMService(
        base_url=f"{OLLAMA_URL}/v1",
        settings=OLLamaLLMService.Settings(model=LLM_MODEL, system_instruction=prompt + spoken),
    )
    context = LLMContext()
    vad = None if text_only else SileroVADAnalyzer(params=VADParams(stop_secs=VAD_STOP_SECS))
    aggregators = LLMContextAggregatorPair(context, user_params=LLMUserAggregatorParams(vad_analyzer=vad))

    steps: list[FrameProcessor] = [transport.input()]
    if not text_only:
        steps += [
            WhisperSTTService(
                device="cpu",
                compute_type="int8",
                settings=WhisperSTTService.Settings(model=WHISPER_MODEL, language=language()),
            ),
            UserTranscriptEvents(),
        ]
    steps += [aggregators.user(), llm, AgentResponseEvents()]
    if not text_only:
        steps.append(
            PiperTTSService(
                download_dir=PIPER_DIR,
                text_filters=[CueFilter()],
                settings=PiperTTSService.Settings(voice=PIPER_VOICE),
            )
        )
    steps += [transport.output(), aggregators.assistant()]

    task = PipelineTask(
        Pipeline(steps),
        params=PipelineParams(audio_in_sample_rate=SAMPLE_RATE, audio_out_sample_rate=SAMPLE_RATE),
        idle_timeout_secs=MAX_SECONDS,
    )

    @transport.event_handler("on_client_connected")
    async def on_connected(_transport, _client):
        if first_message:
            # Say (or, in text mode, send) the opening line and keep it in the context.
            await task.queue_frames([event({"type": "agent_response", "text": first_message})])
            if text_only:
                context.add_message({"role": "assistant", "content": first_message})
            else:
                await task.queue_frames([TTSSpeakFrame(first_message)])

    @transport.event_handler("on_client_disconnected")
    async def on_disconnected(_transport, _client):
        await task.cancel()

    await websocket.send_text(json.dumps({"type": "ready", "conversation_id": conversation_id}))
    logger.info(f"{conversation_id}: start ({'text' if text_only else 'voice'}, {LLM_MODEL})")
    await PipelineRunner(handle_sigint=False).run(task)
    logger.info(f"{conversation_id}: end")


# The browser shim, the start-up switch and the mic worklet.
app.mount("/voice-local", StaticFiles(directory=Path(__file__).parent / "static"), name="static")
