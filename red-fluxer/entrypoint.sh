#!/bin/bash
set -e

if [ ! -f /data/.setup_done ]; then
    echo "Running first-time setup..."
    redbot-setup \
        --instance-name redfluxer \
        --data-path /data \
        --backend json \
        --no-prompt
    touch /data/.setup_done
fi

exec redbot redfluxer \
    --token "$BOT_TOKEN" \
    --prefix "$PREFIX" \
    --owner "$OWNER_ID"
