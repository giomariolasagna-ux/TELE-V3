
// Executor Stub
import { ActionObject, UpdateObject, UUID } from '../../../integrations/gateway_bridge';
import { GatewayBridge } from '../../../integrations/gateway_bridge';
import { Scanner, CleanupEngine } from './session_kernel';
import { ObjectStore } from './object_store';

export class Executor {
    private bridge: GatewayBridge;
    private scanner: Scanner;
    private cleanup: CleanupEngine;
    private store: ObjectStore;
    private onCancel: (() => void) | undefined;

    // Phase 3: Interrupt Controller
    private currentController: AbortController | null = null;

    constructor(bridge: GatewayBridge, store: ObjectStore, onCancel?: () => void) {
        this.bridge = bridge;
        this.store = store;
        this.onCancel = onCancel;
        this.scanner = new Scanner();
        this.cleanup = new CleanupEngine();
    }

    cancelCurrent(metadata: any = {}) {
        if (this.currentController) {
            console.log("[Executor] HARD INTERRUPT TRIGGERED. Aborting current task...");
            this.currentController.abort();
            this.currentController = null;
            if (this.onCancel) this.onCancel();

            // Notify cancellation with metadata (Latency)
            // We can't know the ID of the action we just cancelled easily unless we stored it.
            // But we can broadcast a generic update or just log.
            // For MVP requirement "Display in UI status badge... Telegram completion".
            // If we abort, the 'execute' method catches the AbortError.
            // We should pass metadata to the 'execute' method via... shared state?
            // Or `cancelCurrent` sets a `cancellationReason`.
            this.cancellationMetadata = metadata;
        } else {
            console.log("[Executor] No active task to abort.");
        }
    }

    private cancellationMetadata: any = {};

    async park(action: ActionObject) {
        console.log(`[Executor] Parking Action ${action.id} (Requires Gesture)`);
        await this.store.saveAction(action);

        await this.bridge.sendMessage('console-local', `[PENDING] Action ${action.type} requires confirmation. Use UI or gesture.`);

        await this.bridge.emitUpdate({
            eventId: action.id,
            status: 'READY',
            message: 'Waiting for gesture confirmation'
        });
    }

    async execute(action: ActionObject) {
        console.log(`[Executor] Executing ${action.type}...`);

        // Setup Interrupt Controller
        this.currentController = new AbortController();
        const signal = this.currentController.signal;

        await this.bridge.emitUpdate({
            eventId: action.id,
            status: 'RUNNING',
            progress: 10,
            message: `Starting ${action.type}`
        });

        try {
            if (signal.aborted) throw new Error("Cancelled before start");

            if (action.type === 'GET_SYSTEM_STATUS') {
                await this.bridge.emitUpdate({
                    eventId: action.id,
                    status: 'DONE',
                    progress: 100,
                    message: 'System is healthy. Phase 3 Voice Stack Active.'
                });
                await this.bridge.sendMessage('console-local', "System Status: ONLINE.");
            }
            else if (action.type === 'DEBUG_ECHO') {
                // Redaction check happens in Output Adapter (Gateway), so we send the Secret here to prove Gateway catches it.
                const msg = action.payload.message;
                await this.bridge.sendMessage('console-local', msg);
                await this.bridge.emitUpdate({
                    eventId: action.id,
                    status: 'DONE',
                    progress: 100,
                    message: 'Echo complete'
                });
            }
            else if (action.type === 'CREATE_CLEANUP_PLAN') {
                const plan = await this.scanner.scanSystemTemp();
                await this.store.savePlan(plan);

                await this.bridge.emitUpdate({
                    eventId: action.id,
                    status: 'DONE',
                    progress: 100,
                    message: `Scan complete. Found ${plan.totalBytes} bytes.`
                });

                console.log(`[Executor] Plan ID: ${plan.id}`);
                await this.bridge.sendMessage('console-local',
                    `[PLAN READY] ID: ${plan.id}\nItems: ${plan.items.length}\nBytes: ${plan.totalBytes}\n\nSay 'request quarantine ${plan.id}' to initiate.`
                );
            }
            else if (action.type === 'EXECUTE_CLEANUP_PLAN') {
                const { planId, mode } = action.payload;
                const plan = await this.store.getPlan(planId);

                if (!plan) {
                    throw new Error(`Plan ${planId} not found.`);
                }

                // Execute with Signal
                await this.cleanup.executePlan(plan, mode, async (u) => {
                    if (signal.aborted) throw new Error("INTERRUPTED BY USER");
                    await this.bridge.emitUpdate(u);
                }, signal);

                await this.bridge.emitUpdate({
                    eventId: action.id,
                    status: 'DONE',
                    progress: 100,
                    message: `Cleanup (${mode}) Completed.`
                });

                await this.bridge.sendMessage('console-local', `[SUCCESS] Cleanup finished.`);
            }
        } catch (e: any) {
            console.error(`[Executor] Failed/Cancelled: ${e.message}`);

            let msg = e.message;
            if (e.message === "INTERRUPTED BY USER" || e.message === "Cancelled before start" || e.message.includes("aborted")) {
                const lat = this.cancellationMetadata?.latencyMs;
                if (lat) msg += ` (Latency: ${lat}ms)`;
            }

            await this.bridge.emitUpdate({
                eventId: action.id,
                status: 'FAILED', // or CANCELLED if we had that status
                message: msg
            });
            this.cancellationMetadata = {}; // Reset
        } finally {
            this.currentController = null;
        }
    }
}
