/**
 * Action Log - Complete Audit Trail
 * Records all executed actions with timing, results, and context
 */

import * as fs from 'fs';
import * as path from 'path';
import { LOGS_DIR, cleanOldFiles } from './agent_paths';

export interface ActionLogEntry {
    id: string;
    timestamp: number;
    type: string;
    payload: any;
    result: 'success' | 'failure' | 'cancelled';
    latencyMs: number;
    error?: string;
    context?: Record<string, any>;
}

interface LogFile {
    version: number;
    entries: ActionLogEntry[];
}

const MAX_ENTRIES_PER_FILE = 1000;
const MAX_LOG_FILES = 10;
const MAX_TOTAL_SIZE_BYTES = 50 * 1024 * 1024; // 50MB

export class ActionLog {
    private currentFile: string;
    private data: LogFile;

    constructor() {
        this.currentFile = this.getCurrentLogPath();
        this.data = this.load();
    }

    private getCurrentLogPath(): string {
        const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
        return path.join(LOGS_DIR, `actions_${date}.json`);
    }

    private load(): LogFile {
        try {
            if (fs.existsSync(this.currentFile)) {
                const raw = fs.readFileSync(this.currentFile, 'utf8');
                return JSON.parse(raw);
            }
        } catch (error) {
            console.error('[ActionLog] Failed to load:', error);
        }
        return { version: 1, entries: [] };
    }

    private save(): void {
        try {
            if (!fs.existsSync(LOGS_DIR)) {
                fs.mkdirSync(LOGS_DIR, { recursive: true });
            }
            fs.writeFileSync(this.currentFile, JSON.stringify(this.data, null, 2));
        } catch (error) {
            console.error('[ActionLog] Failed to save:', error);
        }
    }

    /**
     * Log an action execution
     */
    log(entry: ActionLogEntry): void {
        // Check if we need to rotate to new file
        const newPath = this.getCurrentLogPath();
        if (newPath !== this.currentFile) {
            this.currentFile = newPath;
            this.data = this.load();
        }

        // Check if current file is full
        if (this.data.entries.length >= MAX_ENTRIES_PER_FILE) {
            this.rotateFile();
        }

        this.data.entries.push(entry);
        this.save();

        // Async cleanup
        setImmediate(() => cleanOldFiles(LOGS_DIR, MAX_LOG_FILES, MAX_TOTAL_SIZE_BYTES));
    }

    private rotateFile(): void {
        const timestamp = Date.now();
        const newName = `actions_${timestamp}.json`;
        this.currentFile = path.join(LOGS_DIR, newName);
        this.data = { version: 1, entries: [] };
    }

    /**
     * Get recent actions
     */
    getRecentActions(limit: number = 50): ActionLogEntry[] {
        const allEntries = this.getAllEntries();
        return allEntries.slice(-limit).reverse();
    }

    /**
     * Get actions by type
     */
    getActionsByType(type: string, limit: number = 50): ActionLogEntry[] {
        const allEntries = this.getAllEntries();
        return allEntries
            .filter(e => e.type === type)
            .slice(-limit)
            .reverse();
    }

    /**
     * Get failed actions
     */
    getFailedActions(limit: number = 20): ActionLogEntry[] {
        const allEntries = this.getAllEntries();
        return allEntries
            .filter(e => e.result === 'failure')
            .slice(-limit)
            .reverse();
    }

    /**
     * Get success rate for an action type
     */
    getSuccessRate(type: string): { total: number; success: number; rate: number } {
        const actions = this.getActionsByType(type, 1000);
        const success = actions.filter(a => a.result === 'success').length;
        return {
            total: actions.length,
            success,
            rate: actions.length > 0 ? success / actions.length : 0
        };
    }

    /**
     * Get average latency for an action type
     */
    getAverageLatency(type: string): number {
        const actions = this.getActionsByType(type, 100)
            .filter(a => a.result === 'success');

        if (actions.length === 0) return 0;

        const total = actions.reduce((sum, a) => sum + a.latencyMs, 0);
        return Math.round(total / actions.length);
    }

    private getAllEntries(): ActionLogEntry[] {
        // For now, just return current file. Could expand to read all log files.
        return this.data.entries;
    }

    /**
     * Search actions by keyword in payload
     */
    search(keyword: string, limit: number = 20): ActionLogEntry[] {
        const lower = keyword.toLowerCase();
        return this.getAllEntries()
            .filter(e => JSON.stringify(e.payload).toLowerCase().includes(lower))
            .slice(-limit)
            .reverse();
    }
}

// Singleton export
export const actionLog = new ActionLog();
