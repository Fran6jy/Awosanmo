#!/bin/bash
# Restart the Awosanmo container when Docker reports it unhealthy.
#
# The app does not crash when the host is starved -- it stops answering while the
# process stays alive, so Docker keeps it "running" and nothing recovers it. The
# container health check already needs 5 consecutive failures (~5 min) to report
# unhealthy, so reaching here means a real hang rather than a slow reply.
set -u
CONTAINER=awosanmo-awosanmo-1
COOLDOWN=900                     # never restart more than once per 15 minutes
STAMP=/var/run/awosanmo-watchdog.last

status=$(docker inspect --format '{{.State.Health.Status}}' "$CONTAINER" 2>/dev/null) || exit 0
[ "$status" = "unhealthy" ] || exit 0

# A restart that did not help must not become a restart loop: back off and let a
# human look instead of hammering an already-struggling box.
now=$(date +%s)
if [ -f "$STAMP" ]; then
  last=$(cat "$STAMP" 2>/dev/null || echo 0)
  if [ $((now - last)) -lt "$COOLDOWN" ]; then
    logger -t awosanmo-watchdog "unhealthy but within cooldown ($((now - last))s), not restarting"
    exit 0
  fi
fi

echo "$now" > "$STAMP"
logger -t awosanmo-watchdog "container unhealthy - restarting"
if timeout 180 docker restart "$CONTAINER" >/dev/null 2>&1; then
  logger -t awosanmo-watchdog "restart issued successfully"
else
  logger -t awosanmo-watchdog "restart FAILED (exit $?)"
fi
