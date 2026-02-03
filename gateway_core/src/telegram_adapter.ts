
import { Bot } from "grammy";
import { GatewayBridge, IntentEventObject, VoicePacket } from "../../integrations/gateway_bridge";
import { v4 as uuidv4 } from "uuid";

export class TelegramAdapter {
    private bot: Bot | null = null;
    private bridge: GatewayBridge;
    private allowedChats: Set<number>;
    private running = false;

    constructor(bridge: GatewayBridge) {
        this.bridge = bridge;
        this.allowedChats = new Set();
    }

    async start() {
        const token = process.env.TELE_TELEGRAM_BOT_TOKEN;
        const chats = process.env.TELE_TELEGRAM_ALLOWED_CHAT_IDS;

        if (!token || !chats) {
            // Fail fast
            throw new Error("Missing TELE_TELEGRAM_BOT_TOKEN or TELE_TELEGRAM_ALLOWED_CHAT_IDS");
        }

        chats.split(',').forEach(id => this.allowedChats.add(Number(id.trim())));

        this.bot = new Bot(token);

        this.bot.on("message:text", async (ctx) => {
            const chatId = ctx.chat.id;
            const text = ctx.message.text;

            if (!this.allowedChats.has(chatId)) {
                console.log(`[Telegram] Blocked unauthorized chat: ${chatId}`);
                return;
            }

            console.log(`[Telegram] Inbound from ${chatId}: ${text}`);

            // Normalize to Intent
            const intent: IntentEventObject = {
                id: uuidv4(),
                sourceChannel: 'telegram',
                sourceUserId: chatId.toString(),
                timestamp: new Date().toISOString(),
                rawContent: text.trim()
            };

            await this.bridge.onIntent(intent);
        });

        this.running = true;
        this.bot.start({
            onStart: (info) => {
                console.log(`[Telegram] Bot started: ${info.username}`);
            }
        });
    }

    async sendMessage(chatId: string, text: string) {
        if (!this.bot) return;
        try {
            await this.bot.api.sendMessage(Number(chatId), text);
        } catch (e) {
            console.error(`[Telegram] Send failed:`, e);
        }
    }

    stop() {
        if (this.bot && this.running) {
            this.bot.stop();
            this.running = false;
        }
    }
}
