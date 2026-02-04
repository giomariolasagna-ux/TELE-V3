// Builder Loop - Watches outbox and triggers verification

import { globalBuilderChannel } from './builder_channel';
import { globalBuilderBrain } from './builder_brain';
import { PatchResult } from './patch_request';
import { globalEventBus, BusEventType } from '../event_bus';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class BuilderLoop {
    private intervalId: NodeJS.Timeout | null = null;
    private checkIntervalMs = 5000; // 5 seconds

    async start() {
        console.log('[BuilderLoop] Starting...');

        // Generate boot request on first start
        await globalBuilderBrain.generateBootRequest();

        // Start polling for results
        this.intervalId = setInterval(() => this.checkOutbox(), this.checkIntervalMs);
    }

    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
    }

    private async checkOutbox() {
        try {
            const results = await globalBuilderChannel.checkResults();

            for (const result of results) {
                await this.processResult(result);
            }

            // Check for stale locks
            const stale = await globalBuilderChannel.checkStaleLocks();
            if (stale.length > 0) {
                console.log('[BuilderLoop] Stale locks detected:', stale);
                // Could generate recovery requests here
            }
        } catch (e) {
            console.error('[BuilderLoop] Error checking outbox:', e);
        }
    }

    private async processResult(result: PatchResult) {
        globalEventBus.emitEvent(BusEventType.TIMELINE_EVENT, {
            description: `[Builder] Patch result received: ${result.applied ? 'APPLIED' : 'FAILED'}`,
            metadata: { requestId: result.requestId, errors: result.errors }
        });

        if (!result.applied) {
            // Generate fix request
            console.log('[BuilderLoop] Patch failed, generating fix request...');
            await globalBuilderBrain.generateFeatureRequest(
                `Fix: ${result.errors[0] || 'Unknown error'}`,
                `The previous patch failed with errors. Please fix: ${result.errors.join(', ')}`,
                result.touched_files
            );
        } else {
            // Run verification
            const verified = await this.runVerification(result);

            if (verified) {
                globalEventBus.emitEvent(BusEventType.TIMELINE_EVENT, {
                    description: `[Builder] Patch VERIFIED: ${result.requestId}`,
                    metadata: { requestId: result.requestId }
                });
                globalBuilderBrain.markCompleted(result.requestId);
            } else {
                globalEventBus.emitEvent(BusEventType.TIMELINE_EVENT, {
                    description: `[Builder] Verification FAILED for: ${result.requestId}`,
                    metadata: { requestId: result.requestId }
                });
            }
        }

        // Consume the result
        await globalBuilderChannel.consumeResult(result);
    }

    private async runVerification(result: PatchResult): Promise<boolean> {
        // Basic verification: try to build
        try {
            console.log('[BuilderLoop] Running verification: npm run build');
            await execAsync('npm run build', {
                cwd: 'C:\\Users\\Administrator\\Desktop\\TELE\\products\\substrate'
            });
            return true;
        } catch (e) {
            console.error('[BuilderLoop] Build verification failed:', e);
            return false;
        }
    }
}

export const globalBuilderLoop = new BuilderLoop();
