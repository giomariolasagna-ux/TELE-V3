// Builder Channel - File-based communication with Antigravity

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { PatchRequest, PatchResult } from './patch_request';

const BUILDER_DIR = path.join(os.homedir(), '.tele', 'builder');
const INBOX = path.join(BUILDER_DIR, 'inbox');
const OUTBOX = path.join(BUILDER_DIR, 'outbox');
const LOCKS = path.join(BUILDER_DIR, 'locks');
const LOG = path.join(BUILDER_DIR, 'log');

export class BuilderChannel {
    constructor() {
        // Ensure directories exist
        [INBOX, OUTBOX, LOCKS, LOG].forEach(dir => {
            fs.mkdirSync(dir, { recursive: true });
        });
    }

    // Write a PatchRequest to inbox
    async sendRequest(request: PatchRequest): Promise<void> {
        const filename = `patch_request_${Date.now()}_${request.id}.json`;
        const lockPath = path.join(LOCKS, `${request.id}.lock`);
        const filePath = path.join(INBOX, filename);

        // Create lock
        fs.writeFileSync(lockPath, JSON.stringify({ lockedAt: Date.now() }));

        // Write request
        fs.writeFileSync(filePath, JSON.stringify(request, null, 2));

        // Log
        this.log(`Sent request: ${request.title} (${request.id})`);
    }

    // Check for results in outbox
    async checkResults(): Promise<PatchResult[]> {
        const files = fs.readdirSync(OUTBOX).filter(f => f.endsWith('.json'));
        const results: PatchResult[] = [];

        for (const file of files) {
            try {
                const content = fs.readFileSync(path.join(OUTBOX, file), 'utf-8');
                const result: PatchResult = JSON.parse(content);
                results.push(result);
            } catch (e) {
                console.error(`[BuilderChannel] Error reading ${file}:`, e);
            }
        }

        return results;
    }

    // Consume a result (move to processed or delete)
    async consumeResult(result: PatchResult): Promise<void> {
        const pattern = `patch_result_*_${result.requestId}.json`;
        const files = fs.readdirSync(OUTBOX).filter(f => f.includes(result.requestId));

        for (const file of files) {
            // Remove file
            fs.unlinkSync(path.join(OUTBOX, file));
        }

        // Remove lock if exists
        const lockPath = path.join(LOCKS, `${result.requestId}.lock`);
        if (fs.existsSync(lockPath)) {
            fs.unlinkSync(lockPath);
        }

        this.log(`Consumed result for: ${result.requestId}`);
    }

    // Check for stale locks (timeout recovery)
    async checkStaleLocks(timeoutMs: number = 300000): Promise<string[]> {
        const stale: string[] = [];
        const files = fs.readdirSync(LOCKS);

        for (const file of files) {
            const lockPath = path.join(LOCKS, file);
            const content = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));

            if (Date.now() - content.lockedAt > timeoutMs) {
                stale.push(file.replace('.lock', ''));
            }
        }

        return stale;
    }

    private log(message: string) {
        const logFile = path.join(LOG, `${new Date().toISOString().split('T')[0]}.log`);
        const entry = `[${new Date().toISOString()}] ${message}\n`;
        fs.appendFileSync(logFile, entry);
    }
}

export const globalBuilderChannel = new BuilderChannel();
