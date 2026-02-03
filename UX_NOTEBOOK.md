# UX_NOTEBOOK.md
[STATUS: CANONICAL UX]

## 0. UX Thesis
Il “desktop” è un Notebook a oggetti, non una griglia di icone.

## 1. Layout (3 colonne + overlay)
A) Sinistra: Interazione AI (voice-first, testo opzionale) + controlli sessione
B) Centro: Desktop/Notebook canvas (oggetti, cartelle, collegamenti)
C) Destra: Session history (commit-like timeline) + Recent Paths + Special Clip

Overlay:
- appare sopra desktop
- toggle minimale per show/hide

## 2. Oggetti manipolabili (drag & drop)
- file / folder references
- session snippets (azioni passate trascinabili)
- recent paths
- clips (multi-copy/paste evoluto)
- pipeline nodes
- drop spaces

## 3. Session continuity (boot UX)
All’avvio:
- sistema propone ripresa contesto
- app precedenti in taskbar (non full-screen)
- notebook mostra “previous flow” come timeline

## 4. Drop Space (concetto)
Drop Space = spazio dove butti roba e attacchi azioni/pipeline.
Non è una cartella. È un “momento operativo”.

Include:
- input
- drop actions (pipeline)
- output
- log visibile (non tecnico)

## 5. Interruzione procedurale
Durante una procedura:
- utente può dire STOP
- il sistema si ferma e mostra stato come oggetti
- utente modifica e riparte

## 6. Nessuna UX invasiva
- niente pop-up aggressivi
- le azioni sensibili richiedono gesto, non schermate di panico
