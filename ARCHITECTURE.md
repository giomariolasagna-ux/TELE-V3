# ARCHITECTURE.md
[STATUS: CANONICAL ARCHITECTURE]

## 0. Boundary: Gateway Core vs Substrate Product
### Gateway Core (core features da integrare “senza nome”)
- Channel connectors (Telegram/Slack/Discord/etc)
- Message routing + normalization
- Workspace management (solo per gateway, non il nostro notebook)
- Onboarding wizard (opzionale)
- Auth/pairing per canali
- Webhooks / incoming events
- Outbound messaging

### Substrate Product (il vostro prodotto)
- Notebook UI overlay (desktop a oggetti)
- Session Kernel (anti-entropy, workspace, policies)
- Agents (planner/executor/security/predictor)
- Voice Stack (STT/TTS, interrupt, feedback)
- Local + Cloud AI orchestration
- Integrations (n8n, IDE, hosting, apps)
- Metrics, drift detection, rollback/quarantine

## 1. Bridge interface (minimale, obbligatoria)
Il Gateway Core NON deve conoscere il prodotto.
Comunica via bridge.

### GatewayBridge API
- onIntent(intentObject): IntentEvent -> Substrate
- emitUpdate(updateObject): Substrate -> Gateway (status, progress)
- sendMessage(channel, redactedPayload): Substrate -> Gateway

## 2. Data flow (canonico)
Channel message -> Gateway normalizes -> IntentEvent -> Substrate Planner
-> ActionPlan -> Security Gate -> Execution -> Update + RedactedResponse
-> Gateway sends message.

## 3. Execution model
- Event-driven
- Object-first state
- All actions become ActionObjects, stored in session history
- No silent destructive actions

## 4. Suggested repo layout
/spec (questa cartella)
/gateway_core (infrastruttura canali)
/products/substrate
  /core
  /ui
  /agents
  /ai
  /session_kernel
  /integrations
  /platform/windows
/integrations/gateway_bridge
/demo
