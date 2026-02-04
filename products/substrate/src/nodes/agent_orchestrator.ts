
import { LLMService } from '../services_hub/llm_service';
import { globalEventBus, BusEventType } from '../event_bus';
import { v4 as uuidv4 } from 'uuid';
import { skillLog } from '../memory/skill_log';

export class AgentOrchestrator {
    private llm: LLMService;

    constructor(llm: LLMService) {
        this.llm = llm;
    }

    async processRequest(userText: string) {
        console.log(`[Orchestrator] Processing: "${userText}"`);

        // 0. Check SkillLog for cached response (Knowledge Distillation)
        const cachedSkill = skillLog.find(userText);
        if (cachedSkill) {
            console.log(`[Orchestrator] CACHE HIT! Using learned skill.`);
            skillLog.markUsed(cachedSkill.id);
            await globalEventBus.emitEvent(BusEventType.TIMELINE_EVENT, {
                timestamp: Date.now(),
                description: `Hive: Instant response from SkillLog (uses: ${cachedSkill.usageCount})`
            });
            return cachedSkill.output;
        }

        // 1. Router Agent (Fast)
        // Decides: Is this a simple command or a complex goal?
        const routerPrompt = `
You are the Router Agent.
Classify the user request into one of these categories:
- DIRECT_CMD: Simple, single-step action (e.g. "open spotify", "what time is it").
- COMPLEX_GOAL: Multi-step, vague, or creative goal (e.g. "design a workflow", "organize my files", "draw a whale").

Response: JSON { "category": "DIRECT_CMD" | "COMPLEX_GOAL", "reason": string }
`;

        const routeRaw = await this.llm.chat(userText, 'fast', routerPrompt);
        interface RouteResp { category: string; reason?: string; }
        let route: RouteResp = { category: 'DIRECT_CMD' };
        try {
            if (routeRaw) route = JSON.parse(routeRaw.replace(/```json/g, '').replace(/```/g, ''));
        } catch (e) {
            console.warn('[Orchestrator] Router failed JSON parse, defaulting to DIRECT_CMD');
        }

        console.log(`[Orchestrator] Route: ${route.category} (${route.reason || 'No reason'})`);

        if (route.category === 'COMPLEX_GOAL') {
            await globalEventBus.emitEvent(BusEventType.TIMELINE_EVENT, {
                timestamp: Date.now(),
                description: `Hive: Routing to Planner (Kimi k2.5) for complex goal.`
            });
            return this.engangePlanner(userText);
        } else {
            // Direct execution (Legacy flow but via Smart model for accuracy or Fast for speed)
            return this.llm.classifyIntent(userText);
        }
    }

    private async engangePlanner(goal: string) {
        // Planner Agent (Smart / Kimi k2.5)
        // This would generate a full plan. For Phase 14 MVP, we will just execute a smarter, unrestricted shell command.

        const plannerPrompt = `
You are the PLANNER AGENT (God Mode).
The user has a complex goal: "${goal}".
The system is Windows 11. You have full access via PowerShell.

Generate a JSON Action to execute the first step or the entire script.
ALLOWED ACTIONS: 
- SHELL_EXEC: { command: "valid powershell script" }
- SEND_WHATSAPP: { to: "name or phone number", message: "text content" }

WARN: You are running as Administrator. 
WARN: DO NOT USE 'rm', 'ls' or linux commands. Use 'Remove-Item', 'Get-ChildItem'.
WARN: Use SEND_WHATSAPP for messaging tasks. Do NOT use Start-Process for WhatsApp.
WARN: DO NOT wrap the command in 'powershell -Command'. Just write the script code directly.
WARN: When using 'Get-ChildItem -Include', YOU MUST APPEND '*' TO THE PATH (e.g. 'C:\\Folder\\*') OR USE '-Recurse'.
WARN: For Windows Store apps (WhatsApp, Spotify), use URI schemes (e.g. Start-Process "whatsapp://...") instead of file paths.
Response: JSON { "type": "SHELL_EXEC", "payload": { "command": "Get-Process" } }
`;

        const planRaw = await this.llm.chat(goal, 'smart', plannerPrompt);
        try {
            if (planRaw) {
                const plan = JSON.parse(planRaw.replace(/```json/g, '').replace(/```/g, ''));

                // Record skill for future use (Knowledge Distillation)
                skillLog.record(goal, plan, 'kimi-k2.5', true);

                return plan;
            }
        } catch (e) {
            console.error('[Orchestrator] Planner JSON error', e);
            // Record failed attempt
            skillLog.record(goal, null, 'kimi-k2.5', false);
        }
        return null;
    }
}
