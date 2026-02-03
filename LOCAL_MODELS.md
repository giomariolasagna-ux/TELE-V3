# LOCAL_MODELS.md
[STATUS: CANONICAL — LOCAL + CLOUD AI]

## 1. Local-first routing
LM Studio modelli locali usati per:
- parsing intent
- risposte immediate
- tagging e classificazione oggetti
- suggerimenti leggeri
- offline mode

## 2. Cloud (Moonshot Kimi K2.5)
Usato per:
- planning complesso
- visual coding
- orchestration multi-step
- build/patch generation

## 3. Rules
- cloud riceve solo oggetti strutturati e redatti
- mai raw filesystem
- mai segreti
- mai screenshot in chiaro senza regole privacy
