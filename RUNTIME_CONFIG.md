# Runtime Configuration

## Environment Variables

The system requires the following environment variables to be set, typically in a `.env` file in the root directory.

### Gateway Configuration
- `TELE_GATEWAY_CHANNEL`: The channel to use. Options: `console` (default), `telegram`.
- `TELE_TELEGRAM_BOT_TOKEN`: (Required if channel is telegram) The Bot API token from BotFather.
- `TELE_TELEGRAM_ALLOWED_CHAT_IDS`: (Required if channel is telegram) Comma-separated list of numeric Chat IDs allowed to interact with the bot.

### Runtime Configuration
- `TELE_RUNTIME_PORT`: (Optional) Port for the local API. Defaults to dynamic finding or 3000.
- `TEXT_SIMULATION`: (Optional) Set to `1` to enable text input simulation for Voice Service.

### Security
- `ENABLE_TRANSCRIPT_LOG`: Set to `1` to enable voice transcript logging.

## Port Discovery
The runtime port is written to `.tele/runtime/port.json` on startup.
