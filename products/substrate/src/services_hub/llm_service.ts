import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import axios from 'axios';

export interface LLMConfig {
    provider: 'local' | 'moonshot' | 'openai';
    baseUrl: string;
    apiKey: string;
    model: string;
}

// Load credentials from file if available
let FILE_KEY = '';
try {
    const credPath = path.join(os.homedir(), 'Desktop', 'TELE', 'products', 'substrate', '.tele', 'llm_credentials.json');
    if (fs.existsSync(credPath)) {
        const data = JSON.parse(fs.readFileSync(credPath, 'utf8'));
        FILE_KEY = data.moonshot_api_key || data.openai_api_key;
    }
} catch (e) { console.error('Error loading LLM creds:', e); }

const API_KEY = process.env.MOONSHOT_API_KEY || process.env.OPENAI_API_KEY || FILE_KEY;
const USE_MOONSHOT = !!API_KEY;

const DEFAULT_REMOTE_CONFIG: LLMConfig = {
    provider: 'moonshot',
    baseUrl: 'https://api.moonshot.ai/v1',
    apiKey: API_KEY,
    model: 'kimi-k2.5'
};

const DEFAULT_TURBO_CONFIG: LLMConfig = {
    provider: 'moonshot',
    baseUrl: 'https://api.moonshot.ai/v1',
    apiKey: API_KEY,
    model: 'kimi-k2-turbo-preview'  // Faster model for simple tasks
};

const DEFAULT_LOCAL_CONFIG: LLMConfig = {
    provider: 'local',
    baseUrl: 'http://localhost:1234/v1',
    apiKey: 'lm-studio',
    model: 'meta-llama-3.1-8b-instruct'
};

export class LLMService {
    private remoteConfig: LLMConfig;
    private turboConfig: LLMConfig;
    private localConfig: LLMConfig;

    constructor() {
        this.remoteConfig = { ...DEFAULT_REMOTE_CONFIG };
        this.turboConfig = { ...DEFAULT_TURBO_CONFIG };
        this.localConfig = { ...DEFAULT_LOCAL_CONFIG };

        console.log(`[LLMService] 3-Tier Mode Initialized.`);
        console.log(`   - Smart (Kimi K2.5):  ${this.remoteConfig.model} @ ${this.remoteConfig.baseUrl}`);
        console.log(`   - Turbo (Kimi Turbo): ${this.turboConfig.model} @ ${this.turboConfig.baseUrl}`);
        console.log(`   - Fast  (Local):      ${this.localConfig.model} @ ${this.localConfig.baseUrl}`);
    }

    /**
     * Chat with the LLM using 3-tier routing:
     * - turbo: Fast cloud model for simple voice commands (app launch, play music)
     * - fast: Local model for informative responses (chat, questions)
     * - smart: Full Kimi K2.5 for complex reasoning and planning
     */
    async chat(userText: string, profile: 'fast' | 'turbo' | 'smart' = 'smart', systemOverride?: string): Promise<string | null> {
        // Select Config based on Profile
        let config: LLMConfig;
        if (profile === 'turbo') {
            config = this.turboConfig;
        } else if (profile === 'fast') {
            config = this.localConfig;
        } else {
            config = this.remoteConfig;
        }

        console.log(`[LLM] Chatting (${profile}) on ${config.model}: "${userText.substring(0, 50)}..."`);

        try {
            const payload = {
                model: config.model,
                messages: [
                    { role: "system", content: systemOverride || "You are a helpful assistant." },
                    { role: "user", content: userText }
                ],
                temperature: profile === 'smart' ? 1.0 : 0.7
            };

            // Timeout: smart=60s, turbo=15s, fast=30s
            const timeout = profile === 'smart' ? 60000 : (profile === 'turbo' ? 15000 : 30000);

            const response = await axios.post(`${config.baseUrl}/chat/completions`, payload, {
                headers: {
                    'Authorization': `Bearer ${config.apiKey.trim()}`,
                    'Content-Type': 'application/json'
                },
                timeout
            });

            const content = response.data.choices[0].message.content;
            return content;

        } catch (e: any) {
            console.error(`[LLM] Request Failed (${profile}): ${e.message}`);
            // Fallback chain: turbo -> fast, fast -> turbo (if local down)
            if (profile === 'fast') {
                console.warn('[LLM] Local failed, falling back to Turbo...');
                return this.chat(userText, 'turbo', systemOverride);
            } else if (profile === 'turbo') {
                console.warn('[LLM] Turbo failed, falling back to Smart...');
                return this.chat(userText, 'smart', systemOverride);
            }
            return null;
        }
    }

    // Legacy method kept for compatibility but redirects to chat
    async classifyIntent(userText: string): Promise<any> {
        const systemPrompt = `
You are the Brain of the TELE Antigravity OS.
Your job is to translate user requests into JSON Actions.

AVAILABLE APPS (Examples, but you can infer others):
- "explorer": File Explorer
- "word", "photoshop", "blender", "spotify"

AVAILABLE ACTIONS:
- EXECUTE_APP: { appName: string, command: "launch" | "play_uri", args?: any }
- SEND_WHATSAPP: { to: "name or phone", message: "text content" }
- SHELL_EXEC: { command: string } (Use this for ANYTHING not covered by Execute App or WhatsApp. WARNING: YOU ARE ON WINDOWS. USE POWERSHELL SYNTAX ONLY. NO BASH.)
- GET_SYSTEM_STATUS, UNKNOWN

RESPONSE FORMAT: JSON Only.
`;
        const resp = await this.chat(userText, 'turbo', systemPrompt);  // Use turbo for fast direct commands
        if (!resp) return null;

        try {
            const jsonStr = resp.replace(/```json/g, '').replace(/```/g, '').trim();
            return JSON.parse(jsonStr);
        } catch (e) {
            console.error('[LLM] JSON Parse Error', e);
            return null;
        }
    }
}
