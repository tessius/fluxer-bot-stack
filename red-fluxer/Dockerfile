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
    "git+https://github.com/Red-Fluxer-Patches/Red-DiscordBot.git@3d01534391f811bc62b77fe6927717130a50ee3f#egg=Red-DiscordBot[postgres]"

RUN SP=$(python -c "import discord,os;print(os.path.dirname(discord.__file__))") && \
    sed -i \
    "s|https://api.fluxer.app|https://chat.saltygamerslounge.net/api|g" \
    $SP/http.py $SP/webhook/sync.py $SP/webhook/async_.py && \
    sed -i \
    "s|wss://gateway.fluxer.app/|wss://chat.saltygamerslounge.net/gateway|g" \
    $SP/gateway.py

RUN mkdir -p /data

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

VOLUME /data

ENTRYPOINT ["/entrypoint.sh"]
