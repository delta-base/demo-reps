#!/bin/sh
# Writes voice-config.js from the environment at container start (nginx runs
# /docker-entrypoint.d/*.sh before starting), so the ElevenLabs settings live
# in breakthrough-client/.env rather than in the demo-reps repo:
#   ELEVENLABS_AGENT_ID  set  → the page uses this agent
#   + ELEVENLABS_API_KEY set  → the page asks /api/voice/signed-url instead
#                               (nginx adds the key server-side), so the agent
#                               can be private and the key never reaches it
# Neither set → the repo's committed voice-config.js is served unchanged.
set -eu
out=/usr/share/nginx/html/voice-config.js
id="${ELEVENLABS_AGENT_ID:-}"
key="${ELEVENLABS_API_KEY:-}"

if [ -z "$id" ]; then
  echo "voice-config: ELEVENLABS_AGENT_ID not set, keeping the repo's voice-config.js"
  exit 0
fi
# Agent IDs are agent_<alphanumerics>; refuse anything else rather than
# writing it into a script the browser executes.
case "$id" in
  agent_*[!A-Za-z0-9_]*|"") echo "voice-config: ELEVENLABS_AGENT_ID is not a valid agent ID, keeping the repo's file" >&2; exit 0 ;;
  agent_*) ;;
  *) echo "voice-config: ELEVENLABS_AGENT_ID must start with agent_, keeping the repo's file" >&2; exit 0 ;;
esac

if [ -n "$key" ]; then
  echo "window.REPS_VOICE_CONFIG = { signedUrlEndpoint: '/api/voice/signed-url' };" > "$out"
  echo "voice-config: agent $id, private (signed URLs via nginx)"
else
  echo "window.REPS_VOICE_CONFIG = { agentId: '$id' };" > "$out"
  echo "voice-config: agent $id, public"
fi
