
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';

// Event Types
export enum BusEventType {
    // Lifecycle
    RUNTIME_STARTED = 'RUNTIME_STARTED',
    UI_CONNECTED = 'UI_CONNECTED',

    // Core Objects
    OBJECT_UPDATE = 'OBJECT_UPDATE',        // Generic update for Action/Plan/Workspace

    // Action / Plan Flow
    INTENT_RECEIVED = 'INTENT_RECEIVED',
    ACTION_STARTED = 'ACTION_STARTED',
    ACTION_PROGRESS = 'ACTION_PROGRESS',
    ACTION_DONE = 'ACTION_DONE',
    ACTION_FAILED = 'ACTION_FAILED',

    // Session / FS
    SCAN_STARTED = 'SCAN_STARTED',
    SCAN_PROGRESS = 'SCAN_PROGRESS',
    SCAN_DONE = 'SCAN_DONE',
    CLEANUP_STARTED = 'CLEANUP_STARTED',
    CLEANUP_ITEM = 'CLEANUP_ITEM',
    CLEANUP_DONE = 'CLEANUP_DONE',

    // Timeline & Artifacts
    TIMELINE_EVENT = 'TIMELINE_EVENT',      // Human readable
    ARTIFACT_GENERATED = 'ARTIFACT_GENERATED',

    // Low Level
    FS_ACTIVITY = 'FS_ACTIVITY'
}

// Interfaces
export interface EventPayload {
    eventId: string;     // Monotonic / ULID-like
    type: BusEventType;
    timestamp: number;
    source: 'SYSTEM' | 'USER' | 'AGENT' | 'FS';
    data: any;
}

export class EventBus extends EventEmitter {
    private eventCounter = 0;

    constructor() {
        super();
        this.setMaxListeners(50);
    }

    // Monotonic ID generation (simple timestamp + counter for now)
    private generateId(): string {
        const now = Date.now();
        this.eventCounter++;
        return `${now}-${this.eventCounter}`;
    }

    emitEvent(type: BusEventType, data: any, source: EventPayload['source'] = 'SYSTEM') {
        const payload: EventPayload = {
            eventId: this.generateId(),
            type,
            timestamp: Date.now(),
            source,
            data
        };

        // Emit generic 'event' for loggers/stores
        this.emit('event', payload);

        // Emit specific type for targeted listeners
        this.emit(type, payload);

        // Console log for debug (verbose)
        // console.log(`[Bus] ${type} (${payload.eventId})`);
    }
}

// Global singleton instance
export const globalEventBus = new EventBus();
