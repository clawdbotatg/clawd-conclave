#!/usr/bin/env bash
# Called by MediaMTX's runOnReady hook when the conclave stream goes live.
# Spawns an ffmpeg that byte-copies the local RTMP feed to YouTube Live.
#
# `exec` replaces this shell with ffmpeg so MediaMTX's `runOnReadyRestart`
# tracks the ffmpeg PID directly (not the shell's). MediaMTX will SIGTERM
# ffmpeg automatically when the source stream goes away.
#
# Exits quietly if YOUTUBE_STREAM_KEY isn't set — opt-in per host.

set -euo pipefail

if [[ -z "${YOUTUBE_STREAM_KEY:-}" ]]; then
  exit 0
fi

YOUTUBE_URL="${YOUTUBE_RTMP_URL:-rtmp://a.rtmp.youtube.com/live2}/${YOUTUBE_STREAM_KEY}"

exec ffmpeg -hide_banner -loglevel warning \
  -i "rtmp://127.0.0.1:1935/live/conclave" \
  -c copy -f flv "$YOUTUBE_URL"
