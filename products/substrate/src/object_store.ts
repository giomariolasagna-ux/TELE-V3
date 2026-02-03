
// Mock Object Store (Phase 1: In-Memory)
import { ActionObject, CleanupPlanObject, WorkspaceObject, EventObject, ArtifactObject } from '../../../integrations/gateway_bridge';
import { globalEventBus, BusEventType, EventPayload } from './event_bus';

export class ObjectStore {
    private actions: Map<string, ActionObject> = new Map();
    private plans: Map<string, CleanupPlanObject> = new Map();
    private workspaces: Map<string, WorkspaceObject> = new Map();

    // Phase 10: Events & Artifacts
    private events: EventObject[] = [];
    private artifacts: ArtifactObject[] = [];

    // Bus for streaming
    private bus = globalEventBus;

    async saveAction(action: ActionObject) {
        this.actions.set(action.id, action);
        this.bus.emitEvent(BusEventType.OBJECT_UPDATE, { type: 'ACTION', object: action });
        // Also emit a timeline event for creation
        this.emitTimelineEvent('Action Created', { actionId: action.id, type: action.type });
    }

    async getAction(id: string) {
        return this.actions.get(id);
    }

    async savePlan(plan: CleanupPlanObject) {
        this.plans.set(plan.id, plan);
        this.bus.emitEvent(BusEventType.OBJECT_UPDATE, { type: 'PLAN', object: plan });
    }

    async getPlan(id: string) {
        return this.plans.get(id);
    }

    // Phase 10: Event & Artifact Methods

    // Circular buffer for replay
    private eventLog: EventPayload[] = [];
    private readonly MAX_LOG_SIZE = 1000;

    constructor() {
        // Bind to bus to auto-record all events
        this.bus.on('event', (payload: EventPayload) => {
            this.recordEvent(payload);
        });
    }

    private recordEvent(payload: EventPayload) {
        this.eventLog.push(payload);
        if (this.eventLog.length > this.MAX_LOG_SIZE) {
            this.eventLog.shift();
        }
    }

    // Replay logic
    async getEventsSince(lastEventId: string | null): Promise<EventPayload[]> {
        if (!lastEventId) {
            // Return last 50 if no ID provided (initial load)
            return this.eventLog.slice(-50);
        }

        const index = this.eventLog.findIndex(e => e.eventId === lastEventId);
        if (index === -1) {
            // ID not found (too old or invalid), return backlog safety net
            return this.eventLog.slice(-100);
        }

        // Return everything after that index
        return this.eventLog.slice(index + 1);
    }

    async emitTimelineEvent(description: string, metadata?: any, typeOverride?: BusEventType) {
        // Helper to emit a simple human readable timeline event
        // This actually just emits to bus, which then records it back here via listener
        // But we want to construct the data payload for the 'TIMELINE_EVENT' type
        this.bus.emitEvent(typeOverride || BusEventType.TIMELINE_EVENT, {
            description,
            metadata
        });
    }

    async saveArtifact(artifact: ArtifactObject) {
        this.artifacts.push(artifact);
        this.bus.emitEvent(BusEventType.ARTIFACT_GENERATED, artifact);
        // Timeline event is automatic if we want, or manual:
        this.emitTimelineEvent(`Artifact Created: ${artifact.type}`, { artifactId: artifact.id, path: artifact.path });
    }


    // Queries
    async getAllActions() {
        return Array.from(this.actions.values()).reverse(); // Newest first
    }

    async getAllPlans() {
        return Array.from(this.plans.values()).reverse();
    }

    async getCurrentWorkspace() {
        if (this.workspaces.size === 0) return null;
        return Array.from(this.workspaces.values()).pop(); // Last created
    }

    async getRecentEvents() {
        return this.events.slice().reverse(); // Newest first
    }

    async getAllArtifacts() {
        return this.artifacts.slice().reverse();
    }
}
