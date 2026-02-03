
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { globalEventBus, BusEventType } from './event_bus';

export class BootPipeline {
    private bootstampPath: string;

    constructor() {
        this.bootstampPath = path.join(os.homedir(), '.tele', 'bootstamp.json');
    }

    async run() {
        globalEventBus.emitEvent(BusEventType.RUNTIME_STARTED, { timestamp: Date.now() });

        if (fs.existsSync(this.bootstampPath)) {
            console.log('[Boot] Bootstamp found. Skipping induction.');
            return;
        }

        console.log('[Boot] First boot detected. Starting induction pipeline...');

        // 1. Emit Start Event
        globalEventBus.emitEvent(BusEventType.SCAN_STARTED, { scope: 'FULL_SYSTEM' });

        // 2. Simulate Scanning (Mock for V1, V2 will use real scan)
        let progress = 0;
        const interval = setInterval(() => {
            progress += 10;
            globalEventBus.emitEvent(BusEventType.SCAN_PROGRESS, { progress, message: `Scanning System... ${progress}%` });

            if (progress === 50) {
                globalEventBus.emitEvent(BusEventType.CLEANUP_ITEM, { path: 'C:\\Windows\\Temp\\trash_cluster_01', size: '2.4GB' });
            }

            if (progress >= 100) {
                clearInterval(interval);
                this.completeBoot();
            }
        }, 500);
    }

    private completeBoot() {
        globalEventBus.emitEvent(BusEventType.SCAN_DONE, { totalSize: '450GB', trashDetected: '4.2GB' });

        // Create Artifact
        const report = {
            id: require('uuid').v4(),
            type: 'FILE',
            name: 'OptimizationReport.json',
            createdAt: Date.now(),
            preview: 'System Analysis Report\n- 4GB Trash found\n- 12 Hot Paths identified'
        };

        // We need ObjectStore reference ideally, or just emit event and assume Store listens (which it does!)
        // However, Store listens to 'ARTIFACT_GENERATED' usually to save it, wait.. Store listens to 'event' generic.
        // But Store needs to SAVE it. 
        // In our architecture, Store is the passive listener? No, Store is the persistent layer.
        // We should emit ARTIFACT_GENERATED, and if Store is subscribed to bus it will pick it up?
        // Actually Store records ALL events to log, but artifacts array specifically? 
        // Let's emit ARTIFACT_GENERATED and trust Store logic update below.

        globalEventBus.emitEvent(BusEventType.ARTIFACT_GENERATED, report);

        // Write bootstamp
        fs.writeFileSync(this.bootstampPath, JSON.stringify({ bootedAt: Date.now() }));
    }
}
