# SECURITY_MODEL.md
[STATUS: CANONICAL — SECURITY WITHOUT SNATURARE IL PRODOTTO]

## 1. Obiettivo
Sicurezza alta senza uccidere UX e creatività.

## 2. Threat model (minimo)
- prompt injection (testo / voce / canali)
- data exfiltration via agenti
- abuso di azioni distruttive
- supply chain / plugin risk
- insider misuse su device condivisi

## 3. Principi
- least privilege per agenti
- object-level permissions
- redaction by default per cloud calls
- gesture-gated destructive actions
- quarantine-first, delete-second
- audit log locale (non cloud)

## 4. Data classes
PUBLIC / PERSONAL / SENSITIVE / SECRET
SECRET:
- mai in chiaro nel notebook
- mai inviato a cloud model
- referenziato via handle/token

## 5. Secure execution
- allowlist di azioni
- denylist processi noti per persistenza (best-effort)
- emergency stop / restore mappings
