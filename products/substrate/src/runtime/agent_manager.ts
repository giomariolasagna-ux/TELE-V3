// Agent Manager - Registers and orchestrates all agents

import { globalEventBus, BusEventType } from '../event_bus';

// Agent Interface
export interface Agent {
    name: string;
    start(): Promise<void>;
    stop(): Promise<void>;
}

// Agent Registry
class AgentManager {
    private agents: Map<string, Agent> = new Map();
    private running: boolean = false;

    register(agent: Agent) {
        this.agents.set(agent.name, agent);
        console.log(`[AgentManager] Registered: ${agent.name}`);
    }

    async startAll() {
        if (this.running) return;
        this.running = true;

        console.log('[AgentManager] Starting all agents...');

        for (const [name, agent] of this.agents) {
            try {
                await agent.start();
                globalEventBus.emitEvent(BusEventType.TIMELINE_EVENT, {
                    description: `Agent Started: ${name}`
                });
            } catch (e) {
                console.error(`[AgentManager] Failed to start ${name}:`, e);
            }
        }
    }

    async stopAll() {
        if (!this.running) return;

        console.log('[AgentManager] Stopping all agents...');

        for (const [name, agent] of this.agents) {
            try {
                await agent.stop();
            } catch (e) {
                console.error(`[AgentManager] Failed to stop ${name}:`, e);
            }
        }

        this.running = false;
    }

    getAgent(name: string): Agent | undefined {
        return this.agents.get(name);
    }

    listAgents(): string[] {
        return Array.from(this.agents.keys());
    }
}

export const globalAgentManager = new AgentManager();

// --- Agent Implementations ---

// Observer Agent (FS + Process Watcher)
export class ObserverAgent implements Agent {
    name = 'ObserverAgent';

    async start() {
        // Will integrate with FSWatcher and ProcessWatcher
        console.log('[ObserverAgent] Started (stub)');
    }

    async stop() {
        console.log('[ObserverAgent] Stopped');
    }
}

// Planner Agent (Intent -> ActionPlan)
export class PlannerAgent implements Agent {
    name = 'PlannerAgent';

    async start() {
        console.log('[PlannerAgent] Started');
    }

    async stop() {
        console.log('[PlannerAgent] Stopped');
    }
}

// Executor Agent (ActionPlan -> Execution)
export class ExecutorAgent implements Agent {
    name = 'ExecutorAgent';

    async start() {
        console.log('[ExecutorAgent] Started');
    }

    async stop() {
        console.log('[ExecutorAgent] Stopped');
    }
}

// Optimizer Agent (Cleanup policies)
export class OptimizerAgent implements Agent {
    name = 'OptimizerAgent';

    async start() {
        console.log('[OptimizerAgent] Started');
    }

    async stop() {
        console.log('[OptimizerAgent] Stopped');
    }
}

// Integrator Agent (Service connectors)
export class IntegratorAgent implements Agent {
    name = 'IntegratorAgent';

    async start() {
        console.log('[IntegratorAgent] Started');
    }

    async stop() {
        console.log('[IntegratorAgent] Stopped');
    }
}

// UIComposer Agent (Dynamic UI changes)
export class UIComposerAgent implements Agent {
    name = 'UIComposerAgent';

    async start() {
        console.log('[UIComposerAgent] Started');
    }

    async stop() {
        console.log('[UIComposerAgent] Stopped');
    }
}

// BuilderBrain Agent (PatchRequests, Skills)
export class BuilderBrainAgent implements Agent {
    name = 'BuilderBrainAgent';

    async start() {
        // Start the builder loop
        const { globalBuilderLoop } = require('../builder');
        await globalBuilderLoop.start();
        console.log('[BuilderBrainAgent] Started');
    }

    async stop() {
        const { globalBuilderLoop } = require('../builder');
        globalBuilderLoop.stop();
        console.log('[BuilderBrainAgent] Stopped');
    }
}

// Register all agents
export function registerAllAgents() {
    globalAgentManager.register(new ObserverAgent());
    globalAgentManager.register(new PlannerAgent());
    globalAgentManager.register(new ExecutorAgent());
    globalAgentManager.register(new OptimizerAgent());
    globalAgentManager.register(new IntegratorAgent());
    globalAgentManager.register(new UIComposerAgent());
    globalAgentManager.register(new BuilderBrainAgent());
}
