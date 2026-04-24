#!/usr/bin/env bash
# Called by MediaMTX's runOnReady when the conclave stream goes live.
#
# Scope: ONLY the Opus transcode needed to serve WebRTC viewers with audio.
# AAC can't flow over WebRTC, and OBS can't publish Opus over RTMP, so we
# pull the feed locally and re-encode just the audio track (video is
# -c copy, ~0 cost). Republish as live/conclave-rtc — that's the path
# WebRTC viewers pull from.
#
# External fanout (YouTube, X Live, etc) is NOT here anymore. Those are
# managed by the relay (spawned/killed from /admin) so a streamer can
# test OBS locally without automatically broadcasting to the world.
#
# `exec` replaces this shell with ffmpeg so MediaMTX's runOnReadyRestart
# tracks ffmpeg's PID directly.

set -euo pipefail

: "${MEDIAMTX_PUBLISH_USER:?MEDIAMTX_PUBLISH_USER not set (add to .env.stream)}"
: "${MEDIAMTX_PUBLISH_PASS:?MEDIAMTX_PUBLISH_PASS not set (add to .env.stream)}"

exec ffmpeg -hide_banner -loglevel warning \
  -i "rtmp://127.0.0.1:1935/live/conclave" \
  -c:v copy \
  -c:a libopus -b:a 64k -ac 2 \
  -f rtsp "rtsp://${MEDIAMTX_PUBLISH_USER}:${MEDIAMTX_PUBLISH_PASS}@127.0.0.1:8554/live/conclave-rtc"
