
import * as readline from 'readline';
import { GatewayBridge, IntentEventObject, UpdateObject } from '../../integrations/gateway_bridge';
import { v4 as uuidv4 } from 'uuid';

// Simple UUID mock if we don't want to add dependency for now, or just use crypto
const generateId = () => {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

import { TelegramAdapter } from './telegram_adapter';
import { RedactorGate } from './redactor_gate';
import * as dotenv from 'dotenv';
dotenv.config();

export class GatewayCore {
    private telegram: TelegramAdapter | null = null;
    private bridge: GatewayBridge | null = null;
    private rl: readline.Interface;

    constructor() {
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
    }

    async start(bridge: GatewayBridge) {
        this.bridge = bridge;
        console.log("[GatewayCore] Starting...");

        const channel = process.env.TELE_GATEWAY_CHANNEL || 'console';

        if (channel === 'telegram') {
            console.log("[GatewayCore] Mode: TELEGRAM");
            this.telegram = new TelegramAdapter(bridge);
            await this.telegram.start();
        } else {
            console.log("[GatewayCore] Mode: CONSOLE");
            console.log("[GatewayCore] Type a message to simulate inbound channel traffic.");

            this.rl.on('line', async (line) => {
                const intent: IntentEventObject = {
                    id: uuidv4(),
                    sourceChannel: 'console-local',
                    sourceUserId: 'admin',
                    timestamp: new Date().toISOString(),
                    rawContent: line.trim() // Dumb pipe, just pass text
                };
                await bridge.onIntent(intent);
            });
        }

        // Handle Outbound
        bridge.registerChannelAdapter({
            name: channel,
            sendMessage: async (userId, text) => {
                // REDACTION
                const safeText = RedactorGate.redact(text);

                if (channel === 'telegram' && this.telegram) {
                    await this.telegram.sendMessage(userId, safeText);
                } else {
                    console.log(`[GatewayCore] OUTBOUND to ${userId} >>> ${safeText}`);
                }
            }
        });
    }
    // Phase 1: Outbound methods
    public async sendToChannel(channelId: string, payload: string) {
        console.log(`[GatewayCore] OUTBOUND to ${channelId} >>> ${payload}`);
    }

    public async broadcastUpdate(update: UpdateObject) {
        // In a real gateway, this might update a websocket status or typing indicator
        console.log(`[GatewayCore] STATUS UPDATE [${update.status}]: ${update.message || ''} (${update.progress || 0}%)`);
    }
}
