# discord-mc-bridge

Discord (#mission-control) → mc-lite activity store bridge.

## What it does
- Polls a Discord channel via local `clawdbot message read`
- For each new message (optionally requiring `→ to`), posts a record into mc-lite `/api/mission/activity`
- Posts an acknowledgement back into the Discord channel (prefixed with `[auto-bridge]`)

## Run

```bash
cd /Users/masakiikeda/clawd/TandS/proposal-b-webapp/bridge/discord-mc-bridge

export DISCORD_CHANNEL_ID=1476003697623568466
export DISCORD_TARGET="channel:${DISCORD_CHANNEL_ID}"
export MISSION_CONTROL_BASE_URL="https://mc-lite.vercel.app"
export MISSION_CONTROL_PASSWORD="MM123"

# optional
export REQUIRE_TO=1
export IGNORE_WEBHOOK_MESSAGES=1
export IGNORE_AUTHORS="Mission Control,Spidey Bot"

node bridge.mjs
```

State is stored in `state.json` in the same folder.
