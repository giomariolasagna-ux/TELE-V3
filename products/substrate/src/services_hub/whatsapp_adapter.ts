// WhatsApp Web Adapter - Phase 11
// Uses whatsapp-web.js with QR code authentication

import { Client, LocalAuth, Message } from 'whatsapp-web.js';
// @ts-ignore - qrcode-terminal has no types
const qrcode = require('qrcode-terminal');
import { globalEventBus, BusEventType } from '../event_bus';
import { ServiceAdapter } from './index';

export class WhatsAppWebAdapter implements ServiceAdapter {
    id = 'whatsapp_web';
    name = 'WhatsApp Web';
    type: 'whatsapp' = 'whatsapp';
    status: ServiceAdapter['status'] = 'disconnected';
    authRequired = true;
    authType: 'oauth' = 'oauth';

    private client: Client | null = null;
    private isReady = false;

    constructor() {
        this.initClient();
    }

    private initClient() {
        // Create client with local authentication (persists session)
        this.client = new Client({
            authStrategy: new LocalAuth({
                dataPath: './.tele/whatsapp_session'
            }),
            puppeteer: {
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            }
        });

        // QR Code Event - Display in terminal
        this.client.on('qr', (qr: string) => {
            console.log('\n===========================================');
            console.log('  WHATSAPP WEB - SCAN QR CODE TO CONNECT');
            console.log('===========================================\n');

            qrcode.generate(qr, { small: true });

            console.log('\nOpen WhatsApp on your phone > Settings > Linked Devices > Link a Device\n');

            // Emit event for UI
            globalEventBus.emitEvent(BusEventType.TIMELINE_EVENT, {
                description: 'WhatsApp: QR Code generated. Please scan with your phone.',
                metadata: { qrCode: qr }
            });
        });

        // Ready Event
        this.client.on('ready', () => {
            console.log('[WhatsApp] Client is ready!');
            this.isReady = true;
            this.status = 'connected';

            globalEventBus.emitEvent(BusEventType.TIMELINE_EVENT, {
                description: 'WhatsApp Web connected successfully!'
            });
        });

        // Authenticated Event
        this.client.on('authenticated', () => {
            console.log('[WhatsApp] Authenticated successfully');
        });

        // Authentication Failure
        this.client.on('auth_failure', (msg: string) => {
            console.error('[WhatsApp] Authentication failed:', msg);
            this.status = 'error';
        });

        // Message Event
        this.client.on('message', async (msg: Message) => {
            console.log(`[WhatsApp] Message from ${msg.from}: ${msg.body}`);

            globalEventBus.emitEvent(BusEventType.TIMELINE_EVENT, {
                description: `WhatsApp message received from ${msg.from}`,
                metadata: { from: msg.from, body: msg.body }
            });

            // Auto-reply example (can be hooked to agent)
            if (msg.body.toLowerCase() === 'ping') {
                await msg.reply('pong from TELE Antigravity!');
            }
        });

        // Disconnected Event
        this.client.on('disconnected', (reason: string) => {
            console.log('[WhatsApp] Disconnected:', reason);
            this.isReady = false;
            this.status = 'disconnected';
        });
    }

    async connect(): Promise<void> {
        if (!this.client) {
            this.initClient();
        }

        console.log('[WhatsApp] Initializing connection...');
        this.status = 'disconnected';

        // This will trigger QR code generation
        await this.client!.initialize();
    }

    async disconnect(): Promise<void> {
        if (this.client && this.isReady) {
            await this.client.destroy();
            this.isReady = false;
            this.status = 'disconnected';
        }
    }

    async sendMessage(userId: string, message: string): Promise<void> {
        if (!this.client || !this.isReady) {
            throw new Error('WhatsApp client not connected');
        }

        // userId should be in format: '1234567890@c.us'
        await this.client.sendMessage(userId, message);
        console.log(`[WhatsApp] Sent message to ${userId}`);
    }

    async findContact(query: string): Promise<string | null> {
        if (!this.client || !this.isReady) return null;
        try {
            const contacts = await this.client.getContacts();
            const found = contacts.find(c =>
                (c.name && c.name.toLowerCase().includes(query.toLowerCase())) ||
                (c.pushname && c.pushname.toLowerCase().includes(query.toLowerCase())) ||
                (c.number && c.number.includes(query))
            );
            return found ? found.id._serialized : null;
        } catch (e) {
            console.error('[WhatsApp] Error searching contacts:', e);
            return null;
        }
    }

    getStatus(): string {
        return this.status;
    }

    isConnected(): boolean {
        return this.isReady;
    }
}

// Export singleton
export const whatsappAdapter = new WhatsAppWebAdapter();
