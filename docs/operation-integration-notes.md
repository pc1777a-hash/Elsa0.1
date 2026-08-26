# ELSA V5 Operation Integration Notes

## Current observed desktop operation

The supplied terminal output records a BTCUSDT 1H paper-mode signal with `LONG`, signal strength `0.95`, EMA20 `63505.08`, EMA50 `63321.04`, RSI `60.1`, and an empty positions response at the time captured. The automation response indicated `active: true`, `configured: true`, and ten completed cycles. The `api/plugins` endpoint and the app endpoint both returned HTTP 200 in the captured session.

The observed PM2 state reported `cloudflared-agi`, `elsa-native`, and `elsa-watchdog` online. `elsa-selfevolve` completed the `chat_ui` task and was then explicitly stopped from the desktop terminal. The mobile App must only render these values as status information; it must not expose controls to start, stop, reset, trade, transfer, or modify these desktop processes.

## Public endpoint verification

| Endpoint | Result | Mobile App handling |
|---|---|---|
| `https://brain.pin-yi.uk/api/system/bible` | Returns ELSA-V5 System Bible v1.0.0 with `core`, `trading`, `memory`, and `plugin` services. | Displayed in the overview architecture card. |
| `https://brain.pin-yi.uk/auto/status` | Returned HTTP 404 when checked on 2026-08-18. | Not used as a default endpoint. The correct exposed route must be confirmed before live integration. |
| `https://brain.pin-yi.uk/api/auto/status` | Returned HTTP 404 when checked on 2026-08-18. | Not used as a default endpoint. |
| `https://brain.pin-yi.uk/api/plugins` | Returned a valid plugin list on 2026-08-18. It exposed GitHub, Google Drive, Google Cloud, Cloudflare, image generation, TTS, and exchange plugin metadata; Cloudflare, image generation, and exchange were enabled. | Can be used as the current service base URL for the App plugin screen. |
| `https://brain.pin-yi.uk/health` | Returned `{ "status": "healthy" }` on 2026-08-18. | Use as the native service availability check. |
| `https://brain.pin-yi.uk/trade/balance` | Returned `{ "balance": "0.0000 USDT" }` on 2026-08-18. | Use as the current read-only trading balance summary. |

## Required API confirmation

The captured route locator identifies `GET /trade/positions` in the native server source, but its public response shape and authentication requirements are not yet confirmed. The App can use `https://brain.pin-yi.uk` as the current base URL for the verified plugin, health, and balance endpoints. Add the positions monitor after the response shape has been safely confirmed through a GET-only request; do not use `GET /trade/auto/start` because it starts an automation flow despite being a GET route.
