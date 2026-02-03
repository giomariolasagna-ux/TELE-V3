# SESSION_KERNEL.md
[STATUS: CANONICAL — ANTI-ENTROPY SESSION KERNEL]
Obiettivo: impedire a Windows di “invecchiare” gestendo lo stato.

## 1. TELE_BASE vs TELE_WORKSPACE
- BASE: OS + driver + golden apps + runtime
- WORKSPACE: temp, cache, shader cache, logs, scratch, build artifacts

## 2. Workspaces MANY
- per-session: WORKSPACE/Sessions/<sid>/
- shared: WORKSPACE/Shared/ (configurabile)
Policy: FULL_RESET | ROTATE_N | HYBRID | PINNED

## 3. Redirection (no kernel mods)
Usare:
- junction/symlink
- env vars override
- app settings per cache path
Minimo:
- %TEMP% %TMP% -> per-session Temp
- AI scratch -> per-session
- shader cache -> shared o per-session (policy)

## 4. Session modes (non power profiles)
LIGHT / DEV / CREATIVE / AI
Ogni mode definisce:
- allowlist/denylist
- cleanup policy
- cpu priority hints (best-effort)
- gpu hygiene hooks (best-effort)

## 5. Process governance (deterministico)
Process Curator:
- enforcement (non suggestion)
- ogni kill/suspend = ActionObject
- mai uccidere processi critici senza regole + sicurezza

## 6. Drift detection + rollback/quarantine
Baseline:
- startup entries
- scheduled tasks
- services
- key env vars
- metrics baseline
DriftEvent quando cambia qualcosa.
Rollback/quarantine come azioni oggettuali e reversibili.

## 7. Metrics (tail latency)
Track p95:
- app launch
- I/O queue depth (proxy ok)
- boot segmentation
- hitch frequency (proxy)
Expose come MetricSnapshotObject.
