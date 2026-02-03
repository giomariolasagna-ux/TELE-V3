
// Model Router (Local + Cloud)
import { Sensitivity } from '../../../integrations/gateway_bridge';
import { SecurityGate } from './security';

export class ModelRouter {
    private security: SecurityGate;

    constructor(security: SecurityGate) {
        this.security = security;
    }

    async queryLocal(prompt: string): Promise<string> {
        // Stub: connect to LMSTUDIO_BASE_URL
        console.log(`[ModelRouter] Querying Local LLM: ${prompt.substring(0, 50)}...`);
        return "Local Model Response (Stub)";
    }

    async queryCloud(prompt: string, sensitivity: Sensitivity): Promise<string> {
        // Enforce Redaction BEFORE Cloud
        const safePrompt = this.security.redact(prompt, sensitivity);

        // Stub: connect to Moonshot
        const key = process.env.MOONSHOT_API_KEY;
        if (!key) {
            console.warn("[ModelRouter] No MOONSHOT_API_KEY. Using Mock.");
        }
        console.log(`[ModelRouter] Querying Cloud LLM (Redacted): ${safePrompt.substring(0, 50)}...`);

        return "Cloud Model Response (Stub)";
    }
}
