FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    build-essential \
    libssl-dev \
    libffi-dev \
    libsodium-dev \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN pip install --no-cache-dir \
    "git+https://github.com/Red-Fluxer-Patches/Red-DiscordBot.git@fluxer#egg=Red-DiscordBot[postgres]"

RUN sed -i \
    "s|https://api.fluxer.app|https://chat.saltygamerslounge.net/api|g" \
    /usr/local/lib/python3.11/site-packages/discord/http.py \
    /usr/local/lib/python3.11/site-packages/discord/webhook/sync.py \
    /usr/local/lib/python3.11/site-packages/discord/webhook/async_.py && \
    sed -i \
    "s|wss://gateway.fluxer.app/|wss://chat.saltygamerslounge.net/gateway|g" \
    /usr/local/lib/python3.11/site-packages/discord/gateway.py

RUN mkdir -p /data

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

VOLUME /data

ENTRYPOINT ["/entrypoint.sh"]
