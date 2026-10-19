#!/bin/sh
set -e
exec setpriv --reuid=node --regid=node --init-groups \
  --inh-caps=-all,+setuid,+setgid --ambient-caps=-all,+setuid,+setgid \
  --bounding-set=-all,+setuid,+setgid -- node dist/index.js
