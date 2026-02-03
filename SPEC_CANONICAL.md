# SPEC_CANONICAL.md
[PROJECT: COGNITIVE_DESKTOP_SUBSTRATE]
[STATUS: CANONICAL]
[GOAL: BUILD A WORKING PRODUCT NOW]

## 0. Prodotto (definizione)
Un “substrato” sopra Windows che rende il computer:
- più coerente nel tempo (anti-entropia)
- guidabile a voce (voice-first)
- controllabile con sessioni e oggetti (object-first, session-based)
- integrabile con canali multipiattaforma (messaggistica come remote control plane)
- capace di orchestrare AI locali + cloud (local-first + Moonshot Kimi K2.5)

Il prodotto non è un “chatbot”. È un **assistente operativo** che governa sessioni, stato e azioni.

## 1. Promessa utente
- “Il PC resta snappy nel tempo.”
- “Riparto dal contesto di lavoro senza caos.”
- “Posso parlare al computer e interrompere in tempo reale.”
- “Il mio desktop è un notebook a oggetti e collegamenti.”
- “Controllo anche da telefono (via canali), senza esporre il PC.”

## 2. Principi non negoziabili
- Nessun kernel hacking / UEFI / driver patching.
- Ogni azione importante è visibile come oggetto nel Notebook.
- Nessuna azione distruttiva senza gesto esplicito (drag/hold).
- Nessun invio silenzioso di dati sensibili al cloud.
- AI procedurale e interrompibile (STOP/PAUSE/CONTINUE).
- Sessioni come unità primaria: inizio/vita/fine e ciclo di vita dello stato.
- Separation of concerns:
  - “Gateway Core” (canali e routing) è infrastruttura
  - Il “Substrate Product” è l’esperienza utente (Notebook + Session Kernel + Agents)

## 3. Moduli del sistema (alto livello)
A) UX Notebook (desktop = notebook a oggetti)
B) Session Kernel Anti-Entropy (workspace, redirection, governance)
C) Voice Stack (STT + TTS local-first + interrupt)
D) Agent System (planner/executor/predictor/security/observer)
E) Vision Module (screen/context perception, con regole privacy)
F) Multiplatform Gateway Core (canali: Telegram/WhatsApp/Discord/etc)
G) Integrations (n8n, web hosting, app connectors)
H) Local Models (LM Studio) + Cloud Model (Moonshot Kimi K2.5)

## 4. Vincolo repo
Il progetto vive in una repo unica. Il Gateway Core è incluso come “core features” ma:
- niente nome originale
- niente UX originale
- solo infrastruttura necessaria per canali, wizard, routing

## 5. Output richiesto oggi (demo reale)
- avvio del runtime
- notebook overlay visibile
- creazione sessione (mode: LIGHT/DEV/CREATIVE/AI)
- drop space + drop actions
- almeno 1 pipeline visuale collegabile (mock n8n ok)
- pulizia file temporanei (safe + gesto)
- controllo remoto via almeno 1 canale (mock ok)
- voice loop base con STOP immediato (local-first)
