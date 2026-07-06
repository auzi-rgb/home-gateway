# Follow-Up Notes

## Hearth / Home Finance AI Chat

During live gateway testing, `home-finance` successfully reached the gateway and received a `200` from Ollama through the gateway, but the request held an active slot for almost exactly 300 seconds and did not visibly answer in the finance UI.

Evidence from gateway telemetry:

- `dnd-combat` completed a `generate` request in about 79 seconds.
- `home-finance` completed a `chat` request with status `200`, but duration was about 300 seconds.
- The gateway queue and Ollama path were healthy, so the next investigation should focus on Hearth's `/api/ai/chat` streaming path and frontend response handling.

Recommended next pass:

- Show a clearer streaming/thinking state in the Hearth AI UI.
- Surface timeout or slow-response messages instead of appearing idle.
- Check whether the frontend receives chunks during long streamed responses.
- Consider trimming the finance context or using non-streaming requests for actions that need structured JSON.
