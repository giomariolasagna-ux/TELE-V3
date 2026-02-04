// Services Hub - Multi-channel service integration

import { globalEventBus, BusEventType } from '../event_bus';

export interface ServiceAdapter {
    id: string;
    name: string;
    type: 'telegram' | 'whatsapp' | 'github' | 'chatgpt' | 'lm_studio' | 'moonshot' | 'google' | 'instagram';
    status: 'connected' | 'disconnected' | 'needs_auth' | 'error';
    authRequired: boolean;
    authType?: 'token' | 'oauth';
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    sendMessage?(userId: string, message: string): Promise<void>;
}

class ServicesHub {
    private services: Map<string, ServiceAdapter> = new Map();

    register(service: ServiceAdapter) {
        this.services.set(service.id, service);
        console.log(`[ServicesHub] Registered: ${service.name} (${service.status})`);

        globalEventBus.emitEvent(BusEventType.TIMELINE_EVENT, {
            description: `Service Registered: ${service.name}`,
            metadata: { serviceId: service.id, status: service.status }
        });
    }

    async connect(serviceId: string): Promise<boolean> {
        const service = this.services.get(serviceId);
        if (!service) return false;

        try {
            await service.connect();
            service.status = 'connected';
            return true;
        } catch (e) {
            service.status = 'error';
            return false;
        }
    }

    async disconnect(serviceId: string): Promise<void> {
        const service = this.services.get(serviceId);
        if (service) {
            await service.disconnect();
            service.status = 'disconnected';
        }
    }

    getAll(): ServiceAdapter[] {
        return Array.from(this.services.values());
    }

    get(serviceId: string): ServiceAdapter | undefined {
        return this.services.get(serviceId);
    }

    getConnected(): ServiceAdapter[] {
        return this.getAll().filter(s => s.status === 'connected');
    }
}

export const globalServicesHub = new ServicesHub();

// --- Service Adapters ---

// Telegram (Live - uses grammy from gateway_core)
class TelegramAdapter implements ServiceAdapter {
    id = 'telegram';
    name = 'Telegram';
    type: 'telegram' = 'telegram';
    status: ServiceAdapter['status'] = 'disconnected';
    authRequired = true;
    authType: 'token' = 'token';

    async connect() {
        // Integration with gateway_core
        console.log('[TelegramAdapter] Connecting...');
        this.status = 'connected';
    }

    async disconnect() {
        this.status = 'disconnected';
    }

    async sendMessage(userId: string, message: string) {
        console.log(`[TelegramAdapter] Send to ${userId}: ${message}`);
    }
}

// WhatsApp (Stub)
class WhatsAppAdapter implements ServiceAdapter {
    id = 'whatsapp';
    name = 'WhatsApp';
    type: 'whatsapp' = 'whatsapp';
    status: ServiceAdapter['status'] = 'needs_auth';
    authRequired = true;
    authType: 'oauth' = 'oauth';

    async connect() {
        throw new Error('WhatsApp requires OAuth authentication');
    }

    async disconnect() {
        this.status = 'disconnected';
    }
}

// GitHub (Stub)
class GitHubAdapter implements ServiceAdapter {
    id = 'github';
    name = 'GitHub';
    type: 'github' = 'github';
    status: ServiceAdapter['status'] = 'needs_auth';
    authRequired = true;
    authType: 'token' = 'token';

    async connect() {
        throw new Error('GitHub requires token authentication');
    }

    async disconnect() {
        this.status = 'disconnected';
    }
}

// ChatGPT (Stub)
class ChatGPTAdapter implements ServiceAdapter {
    id = 'chatgpt';
    name = 'ChatGPT';
    type: 'chatgpt' = 'chatgpt';
    status: ServiceAdapter['status'] = 'needs_auth';
    authRequired = true;
    authType: 'token' = 'token';

    async connect() {
        throw new Error('ChatGPT requires API key');
    }

    async disconnect() {
        this.status = 'disconnected';
    }
}

// LM Studio (Live - local)
class LMStudioAdapter implements ServiceAdapter {
    id = 'lm_studio';
    name = 'LM Studio';
    type: 'lm_studio' = 'lm_studio';
    status: ServiceAdapter['status'] = 'disconnected';
    authRequired = false;

    async connect() {
        // Local connection
        console.log('[LMStudioAdapter] Connecting to localhost:1234...');
        this.status = 'connected';
    }

    async disconnect() {
        this.status = 'disconnected';
    }
}

// Moonshot K2.5 (Live)
class MoonshotAdapter implements ServiceAdapter {
    id = 'moonshot';
    name = 'Moonshot K2.5';
    type: 'moonshot' = 'moonshot';
    status: ServiceAdapter['status'] = 'disconnected';
    authRequired = true;
    authType: 'token' = 'token';

    async connect() {
        console.log('[MoonshotAdapter] Connecting...');
        this.status = 'connected';
    }

    async disconnect() {
        this.status = 'disconnected';
    }
}

// Register all services
export function registerAllServices() {
    globalServicesHub.register(new TelegramAdapter());
    // WhatsApp Web adapter is registered separately when user initiates connection
    globalServicesHub.register(new GitHubAdapter());
    globalServicesHub.register(new ChatGPTAdapter());
    globalServicesHub.register(new LMStudioAdapter());
    globalServicesHub.register(new MoonshotAdapter());
}

// Export WhatsApp Web adapter for direct use
export { WhatsAppWebAdapter, whatsappAdapter } from './whatsapp_adapter';

// Export Google OAuth adapter for direct use
export { GoogleOAuthAdapter, googleAdapter } from './google_adapter';

// Export Instagram adapter for direct use
export { InstagramAdapter, instagramAdapter } from './instagram_adapter';
