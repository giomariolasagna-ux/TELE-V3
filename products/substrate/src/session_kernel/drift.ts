
import { DriftEventObject } from '../../../../integrations/gateway_bridge';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';

const BASELINE_PATH = path.join(process.cwd(), '.tele', 'drift', 'baseline.json');

export class DriftMonitor {
    private baseline: Record<string, string> | null = null;

    constructor() {
        this.ensureDriftDir();
    }

    private ensureDriftDir() {
        const driftDir = path.dirname(BASELINE_PATH);
        if (!fs.existsSync(driftDir)) {
            fs.mkdirSync(driftDir, { recursive: true });
        }
    }

    captureSnapshot(): Record<string, string> {
        // MVP: Capture basic safe environment variables
        const keysToWatch = ['PATH', 'TEMP', 'TMP', 'USERNAME', 'OS', 'NUMBER_OF_PROCESSORS'];
        const snapshot: Record<string, string> = {};
        for (const key of keysToWatch) {
            snapshot[key] = process.env[key] || '';
        }
        return snapshot;
    }

    async initializeBaseline(): Promise<void> {
        if (fs.existsSync(BASELINE_PATH)) {
            console.log("[DriftMonitor] Loading existing baseline...");
            this.baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf-8'));
        } else {
            console.log("[DriftMonitor] Creating new baseline...");
            this.baseline = this.captureSnapshot();
            fs.writeFileSync(BASELINE_PATH, JSON.stringify(this.baseline, null, 2));
        }
    }

    async checkDrift(): Promise<DriftEventObject | null> {
        if (!this.baseline) await this.initializeBaseline();

        const current = this.captureSnapshot();
        const changedKeys: string[] = [];

        for (const key in this.baseline) {
            if (this.baseline[key] !== current[key]) {
                changedKeys.push(key);
            }
        }

        if (changedKeys.length > 0) {
            return {
                id: uuidv4(),
                createdAt: new Date().toISOString(),
                changedKeys,
                severity: 'LOW', // MVP assumption usually Env var drift is low unless PATH
                snapshot: current
            }
        }
        return null;
    }
}
