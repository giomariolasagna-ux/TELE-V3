/**
 * Multi-Agent Coordinator - Conflict resolution and resource management
 * Part of God Mode System - Challenge 9
 * 
 * Features:
 * - Agent registration and lifecycle
 * - Resource locking with priorities
 * - Cross-agent messaging
 * - Conflict detection and resolution
 * - Collaborative task assignment
 */

import { EventEmitter } from 'events';

// =============================================================================
// Types
// =============================================================================

export interface Agent {
    id: string;
    name: string;
    type: 'executor' | 'planner' | 'monitor' | 'specialist';
    priority: number;  // Higher = more important
    capabilities: string[];
    status: 'idle' | 'busy' | 'waiting' | 'error' | 'offline';
    currentTask?: string;
    registeredAt: number;
    lastHeartbeat: number;
}

export interface Resource {
    id: string;
    type: 'app' | 'file' | 'network' | 'hardware' | 'skill';
    name: string;
    exclusive: boolean;  // Can only one agent hold?
    holder?: string;     // Agent ID
    waitQueue: string[]; // Agent IDs waiting
    lockedAt?: number;
}

export interface AgentMessage {
    id: string;
    from: string;
    to: string | 'broadcast';
    type: 'request' | 'response' | 'notify' | 'conflict' | 'handoff';
    payload: any;
    timestamp: number;
    replyTo?: string;
}

export interface ConflictReport {
    id: string;
    type: 'resource' | 'task' | 'priority';
    agents: string[];
    resource?: string;
    description: string;
    resolution?: 'wait' | 'preempt' | 'merge' | 'split' | 'abort';
    resolvedAt?: number;
}

export interface TaskAssignment {
    taskId: string;
    agentId: string;
    skillId: string;
    actionName: string;
    params: any;
    priority: number;
    deadline?: number;
}

// =============================================================================
// Agent Coordinator
// =============================================================================

export class AgentCoordinator extends EventEmitter {
    private agents: Map<string, Agent> = new Map();
    private resources: Map<string, Resource> = new Map();
    private messages: AgentMessage[] = [];
    private conflicts: ConflictReport[] = [];
    private heartbeatInterval: NodeJS.Timeout | null = null;
    private heartbeatTimeoutMs = 30000;

    constructor() {
        super();
        this.startHeartbeatMonitor();
    }

    // -------------------------------------------------------------------------
    // Agent Management
    // -------------------------------------------------------------------------

    registerAgent(agent: Omit<Agent, 'registeredAt' | 'lastHeartbeat' | 'status'>): Agent {
        const fullAgent: Agent = {
            ...agent,
            status: 'idle',
            registeredAt: Date.now(),
            lastHeartbeat: Date.now()
        };

        this.agents.set(agent.id, fullAgent);
        this.emit('agent_registered', fullAgent);
        console.log(`[Coordinator] Agent registered: ${agent.name} (${agent.id})`);

        return fullAgent;
    }

    unregisterAgent(agentId: string): boolean {
        const agent = this.agents.get(agentId);
        if (!agent) return false;

        // Release any held resources
        for (const [resourceId, resource] of this.resources) {
            if (resource.holder === agentId) {
                this.releaseResource(agentId, resourceId);
            }
            resource.waitQueue = resource.waitQueue.filter(id => id !== agentId);
        }

        this.agents.delete(agentId);
        this.emit('agent_unregistered', agent);
        console.log(`[Coordinator] Agent unregistered: ${agent.name}`);

        return true;
    }

    heartbeat(agentId: string): void {
        const agent = this.agents.get(agentId);
        if (agent) {
            agent.lastHeartbeat = Date.now();
            if (agent.status === 'offline') {
                agent.status = 'idle';
                this.emit('agent_online', agent);
            }
        }
    }

    updateAgentStatus(agentId: string, status: Agent['status'], currentTask?: string): void {
        const agent = this.agents.get(agentId);
        if (agent) {
            agent.status = status;
            agent.currentTask = currentTask;
            this.emit('agent_status', agent);
        }
    }

    getAgent(agentId: string): Agent | undefined {
        return this.agents.get(agentId);
    }

    getAgentsByCapability(capability: string): Agent[] {
        return Array.from(this.agents.values())
            .filter(a => a.capabilities.includes(capability) && a.status !== 'offline');
    }

    getAvailableAgents(): Agent[] {
        return Array.from(this.agents.values())
            .filter(a => a.status === 'idle');
    }

    // -------------------------------------------------------------------------
    // Resource Management
    // -------------------------------------------------------------------------

    registerResource(resource: Omit<Resource, 'waitQueue'>): Resource {
        const fullResource: Resource = {
            ...resource,
            waitQueue: []
        };

        this.resources.set(resource.id, fullResource);
        console.log(`[Coordinator] Resource registered: ${resource.name} (${resource.id})`);

        return fullResource;
    }

    async acquireResource(agentId: string, resourceId: string, timeout = 30000): Promise<boolean> {
        const resource = this.resources.get(resourceId);
        const agent = this.agents.get(agentId);

        if (!resource || !agent) {
            return false;
        }

        // Already held by this agent
        if (resource.holder === agentId) {
            return true;
        }

        // Not exclusive or not held - grant immediately
        if (!resource.exclusive || !resource.holder) {
            resource.holder = agentId;
            resource.lockedAt = Date.now();
            this.emit('resource_acquired', { agent, resource });
            console.log(`[Coordinator] ${agent.name} acquired ${resource.name}`);
            return true;
        }

        // Need to wait - check priorities
        const holder = this.agents.get(resource.holder);

        if (holder && agent.priority > holder.priority) {
            // Higher priority - preempt
            const conflict = this.reportConflict({
                type: 'resource',
                agents: [agentId, resource.holder],
                resource: resourceId,
                description: `Priority preemption: ${agent.name} > ${holder.name}`,
                resolution: 'preempt'
            });

            // Notify holder they're being preempted
            this.sendMessage(agentId, resource.holder, 'conflict', {
                action: 'preempt',
                resource: resourceId
            });

            resource.holder = agentId;
            resource.lockedAt = Date.now();
            this.emit('resource_preempted', { agent, resource, previousHolder: holder });

            return true;
        }

        // Lower or equal priority - wait in queue
        if (!resource.waitQueue.includes(agentId)) {
            resource.waitQueue.push(agentId);
        }

        agent.status = 'waiting';
        this.emit('resource_waiting', { agent, resource });

        // Wait for resource
        return new Promise((resolve) => {
            const checkInterval = setInterval(() => {
                if (resource.holder === agentId) {
                    clearInterval(checkInterval);
                    resolve(true);
                }
            }, 100);

            setTimeout(() => {
                clearInterval(checkInterval);
                resource.waitQueue = resource.waitQueue.filter(id => id !== agentId);
                if (agent.status === 'waiting') agent.status = 'idle';
                resolve(false);
            }, timeout);
        });
    }

    releaseResource(agentId: string, resourceId: string): boolean {
        const resource = this.resources.get(resourceId);

        if (!resource || resource.holder !== agentId) {
            return false;
        }

        resource.holder = undefined;
        resource.lockedAt = undefined;

        // Grant to next in queue
        if (resource.waitQueue.length > 0) {
            const nextAgentId = resource.waitQueue.shift()!;
            resource.holder = nextAgentId;
            resource.lockedAt = Date.now();

            const nextAgent = this.agents.get(nextAgentId);
            if (nextAgent) {
                nextAgent.status = 'idle';
                this.emit('resource_acquired', { agent: nextAgent, resource });
            }
        }

        this.emit('resource_released', { agentId, resource });
        return true;
    }

    // -------------------------------------------------------------------------
    // Messaging
    // -------------------------------------------------------------------------

    sendMessage(from: string, to: string | 'broadcast', type: AgentMessage['type'], payload: any): AgentMessage {
        const message: AgentMessage = {
            id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            from,
            to,
            type,
            payload,
            timestamp: Date.now()
        };

        this.messages.push(message);
        this.emit('message', message);

        // Deliver to recipient(s)
        if (to === 'broadcast') {
            for (const agent of this.agents.values()) {
                if (agent.id !== from) {
                    this.emit(`message:${agent.id}`, message);
                }
            }
        } else {
            this.emit(`message:${to}`, message);
        }

        return message;
    }

    getMessagesFor(agentId: string, since?: number): AgentMessage[] {
        return this.messages.filter(m =>
            (m.to === agentId || m.to === 'broadcast') &&
            (!since || m.timestamp > since)
        );
    }

    // -------------------------------------------------------------------------
    // Conflict Resolution
    // -------------------------------------------------------------------------

    reportConflict(conflict: Omit<ConflictReport, 'id'>): ConflictReport {
        const fullConflict: ConflictReport = {
            ...conflict,
            id: `conflict_${Date.now()}`
        };

        this.conflicts.push(fullConflict);
        this.emit('conflict', fullConflict);
        console.log(`[Coordinator] Conflict: ${conflict.description}`);

        return fullConflict;
    }

    resolveConflict(conflictId: string, resolution: ConflictReport['resolution']): boolean {
        const conflict = this.conflicts.find(c => c.id === conflictId);
        if (!conflict) return false;

        conflict.resolution = resolution;
        conflict.resolvedAt = Date.now();

        this.emit('conflict_resolved', conflict);
        console.log(`[Coordinator] Conflict resolved: ${conflict.description} -> ${resolution}`);

        return true;
    }

    detectConflicts(): ConflictReport[] {
        const newConflicts: ConflictReport[] = [];

        // Detect resource deadlocks
        for (const [id, resource] of this.resources) {
            if (resource.waitQueue.length > 3) {
                newConflicts.push(this.reportConflict({
                    type: 'resource',
                    agents: [resource.holder!, ...resource.waitQueue],
                    resource: id,
                    description: `Resource contention on ${resource.name}`
                }));
            }
        }

        // Detect priority inversions
        for (const resource of this.resources.values()) {
            if (resource.holder && resource.waitQueue.length > 0) {
                const holder = this.agents.get(resource.holder);
                const waiting = resource.waitQueue
                    .map(id => this.agents.get(id))
                    .filter(a => a) as Agent[];

                const higherPriority = waiting.filter(w =>
                    holder && w.priority > holder.priority
                );

                if (higherPriority.length > 0) {
                    newConflicts.push(this.reportConflict({
                        type: 'priority',
                        agents: [resource.holder, ...higherPriority.map(a => a.id)],
                        resource: resource.id,
                        description: `Priority inversion on ${resource.name}`
                    }));
                }
            }
        }

        return newConflicts;
    }

    // -------------------------------------------------------------------------
    // Task Assignment
    // -------------------------------------------------------------------------

    assignTask(task: Omit<TaskAssignment, 'agentId'>, preferredAgent?: string): TaskAssignment | null {
        let targetAgent: Agent | undefined;

        if (preferredAgent) {
            targetAgent = this.agents.get(preferredAgent);
            if (!targetAgent || targetAgent.status !== 'idle') {
                targetAgent = undefined;
            }
        }

        if (!targetAgent) {
            // Find best available agent
            const candidates = this.getAgentsByCapability(task.skillId)
                .filter(a => a.status === 'idle')
                .sort((a, b) => b.priority - a.priority);

            targetAgent = candidates[0];
        }

        if (!targetAgent) {
            console.log('[Coordinator] No available agent for task');
            return null;
        }

        const assignment: TaskAssignment = {
            ...task,
            agentId: targetAgent.id
        };

        targetAgent.status = 'busy';
        targetAgent.currentTask = task.taskId;

        this.emit('task_assigned', assignment);
        console.log(`[Coordinator] Assigned ${task.taskId} to ${targetAgent.name}`);

        return assignment;
    }

    // -------------------------------------------------------------------------
    // Monitoring
    // -------------------------------------------------------------------------

    private startHeartbeatMonitor(): void {
        this.heartbeatInterval = setInterval(() => {
            const now = Date.now();

            for (const agent of this.agents.values()) {
                if (now - agent.lastHeartbeat > this.heartbeatTimeoutMs) {
                    if (agent.status !== 'offline') {
                        agent.status = 'offline';
                        this.emit('agent_offline', agent);
                        console.log(`[Coordinator] Agent offline: ${agent.name}`);
                    }
                }
            }
        }, 5000);
    }

    getStats(): {
        totalAgents: number;
        activeAgents: number;
        busyAgents: number;
        totalResources: number;
        lockedResources: number;
        activeConflicts: number;
    } {
        const agents = Array.from(this.agents.values());
        const resources = Array.from(this.resources.values());

        return {
            totalAgents: agents.length,
            activeAgents: agents.filter(a => a.status !== 'offline').length,
            busyAgents: agents.filter(a => a.status === 'busy').length,
            totalResources: resources.length,
            lockedResources: resources.filter(r => r.holder).length,
            activeConflicts: this.conflicts.filter(c => !c.resolvedAt).length
        };
    }

    // -------------------------------------------------------------------------
    // Cleanup
    // -------------------------------------------------------------------------

    destroy(): void {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
        }
        this.agents.clear();
        this.resources.clear();
        this.messages = [];
        this.conflicts = [];
    }
}

// =============================================================================
// Singleton Export
// =============================================================================

export const globalCoordinator = new AgentCoordinator();

// Register default resources
globalCoordinator.registerResource({
    id: 'screen',
    type: 'hardware',
    name: 'Screen/Display',
    exclusive: false
});

globalCoordinator.registerResource({
    id: 'keyboard',
    type: 'hardware',
    name: 'Keyboard Input',
    exclusive: true
});

globalCoordinator.registerResource({
    id: 'microphone',
    type: 'hardware',
    name: 'Microphone',
    exclusive: true
});
