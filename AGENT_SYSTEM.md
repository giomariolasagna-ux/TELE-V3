# AGENT_SYSTEM.md
[STATUS: CANONICAL — AGENTS]

## 1. Ruoli agenti
- Planner Agent: costruisce ActionPlan
- Executor Agent: esegue azioni autorizzate
- Predictor Agent: suggerisce next steps (non esegue)
- Security Agent: redaction, permissioning, anomaly detection
- Observer Agent: costruisce memoria muscolare e metriche
- Process Curator Agent: governance processi (session kernel)

## 2. Regole
- Nessun agente ha accesso diretto al filesystem raw.
- Tutto passa tramite oggetti.
- Ogni azione produce ActionObject.
- Security Gate è obbligatorio prima di qualsiasi esecuzione.

## 3. Training / “muscle memory”
Il sistema apprende pattern:
- sequenze app
- correzioni frequenti
- preferenze implicite
Output = suggerimenti procedurali “umani”.
Non memorizzare dati sensibili in chiaro.
