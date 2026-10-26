#!/bin/sh
set -e
exec setpriv --reuid=node --regid=node --init-groups \
  --inh-caps=-all,+setuid,+setgid --ambient-caps=-all,+setuid,+setgid \
  --bounding-set=-all,+setuid,+setgid -- /usr/bin/tini -- node --max-old-space-size=144 --max-semi-space-size=4 dist/index.js
