
// Substrate Runtime (Entry Point)
import { GatewayBridge, IntentEventObject, UpdateObject } from '../integrations/gateway_bridge';
import { ObjectStore } from '../products/substrate/src/object_store';
import { SecurityGate } from '../products/substrate/src/security';
import { ModelRouter } from '../products/substrate/src/model_router';
import { Planner } from '../products/substrate/src/planner';
import { Executor } from '../products/substrate/src/executor';
import { GatewayCore } from '../gateway_core/src/index';
import { SubstrateServer } from '../products/substrate/src/server';
import { spawn } from 'child_process';

// God Mode System Imports
import { initializeGodMode, globalPlanner, Plan, PlanNode } from '../products/substrate/src/skills';

// "Runtime" acts as the Bridge Implementation on the Product side
// But wait, the Gateway INVOKES the bridge. The Product PROVIDES the bridge logic?
// No, usually the Bridge connects them.
// Let's implement the Bridge Interface here and pass it to Gateway.

class SubstrateBridge implements GatewayBridge {
    private gatewayCore: GatewayCore;
    private planner: Planner;
    private adapter: any = null;
    // Executor is still needed, but will be set after construction due to circular dependency.
    private executor: Executor;

    constructor(gw: GatewayCore, planner: Planner) {
        this.gatewayCore = gw;
        this.planner = planner;
        // Executor needs bridge to send updates. 
        // We will pass `this` to executor after construction or use a proxy.
        // For now, Executor takes `GatewayBridge` in constructor, but `SubstrateBridge` is not created yet.
        // Let's wiring up in main.
    }

    setGateway(gw: GatewayCore) {
        this.gatewayCore = gw;
    }

    registerChannelAdapter(adapter: any) {
        this.adapter = adapter;
        console.log(`[Bridge] Registered adapter: ${adapter.name}`);
    }

    async onIntent(intent: IntentEventObject): Promise<void> {
        console.log(`[Substrate] Received Intent: ${intent.id} - "${intent.rawContent}"`);

        // =====================================================================
        // GOD MODE SYSTEM INTEGRATION
        // =====================================================================

        // Try to match intent using the new Hierarchical Planner
        try {
            const plan = globalPlanner.createPlanFromNL(intent.rawContent);
            if (plan.rootNode) {
                console.log(`[GodMode] Intent matched God Mode skill! Executing plan "${plan.id}"...`);
                const result = await globalPlanner.executePlan(plan);

                if (result.success) {
                    console.log(`[GodMode] Plan executed successfully.`);
                    await this.gatewayCore.broadcastUpdate({
                        eventId: intent.id,
                        status: 'DONE',
                        progress: 100,
                        message: `God Mode: Plan "${plan.id}" executed successfully.`
                    });
                    return;
                } else {
                    console.error(`[GodMode] Plan failed: ${result.error}`);
                    // Continue to legacy planner as fallback or report error
                }
            }
        } catch (error: any) {
            console.error(`[GodMode] Planner error: ${error.message}`);
        }

        // =====================================================================
        // LEGACY PLANNER FALLBACK
        // =====================================================================

        const actions = await this.planner.plan(intent);

        for (const action of actions) {
            if (action.requiresGesture) {
                console.log(`[Runner] Action ${action.id} requires GESTURE. Parking in Store.`);
                await this.executor.park(action);
            } else {
                await this.executor.execute(action);
            }
        }
    }

    async emitUpdate(update: UpdateObject): Promise<void> {
        // Product -> Gateway
        await this.gatewayCore.broadcastUpdate(update);
        // Send status updates back to channel?
        // Only if important. 
        // For MVP, user sees console logs or UI. 
        // Remote user should get "DONE" or "FAILED".
        if (update.status === 'DONE' && update.progress === 100) {
            await this.sendMessage('remote', `[UPDATE] ${update.message}`);
        }
    }

    async sendMessage(channelId: string, payload: string): Promise<void> {
        // Use registered adapter if available
        if (this.adapter) {
            await this.adapter.sendMessage(channelId, payload);
        } else {
            // Product -> Gateway
            await this.gatewayCore.sendToChannel(channelId, payload);
        }
    }
}

// Main Construction
async function main() {
    console.log("Initializing TELE Substrate Phase 1...");

    // Initialize God Mode System
    try {
        await initializeGodMode();
    } catch (error: any) {
        console.error(`[GodMode] Initialization failed: ${error.message}`);
    }

    const store = new ObjectStore();
    const security = new SecurityGate();
    const router = new ModelRouter(security);
    const planner = new Planner(store);

    // Circular wiring
    // 1. Create Gateway (Dumb)
    const gateway = new GatewayCore();

    // 2. Create Bridge Implementation
    // Executor needs the bridge to `emitUpdate`. 
    // We can create a Proxy or just pass a reference that gets set.

    // Quick Hack: SubstrateBridge IS the bridge.
    const bridge = new SubstrateBridge(gateway, planner);
    // Pass Store to Executor (Phase 2)
    // 4. Start Voice Service (Phase 3)
    console.log("Starting Voice Service (Local process)...");
    let voiceProc: any = null;

    // Executor with OnCancel callback
    const executor = new Executor(bridge, store, () => {
        // If Executor cancels (e.g. from UI or Timeout), tell Voice Service to STOP listening/transcribing
        if (voiceProc && voiceProc.stdin) {
            voiceProc.stdin.write('stop\n');
        }
    });
    (bridge as any).executor = executor;

    // Spawn Voice
    voiceProc = spawn('node', ['dist/voice_service/src/index.js'], {
        stdio: ['pipe', 'pipe', 'inherit'] // pipe stdin for control
    });

    // 5. Start UI API Server (Phase 4)
    const server = new SubstrateServer(store, executor);
    server.start();

    // 6. Start Notebook Overlay (Phase 4)
    console.log("Launching Notebook Overlay...");
    const uiProc = spawn('npx', ['electron', 'products/substrate_ui/.'], {
        stdio: 'ignore',
        detached: true,
        shell: true
    });
    uiProc.unref();

    voiceProc.stdout.on('data', async (data: Buffer) => {
        const lines = data.toString().split('\n');
        for (const line of lines) {
            if (!line.trim()) continue;
            try {
                if (line.trim().startsWith('{')) {
                    const packet = JSON.parse(line.trim());

                    if (packet.type === 'INTERRUPT') {
                        console.log(`[Runner] INTERRUPT RECEIVED: ${packet.payload.type}`);
                        if (packet.payload.type === 'STOP') {
                            const ts = new Date(packet.payload.timestamp).getTime();
                            const latency = Date.now() - ts;
                            console.log(`[Runner] Stop Latency: ${latency}ms`);
                            executor.cancelCurrent({ latencyMs: latency });
                        }
                    } else if (packet.type === 'INTENT') {
                        console.log(`[Runner] VOICE INTENT: ${packet.payload.rawContent}`);

                        // Check for 'stop' intent (textual stop)
                        if (packet.payload.rawContent.toLowerCase() === 'stop') {
                            executor.cancelCurrent({ latencyMs: 0 }); // Direct text stop
                        } else {
                            await bridge.onIntent(packet.payload);
                        }
                    }
                } else {
                    console.log(`[VoiceService] ${line.trim()}`);
                }
            } catch (e) {
                // Not JSON, just log
                console.log(`[VoiceService] ${line.trim()}`);
            }
        }
    });

    console.log("TELE Session Kernel + Voice Ready.");
    console.log("Commands (Text or Voice):");
    console.log("  - 'scan cleanup' (God Mode)");
    console.log("  - 'check disk' (God Mode)");
    console.log("  - 'play music' (God Mode)");
    console.log("  - 'stop' (Interrupts running tasks)");
    console.log("  - 'confirm <id>'");
}

main().catch(err => console.error(err));
