# VOICE_STACK.md
[STATUS: CANONICAL — VOICE-FIRST]

## 1. Voice is primary
La voce è il canale principale. Il testo è secondario.

## 2. Local-first
Pipeline:
Mic -> STT local -> Intent parser -> Action plan -> Feedback
TTS local per persona voce.

## 3. Interrupt keys
Parole ad alta priorità:
STOP / PAUSE / CONTINUE / ANNULLA
Effetto immediato.

## 4. Voice != command
Una frase vocale produce IntentEventObject, non un comando diretto.
Azioni sensibili richiedono gesto.

## 5. Feedback
- breve
- contestuale
- non logorroico

## 6. Remote voice
Da remoto: intent ok, ma azioni critiche richiedono conferma sul device locale.
