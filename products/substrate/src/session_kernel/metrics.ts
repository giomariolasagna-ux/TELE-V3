
import { MetricSnapshotObject } from '../../../../integrations/gateway_bridge';
import { v4 as uuidv4 } from 'uuid';

export class MetricsCollector {
    private currentSnapshot: MetricSnapshotObject;

    constructor() {
        this.reset();
    }

    reset() {
        this.currentSnapshot = {
            id: uuidv4(),
            timestamp: new Date().toISOString(),
            workspaceBytes: 0,
            tempBytesDetected: 0,
            quarantineBytesMoved: 0,
            cleanupDurationMs: 0,
            scanDurationMs: 0
        };
    }

    recordScan(bytesDetected: number, durationMs: number) {
        this.currentSnapshot.tempBytesDetected = bytesDetected;
        this.currentSnapshot.scanDurationMs = durationMs;
    }

    recordCleanup(bytesMoved: number, durationMs: number) {
        this.currentSnapshot.quarantineBytesMoved = bytesMoved;
        this.currentSnapshot.cleanupDurationMs = durationMs;
    }

    getSnapshot(): MetricSnapshotObject {
        this.currentSnapshot.timestamp = new Date().toISOString();
        return { ...this.currentSnapshot }; // clone
    }
}
