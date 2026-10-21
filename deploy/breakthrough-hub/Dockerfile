# REPS demo on the Breakthrough hub (demo.breakthrough-insights.com).
# Build from the repository root:
#   docker build -f deploy/breakthrough-hub/Dockerfile .
#
# Static site on nginx. The ElevenLabs agent ID and optional API key come
# from the environment (ELEVENLABS_AGENT_ID / ELEVENLABS_API_KEY):
# 40-voice-config.sh writes voice-config.js from them at start, and nginx
# serves the signed-URL endpoint voice-server.mjs would otherwise provide,
# adding the API key server-side. nginx also rewrites the ElevenLabs SDK
# import to the local-voice stand-in (see voice-local/). See README.md here.
FROM nginx:1.29-alpine

# Always defined (empty unless set at run time): nginx's template step only
# substitutes variables that exist, and a missing one would leave
# ${ELEVENLABS_API_KEY} in the config and stop nginx from starting.
ENV ELEVENLABS_AGENT_ID="" \
    ELEVENLABS_API_KEY=""

# A template, not a plain conf: the image fills in the ElevenLabs settings
# from the environment at start (see nginx.conf).
COPY deploy/breakthrough-hub/nginx.conf /etc/nginx/templates/default.conf.template
COPY --chmod=755 deploy/breakthrough-hub/40-voice-config.sh /docker-entrypoint.d/40-voice-config.sh
COPY . /usr/share/nginx/html/
# The deployment files arrive with the site copy; they are not site content.
RUN rm -rf /usr/share/nginx/html/deploy
