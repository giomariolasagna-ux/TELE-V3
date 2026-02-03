// TELE Bridge Contract
// Status: Canonical Phase 1
export { UUID } from './index'; // Self-ref if needed, but actually we just export types directly below.

// Status: Canonical Phase 1

export type UUID = string;

// --- Data Model Types for Bridge ---

export enum Sensitivity {
    PUBLIC = "PUBLIC",
    PERSONAL = "PERSONAL",
    SENSITIVE = "SENSITIVE",
    SECRET = "SECRET"
}

export type IntentEventObject = {
    id: UUID;
    sourceChannel: string;
    sourceUserId: string;
    timestamp: string;
    rawContent: string;
    // In Phase 1 we might not use parsedIntent fully yet, but rawContent is key
    parsedIntent?: any;
    metadata?: any;
};

export type ActionObject = {
    id: UUID;
    type: string;
    payload: any;
    requiresGesture: boolean;
    status: 'PLANNED' | 'READY' | 'RUNNING' | 'DONE' | 'FAILED';
};

export type UpdateObject = {
    eventId: UUID; // Links back to IntentEventObject or Action
    status: string;
    progress?: number; // 0-100
    message?: string; // Human readable progress
    data?: any; // Optional payload (e.g. producing an Object ID)
};

// --- Session Kernel Types ---

export type WorkspaceObject = {
    id: UUID;
    sessionId: string;
    path: string;
    mode: 'LIGHT' | 'DEV' | 'CREATIVE' | 'AI';
    status: 'ACTIVE' | 'ARCHIVED';
    createdAt: string;
};

export type CleanupItem = {
    path: string;
    sizeBytes: number;
    category: 'TEMP' | 'CACHE' | 'LOG' | 'UNKNOWN';
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
};

export type CleanupPlanObject = {
    id: UUID;
    createdAt: string;
    items: CleanupItem[];
    totalBytes: number;
    recommendedAction: 'QUARANTINE' | 'DELETE';
    status: 'PLANNED' | 'EXECUTED' | 'DISCARDED';
};

export type DriftEventObject = {
    id: UUID;
    createdAt: string;
    changedKeys: string[];
    severity: 'LOW' | 'MEDIUM' | 'HIGH';
    snapshot: any;
};

export type MetricSnapshotObject = {
    id: UUID;
    timestamp: string;
    workspaceBytes: number;
    tempBytesDetected: number;
    quarantineBytesMoved: number;
    cleanupDurationMs: number;
    scanDurationMs: number;
};

// --- Voice & Interrupt Types ---

export type InterruptType = 'STOP' | 'PAUSE' | 'CONTINUE';

export type InterruptEvent = {
    id: UUID;
    type: InterruptType;
    timestamp: string;
    metadata?: any;
};

// Voice service emits these either as Intents (transcribed) or Interrupts (keyword detected)
export type VoicePacket =
    | { type: 'INTENT'; payload: IntentEventObject }
    | { type: 'INTERRUPT'; payload: InterruptEvent };

// --- Bridge Interface ---

export interface ChannelAdapter {
    name: string;
    sendMessage(userId: string, text: string): Promise<void>;
}

export interface GatewayBridge {
    /**
     * Called by Gateway when a message/event arrives from a channel.
     * Gateway is responsible for normalizing channel-specific data into IntentEventObject.
     * Substrate (Product) MUST implement this to handle the intent.
     */
    onIntent(intent: IntentEventObject): Promise<void>;

    /**
     * Called by Gateway to register a channel adapter.
     * Gateway will use this adapter to send messages back to the user's channel.
     */
    registerChannelAdapter(adapter: ChannelAdapter): void;

    /**
     * Called by Substrate (Product) to notify Gateway of progress/status updates.
     * Gateway sends this to the user (e.g. typing indicators, status messages).
     */
    emitUpdate(update: UpdateObject): Promise<void>;

    /**
     * Called by Substrate (Product) to send a final or intermediate message back to a channel.
     * PAYLOAD MUST BE REDACTED.
     */
    sendMessage(channelId: string, redactedPayload: string): Promise<void>;
}
