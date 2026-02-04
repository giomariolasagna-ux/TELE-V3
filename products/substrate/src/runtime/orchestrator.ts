// Unified Orchestrator - Single entrypoint for the entire TELE stack

import { ObjectStore } from '../object_store';
import { Executor } from '../executor';
import { SubstrateServer } from '../server';
import { globalEventBus, BusEventType } from '../event_bus';
import { globalAgentManager, registerAllAgents } from './agent_manager';
import { GatewayBridge, ChannelAdapter, IntentEventObject, UpdateObject } from '../../../../integrations/gateway_bridge';

// Stub bridge for standalone orchestrator mode
const stubBridge: GatewayBridge = {
    async onIntent(intent: IntentEventObject) {
        console.log('[StubBridge] Intent received:', intent.rawContent);
    },
    registerChannelAdapter(adapter: ChannelAdapter) {
        console.log('[StubBridge] Channel registered:', adapter.name);
    },
    async emitUpdate(update: UpdateObject) {
        console.log('[StubBridge] Update:', update.status);
    },
    async sendMessage(channelId: string, payload: string) {
        console.log(`[StubBridge] -> ${channelId}: ${payload}`);
    }
};

export class Orchestrator {
    private store: ObjectStore;
    private executor: Executor;
    private server: SubstrateServer;

    constructor() {
        this.store = new ObjectStore();
        this.executor = new Executor(stubBridge, this.store);
        this.server = new SubstrateServer(this.store, this.executor);
    }

    async start() {
        console.log('===========================================');
        console.log('   TELE Antigravity - Phase 11 Runtime');
        console.log('   FREE MODE: ACTIVE');
        console.log('===========================================');

        // 1. Register all agents
        registerAllAgents();

        // 2. Start HTTP + WebSocket server
        await this.server.start();

        // 3. Start all agents
        await globalAgentManager.startAll();

        // 4. Emit runtime started event
        globalEventBus.emitEvent(BusEventType.RUNTIME_STARTED, {
            timestamp: Date.now(),
            freeMode: true,
            agents: globalAgentManager.listAgents()
        });

        console.log('[Orchestrator] All systems online.');
        console.log('[Orchestrator] Agents:', globalAgentManager.listAgents().join(', '));
    }

    async stop() {
        console.log('[Orchestrator] Shutting down...');
        await globalAgentManager.stopAll();
        console.log('[Orchestrator] Shutdown complete.');
    }
}

// Main entrypoint
async function main() {
    const orchestrator = new Orchestrator();

    process.on('SIGINT', async () => {
        await orchestrator.stop();
        process.exit(0);
    });

    process.on('SIGTERM', async () => {
        await orchestrator.stop();
        process.exit(0);
    });

    await orchestrator.start();
}

// Run if this is the main module
if (require.main === module) {
    main().catch(console.error);
}
