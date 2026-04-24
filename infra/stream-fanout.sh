#!/usr/bin/env bash
# Called by MediaMTX's runOnReady when the conclave stream goes live.
# Spawns TWO ffmpeg children:
#
#   1. Opus transcode -> live/conclave-rtc (ALWAYS)
#      WebRTC requires Opus audio; OBS can only publish AAC over RTMP.
#      We re-encode audio to Opus (~0.01 core) and copy video, then
#      republish to a second MediaMTX path that WebRTC viewers subscribe
#      to. Without this, WebRTC viewers get video-only (no audio).
#
#   2. YouTube restream (opt-in via YOUTUBE_STREAM_KEY).
#      Raw `-c copy` fanout — no encoding cost.
#
# A `trap` cleans up both children on exit, and `wait -n` exits as soon
# as either child dies so MediaMTX's `runOnReadyRestart: yes` can bring
# the whole pipeline back up in sync.

set -uo pipefail

trap 'jobs -p | xargs -r kill 2>/dev/null || true' EXIT

SOURCE="rtmp://127.0.0.1:1935/live/conclave"

# --- 1. Opus transcode for WebRTC viewers ---
: "${MEDIAMTX_PUBLISH_USER:?MEDIAMTX_PUBLISH_USER not set}"
: "${MEDIAMTX_PUBLISH_PASS:?MEDIAMTX_PUBLISH_PASS not set}"
ffmpeg -hide_banner -loglevel warning \
  -i "$SOURCE" \
  -c:v copy \
  -c:a libopus -b:a 64k -ac 2 \
  -f rtsp "rtsp://${MEDIAMTX_PUBLISH_USER}:${MEDIAMTX_PUBLISH_PASS}@127.0.0.1:8554/live/conclave-rtc" &

# --- 2. YouTube fanout (optional) ---
if [[ -n "${YOUTUBE_STREAM_KEY:-}" ]]; then
  ffmpeg -hide_banner -loglevel warning \
    -i "$SOURCE" \
    -c copy \
    -f flv "${YOUTUBE_RTMP_URL:-rtmp://a.rtmp.youtube.com/live2}/${YOUTUBE_STREAM_KEY}" &
fi

# Wait for any child to exit, then signal MediaMTX by exiting non-zero so
# `runOnReadyRestart` respawns us. Prevents one crashed fanout from leaving
# us in a half-state where the other keeps running alone.
wait -n
exit 1
