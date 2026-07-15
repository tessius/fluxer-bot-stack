# Self-Hosted Fluxer Bot Stack — Installation Guide

This guide covers installing a full-featured bot stack on a self-hosted Fluxer instance. It includes **Red-Fluxer** (moderation, leveling, custom commands, and more), **Vinto Music Bot** (YouTube, SoundCloud, Spotify, Deezer), and **RoleBot** (reaction roles).

> **Tested on:** Ubuntu 24.04 Server with Docker Engine installed  
> **Fluxer version:** Self-hosted via official docker-compose stack

---

## Prerequisites

- A working self-hosted Fluxer instance (e.g. `https://chat.yourdomain.com`)
- Docker Engine installed ([install guide](https://docs.docker.com/engine/install/ubuntu/))
- A Fluxer admin account with a valid session token

---

## Getting a Bot Token

You'll need a session token from your Fluxer instance to create bot applications. In your browser:

1. Go to your Fluxer instance and log in as admin
2. Open DevTools (F12) → **Storage** tab → **Local Storage** → click your instance URL
3. Copy the value of the `token` key

Then create a bot application via the API (replace `YOUR_TOKEN` and `YOUR_DOMAIN`):

```bash
curl -X POST https://YOUR_DOMAIN/api/v1/oauth2/applications \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"name":"BotName","bot_public":true,"bot_require_code_grant":false,"redirect_uris":[]}'
```

Save the `bot.token` value from the response — you'll need it below.

> **Note:** Session tokens expire. If you get an `Unauthorized` error, grab a fresh token from your browser.

---

## Red-Fluxer

Red-DiscordBot patched to work with Fluxer. Covers moderation, administration, reaction roles, leveling, economy, custom commands, tickets, autoroom, trivia, reminders, and hundreds of community cogs.

> Based on: [Red-Fluxer-Patches/Red-DiscordBot](https://github.com/Red-Fluxer-Patches/Red-DiscordBot)

### 1. Create the bot application

Use the curl command above with `"name":"RedFluxer"`. Note the `bot.id` (Client ID) and `bot.token`.

### 2. Set up the directory and files

```bash
sudo mkdir /opt/redfluxer
cd /opt/redfluxer
sudo mkdir data
```

Create the `Dockerfile`:

```bash
sudo nano Dockerfile
```

```dockerfile
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
    "s|https://api.fluxer.app|https://YOUR_DOMAIN/api|g" \
    /usr/local/lib/python3.11/site-packages/discord/http.py \
    /usr/local/lib/python3.11/site-packages/discord/webhook/sync.py \
    /usr/local/lib/python3.11/site-packages/discord/webhook/async_.py && \
    sed -i \
    "s|wss://gateway.fluxer.app/|wss://YOUR_DOMAIN/gateway|g" \
    /usr/local/lib/python3.11/site-packages/discord/gateway.py

RUN mkdir -p /data

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

VOLUME /data

ENTRYPOINT ["/entrypoint.sh"]
```

> **Important:** Replace `YOUR_DOMAIN` with your actual domain (e.g. `chat.saltygamerslounge.net`) in the two `sed` commands.

Create the `entrypoint.sh`:

```bash
sudo nano entrypoint.sh
```

```bash
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
```

Create the `docker-compose.yml`:

```bash
sudo nano docker-compose.yml
```

```yaml
services:
  redfluxer:
    build: .
    container_name: redfluxer
    restart: unless-stopped
    environment:
      BOT_TOKEN: YOUR_BOT_TOKEN
      PREFIX: "!"
      OWNER_ID: "YOUR_USER_ID"
    volumes:
      - /opt/redfluxer/data:/data
```

> Replace `YOUR_BOT_TOKEN` with the bot token from step 1, and `YOUR_USER_ID` with your Fluxer user ID (visible in your account settings).

### 3. Build and start

```bash
sudo docker compose build
sudo docker compose up -d
sudo docker compose logs -f
```

The first run will take a moment for setup. You should see the Red ASCII logo and `Loaded 2 cogs with 41 commands` when it's ready.

### 4. Invite the bot to your guild

```
https://YOUR_DOMAIN/oauth2/authorize?client_id=YOUR_CLIENT_ID&scope=bot&permissions=8
```

### 5. Load built-in cogs

In your Fluxer server:

```
!load mod
!load admin
!load modlog
!load filter
!load warnings
!load trivia
!load economy
!load customcom
!load alias
!load cleanup
!load general
!load permissions
!load streams
!load downloader
```

### 6. Add community cog repositories

```
!repo add Seina-Cogs https://github.com/japandotorg/Seina-Cogs
!repo add PCXCogs https://github.com/PhasecoreX/PCXCogs
!repo add vrt-cogs https://github.com/vertyco/vrt-cogs
```

### 7. Install and load community cogs

```
!cog install Seina-Cogs roleutils
!cog install Seina-Cogs antilinks
!cog install Seina-Cogs lock
!cog install Seina-Cogs purge
!cog install Seina-Cogs tags
!cog install vrt-cogs levelup
!cog install vrt-cogs tickets
!cog install PCXCogs autoroom
!cog install PCXCogs remindme
```

Then load them (unload cleanup first since purge replaces it):

```
!unload cleanup
!unload alias
!unload customcom
!load roleutils
!load antilinks
!load lock
!load purge
!load levelup
!load tickets
!load autoroom
!load remindme
!load tags
```

### Feature Overview

| Feature | Command |
|---|---|
| Reaction roles | `!reactrole` |
| Lock/unlock channels | `!lock` / `!unlock` |
| Purge messages | `!purge` |
| Word filter | `!filter` |
| Link filter | `!antilinks` |
| Warnings | `!warn` / `!warnings` |
| Ban/kick/tempban | `!ban` / `!kick` / `!tempban` |
| Mod log | `!modlogset` |
| Leveling/XP | `!levelset` |
| Economy | `!bank` / `!payday` / `!slot` |
| Custom commands | `!tags` |
| Tickets | `!tickets` |
| Auto voice channels | `!autoroom` |
| Reminders | `!remindme` |
| Trivia | `!trivia` |
| Stream alerts | `!streamset` |

---

## Vinto Music Bot

A resilient self-hosted music bot supporting YouTube, SoundCloud, Deezer, Audius, and mirrored imports from Spotify, Apple Music, Amazon Music, Tidal, and more.

> Based on: [invaliduser231/Vinto-Music](https://github.com/invaliduser231/Vinto-Music)

### 1. Create the bot application

Use the curl command above with `"name":"Vinto"`. Note the `bot.id` (Client ID) and `bot.token`.

### 2. Set up the directory

```bash
sudo mkdir /opt/vinto
cd /opt/vinto
sudo git clone https://github.com/invaliduser231/Vinto-Music.git .
sudo cp .env.example .env
sudo nano .env
```

Set these minimum values (replace with your actual values):

```env
BOT_TOKEN=YOUR_BOT_TOKEN
API_BASE=https://YOUR_DOMAIN/api/v1
GATEWAY_URL=wss://YOUR_DOMAIN/gateway
MONGODB_URI=mongodb://mongo:27017
```
> **Note:** Find `VOICE_MAX_BITRATE` in the `.env` file and set it to match your Fluxer voice channel's bitrate in bps (e.g. `VOICE_MAX_BITRATE=64000` for 64kbps). Mismatching this causes frequent voice disconnections.


### 3. Start the bot

```bash
sudo docker compose up -d
sudo docker compose logs -f app
```

You should see `Gateway ready {"user":"Vinto"}` when it's connected.

### 4. Invite the bot to your guild

```
https://YOUR_DOMAIN/oauth2/authorize?client_id=YOUR_CLIENT_ID&scope=bot&permissions=387072
```

### 5. Fix bot showing as deafened

By default Vinto joins voice channels with `self_deaf: true`, which shows the bot as deafened in the UI even though audio works fine. To fix it:

```bash
sudo docker compose exec app cat /app/dist/src/gateway.js | sudo tee /opt/vinto/gateway.js > /dev/null
sudo nano /opt/vinto/gateway.js
```

Find this block (around line 157):

```js
channel_id: channelId,
self_mute: false,
self_deaf: true,
```

Change `self_deaf: true` to `self_deaf: false`. Save and exit.

Then add a volume mount to your `docker-compose.yml` under the `app` service volumes:

```yaml
- /opt/vinto/gateway.js:/app/dist/src/gateway.js
```

Then restart:

```bash
sudo docker compose up -d --force-recreate app
```

### 6. Usage

Join a voice channel and use:

```
!play never gonna give you up
!skip
!pause
!resume
!queue
!stop
```

### Feature Overview

| Feature | Command |
|---|---|
| Play music | `!play <query or URL>` |
| Skip | `!skip` / `!voteskip` |
| Pause/Resume | `!pause` / `!resume` |
| Queue | `!queue` |
| Now playing | `!now` |
| Loop | `!loop <off/track/queue>` |
| Volume | `!volume <0-200>` |
| Shuffle | `!shuffle` |
| Playlists | `!playlist` |
| Favorites | `!fav` / `!favs` |
| 24/7 mode | `!247` |
| Equalizer | `!eq` |
| Filters | `!filter` |

---

## RoleBot

A simple, lightweight reaction role bot for Fluxer. Users react to a message with an emoji to gain a role, and unreact to remove it.

> Based on: [PerpetualPossum/fluxer-rolebot](https://github.com/PerpetualPossum/fluxer-rolebot)

### 1. Create the bot application

Use the curl command above with `"name":"RoleBot"`. Note the `bot.id` (Client ID) and `bot.token`.

### 2. Set up the directory

```bash
sudo mkdir /opt/rolebot
cd /opt/rolebot
sudo git clone https://github.com/PerpetualPossum/fluxer-rolebot.git .
sudo cp .env.example .env
sudo nano .env
```

Set these values:

```env
FLUXER_TOKEN=YOUR_BOT_TOKEN
COMMAND_PREFIX=!
DB_PATH=/app/data/db.json
FLUXER_API_URL=https://YOUR_DOMAIN/api/v1
```

### 3. Patch for self-hosted instances

RoleBot needs to be told to use your self-hosted API instead of `api.fluxer.app`. Edit `main.py`:

```bash
sudo nano main.py
```

Find:

```python
bot = fluxer.Bot(
    command_prefix=command_prefix,
    intents=fluxer.Intents.all(),
)
```

Change to:

```python
bot = fluxer.Bot(
    command_prefix=command_prefix,
    intents=fluxer.Intents.all(),
    api_url=os.getenv("FLUXER_API_URL", "https://api.fluxer.app/v1"),
)
```

### 4. Fix data directory permissions

```bash
sudo chmod 777 /opt/rolebot/data
```

### 5. Build and run

```bash
sudo make build
sudo docker run -d --env-file .env -v ./data:/app/data --restart unless-stopped --name fluxer-rolebot fluxer-rolebot
```

### 6. Invite the bot to your guild

```
https://YOUR_DOMAIN/oauth2/authorize?client_id=YOUR_CLIENT_ID&scope=bot&permissions=1342377024
```

### 7. Usage

1. Post a message in any channel (e.g. `React with 🎮 to get the Gamer role!`)
2. Right-click the message → Copy Link
3. Run `!setmessage <message_link>`
4. Run `!add @RoleName 🎮`

Users who react with 🎮 will receive the role. Removing the reaction removes the role.

> **Note:** When typing `!add @RoleName`, make sure to select the role from the dropdown so it registers as a proper role mention.

### Commands

| Command | Description |
|---|---|
| `!setmessage <link>` | Set the message to watch for reactions |
| `!removemessage` | Remove the configured message |
| `!add @Role 🎮` | Add an emoji-role binding |
| `!remove 🎮` | Remove an emoji-role binding |
| `!ping` | Check if the bot is responsive |
| `!help` | Show all commands |

---

## Notes

- Red-Fluxer connects to `api.fluxer.app` by default. The `sed` commands in the Dockerfile patch it to point at your self-hosted instance instead.
- Vinto supports `API_BASE` and `GATEWAY_URL` env vars natively — no patching required.
- Community cogs for Red are built on top of Red's internal APIs and do not need modification to work with Fluxer.
- The Red cog index at [index.discord.red](https://index.discord.red) lists hundreds of additional community cogs you can install with `!cog install`.
- Music bot support on self-hosted Fluxer LiveKit is still evolving. Vinto is currently the most reliable option.

---

*Guide compiled from a working self-hosted Fluxer deployment on Ubuntu 24.04 — July 2026*
