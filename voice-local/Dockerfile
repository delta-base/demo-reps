# Local voice agent for testing (see bot.py). CPU only: the hub's GPU is busy
# with Ollama, and Whisper "small" + Piper run in real time on CPU.
FROM python:3.11-slim
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 HF_HOME=/models/hf
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

# Fetch the models at build time, so a session never waits on a download and
# the container needs no outbound access at runtime.
# base is the default (3x faster than small on this CPU, same text on clear
# speech); small is kept for testers with harder accents (VOICE_WHISPER_MODEL).
ARG WHISPER_MODELS="base small"
ARG PIPER_VOICES="en_US-ryan-high en_US-amy-medium"
RUN for m in ${WHISPER_MODELS}; do python -c "from faster_whisper import WhisperModel; WhisperModel('$m', device='cpu', compute_type='int8')"; done \
 && mkdir -p /models/piper \
 && for v in ${PIPER_VOICES}; do python -m piper.download_voices "$v" --data-dir /models/piper; done \
 && ls /models/piper

COPY bot.py .
COPY static ./static
EXPOSE 8000
CMD ["uvicorn", "bot:app", "--host", "0.0.0.0", "--port", "8000"]
