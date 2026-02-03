# BUILD_PLAN.md
[STATUS: BUILD — DEMO FIRST]

## 1. Priorità build (vertical slice)
1) Object model + storage (SQLite o equivalente)
2) Session engine
3) Notebook overlay minimal (3 colonne)
4) Drop space + oggetti base
5) Session kernel: temp redirection + cleanup gesture
6) Voice loop: STT/TTS + STOP
7) Gateway bridge: 1 canale demo (mock ok)
8) Metrics snapshot (minimo)
9) Drift detection (mock ok)

## 2. Stop conditions
Se una feature:
- viola object-first/session-based
- compie azione invisibile
- manda dati sensibili al cloud
-> fermarsi, segnalare, correggere.

## 3. Deliverable
Un comando “run demo” che avvia:
- gateway core
- substrate runtime
- notebook overlay
