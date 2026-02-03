# PATCH_POLICY.md
[STATUS: PATCH DISCIPLINE — MUST FOLLOW]

## 1. No rewrite
Preferire patch incrementali. Vietato riscrivere core senza motivo.

## 2. Patch format
Ogni patch deve includere:
- scopo
- file toccati
- rischio
- test per verificare

## 3. Open-source gateway core integration
Il Gateway Core è infrastruttura: non si modifica la sua “identity UX”.
Il prodotto vive in /products/substrate.

## 4. Spec is law
Se il codice contraddice SPEC_CANONICAL, si corregge il codice o si aggiorna la spec (con motivazione).
