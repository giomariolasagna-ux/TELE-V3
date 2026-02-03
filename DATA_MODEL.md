# DATA_MODEL.md
[STATUS: CANONICAL OBJECT MODEL]
L’intero sistema ruota attorno a OGGETTI.

## 1. Object categories
- SessionObject
- WorkspaceObject
- AssetObject
- NodeObject
- PipelineObject
- ActionObject
- DriftEventObject
- MetricSnapshotObject
- ClipObject (Special Clip)
- DropSpaceObject
- PolicyObject
- IntentEventObject

## 2. Common fields (tutti)
- id (uuid)
- type
- createdAt
- updatedAt
- owner (user/device)
- sensitivity: PUBLIC | PERSONAL | SENSITIVE | SECRET
- provenance: USER | SYSTEM | AGENT | GATEWAY
- links[] (IDs di altri oggetti)
- tags[] (stringhe)

## 3. SessionObject (minimo)
- id, name
- mode: LIGHT | DEV | CREATIVE | AI
- status: ACTIVE | PAUSED | ENDED
- workspaceId
- startTime, endTime
- allowlistProcesses[]
- denylistProcesses[]
- cleanupPolicy: FULL_RESET | ROTATE_N | HYBRID | PINNED
- history[] (ActionObject IDs)

## 4. ActionObject
- actionType (StartSession, ResetWorkspace, QuarantineFile, KillProcess, CreatePipeline, Deploy, etc.)
- targetObjectId
- parameters (structured)
- requiresGesture: true/false
- gestureProof (filled when authorized)
- status: PLANNED | READY | RUNNING | DONE | FAILED
- reason (short)
- reversible: true/false
- rollbackPlan (optional)
- audit (timestamps + result)

## 5. DropSpaceObject
- name
- inputAssets[] (AssetObject IDs)
- dropActions[] (PipelineObject IDs)
- outputs[] (AssetObject IDs)
- notes (short)

## 6. Security rule (hard)
Sensitivity SECRET is never:
- sent to cloud models
- shown in plain text
- included in outbound messages
Must be redacted or referenced indirectly.
