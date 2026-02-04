
import { SubstrateServer } from './server';
import { ObjectStore } from './object_store';
import { Executor } from './executor';
import { GatewayBridge, IntentEventObject, UpdateObject, ChannelAdapter } from '../../../integrations/gateway_bridge';

// Simple implementation for Local/MVP usage
class LocalBridge implements GatewayBridge {
    async onIntent(intent: IntentEventObject): Promise<void> {
        console.log('[Bridge] Intent received:', intent);
    }

    registerChannelAdapter(adapter: ChannelAdapter): void {
        console.log('[Bridge] Adapter registered:', adapter.name);
    }

    async emitUpdate(update: UpdateObject): Promise<void> {
        console.log(`[Bridge Update] Status: ${update.status} (Progress: ${update.progress}%) - ${update.message}`);
    }

    async sendMessage(channelId: string, redactedPayload: string): Promise<void> {
        console.log(`[Bridge Message] To ${channelId}: ${redactedPayload}`);
    }
}

async function main() {
    console.log('[Substrate] Booting...');

    try {
        // 1. Initialize Store
        const store = new ObjectStore();
        // await store.init(); // No init needed for in-memory store
        console.log('[Substrate] Object Store Initialized');

        // 2. Initialize Bridge
        const bridge = new LocalBridge();

        // 3. Initialize Executor
        const executor = new Executor(bridge, store);

        // 4. Initialize Server
        const server = new SubstrateServer(store, executor);
        await server.start();

        console.log('[Substrate] System Online');

    } catch (e) {
        console.error('[Substrate] Startup Failed:', e);
        process.exit(1);
    }
}

main();
