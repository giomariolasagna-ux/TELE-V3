
import { CleanupPlanObject, CleanupItem, UpdateObject } from '../../../../integrations/gateway_bridge';
import * as fs from 'fs';
import * as path from 'path';

const QUARANTINE_ROOT = path.join(process.cwd(), '.tele', 'quarantine');

export class CleanupEngine {

    constructor() {
        if (!fs.existsSync(QUARANTINE_ROOT)) {
            fs.mkdirSync(QUARANTINE_ROOT, { recursive: true });
        }
    }

    async executePlan(plan: CleanupPlanObject, mode: 'QUARANTINE' | 'DELETE', reportProgress: (u: UpdateObject) => Promise<void>, signal?: AbortSignal): Promise<void> {
        const batchId = new Date().toISOString().replace(/[:.]/g, '-');
        const quarantineDir = path.join(QUARANTINE_ROOT, batchId);

        if (mode === 'QUARANTINE') {
            fs.mkdirSync(quarantineDir, { recursive: true });
        }

        let processed = 0;
        let movedBytes = 0;

        for (const item of plan.items) {
            // HARD CHECK
            if (signal?.aborted) {
                throw new Error("INTERRUPTED BY USER (Clean Stop)");
            }

            // Slow down slightly to allow interrupt to win in this demo (busy loop prevention)
            await new Promise(r => setTimeout(r, 50));

            processed++;
            const progress = Math.round((processed / plan.items.length) * 100);

            try {
                if (mode === 'QUARANTINE') {
                    const filename = path.basename(item.path);
                    const dest = path.join(quarantineDir, filename);

                    // Rename (Move) is atomic on same volume, but might fail across volumes.
                    // Fallback to copy/unlink if needed, but rename is safer "move".
                    // Since temp is often on C: and project on C:, rename usually works.
                    // However, if temp is on D:, this fails.
                    // CopyFile + Unlink is more robust for cross-volume.
                    fs.copyFileSync(item.path, dest);
                    fs.unlinkSync(item.path);

                    movedBytes += item.sizeBytes;
                } else if (mode === 'DELETE') {
                    fs.unlinkSync(item.path);
                    movedBytes += item.sizeBytes;
                }
            } catch (e) {
                console.warn(`[CleanupEngine] Failed ${mode} on ${item.path}: ${e}`);
            }

            if (processed % 5 === 0) {
                await reportProgress({
                    eventId: plan.id,
                    status: 'RUNNING',
                    progress,
                    message: `Processing item ${processed}/${plan.items.length}`
                });
            }
        }

        // Final stats handling could go here or in Executor
        console.log(`[CleanupEngine] Completed. Mode: ${mode}. Bytes handled: ${movedBytes}`);
    }
}
