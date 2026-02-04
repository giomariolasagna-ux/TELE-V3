/**
 * Flow Builder - Creates flows from natural language or structured input
 * Enables LLM-assisted flow creation from voice commands
 */

import * as fs from 'fs';
import * as path from 'path';
import { Flow, FlowNode, FlowIndex } from './flow_types';
import { FLOWS_DIR, FLOW_INDEX, ensureAgentDirs } from '../agent_fs/agent_paths';
import { agentMemory } from '../agent_fs/agent_memory';
import { v4 as uuidv4 } from 'uuid';

export class FlowBuilder {
    private index: FlowIndex;

    constructor() {
        ensureAgentDirs();
        this.index = this.loadIndex();
    }

    private loadIndex(): FlowIndex {
        try {
            if (fs.existsSync(FLOW_INDEX)) {
                return JSON.parse(fs.readFileSync(FLOW_INDEX, 'utf8'));
            }
        } catch (e) {
            console.error('[FlowBuilder] Failed to load index:', e);
        }
        return { version: 1, flows: [] };
    }

    private saveIndex(): void {
        fs.writeFileSync(FLOW_INDEX, JSON.stringify(this.index, null, 2));
    }

    /**
     * Create a new flow from a description
     * This can be called directly or enhanced with LLM parsing
     */
    createFlow(params: {
        name: string;
        description?: string;
        trigger?: Flow['trigger'];
        triggerConfig?: Flow['triggerConfig'];
        tags?: string[];
    }): Flow {
        const flow: Flow = {
            id: `flow_${uuidv4()}`,
            name: params.name,
            description: params.description,
            trigger: params.trigger || 'manual',
            triggerConfig: params.triggerConfig,
            nodes: [],
            startNodeId: '',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            version: 1,
            tags: params.tags || [],
            runCount: 0
        };

        return flow;
    }

    /**
     * Add a node to a flow
     */
    addNode(flow: Flow, node: Omit<FlowNode, 'id'>, afterNodeId?: string): FlowNode {
        const newNode: FlowNode = {
            ...node,
            id: `node_${uuidv4()}`
        };

        flow.nodes.push(newNode);

        // If this is the first node, set it as start
        if (flow.nodes.length === 1) {
            flow.startNodeId = newNode.id;
        }

        // Link from previous node if specified
        if (afterNodeId) {
            const prevNode = flow.nodes.find(n => n.id === afterNodeId);
            if (prevNode) {
                prevNode.next = newNode.id;
            }
        }

        return newNode;
    }

    /**
     * Parse natural language into a flow
     * Example: "apri file README, estrai contenuto, invia a Greta su whatsapp"
     */
    parseFromNaturalLanguage(input: string): Flow {
        const flow = this.createFlow({
            name: `Flow from: ${input.substring(0, 50)}`,
            description: input,
            trigger: 'voice',
            triggerConfig: { voicePattern: input },
            tags: ['voice-created']
        });

        // Tokenize by common separators
        const steps = input
            .split(/[,;]|\se\s|\spoi\s|\sinfine\s/i)
            .map(s => s.trim())
            .filter(s => s.length > 0);

        let prevNodeId: string | undefined;

        for (const step of steps) {
            const node = this.parseStep(step);
            if (node) {
                const addedNode = this.addNode(flow, node, prevNodeId);
                prevNodeId = addedNode.id;
            }
        }

        return flow;
    }

    /**
     * Parse a single step into a FlowNode
     */
    private parseStep(step: string): Omit<FlowNode, 'id'> | null {
        const lower = step.toLowerCase();

        // File operations
        if (lower.includes('apri file') || lower.includes('open file') || lower.includes('leggi file')) {
            const fileMatch = step.match(/(?:file|apri|leggi)\s+(.+)/i);
            const filename = fileMatch ? fileMatch[1].trim() : 'unknown';
            return {
                name: `Open File: ${filename}`,
                type: 'action',
                action: {
                    type: 'SHELL_EXEC',
                    payload: { command: `Get-Content "${filename}"` }
                }
            };
        }

        // Extract content
        if (lower.includes('estrai') || lower.includes('extract')) {
            return {
                name: 'Extract Content',
                type: 'transform',
                transform: 'context.data.trim()'
            };
        }

        // WhatsApp send
        if (lower.includes('whatsapp') || lower.includes('invia a')) {
            const recipientMatch = step.match(/(?:a|to)\s+(\w+)/i);
            const recipient = recipientMatch ? recipientMatch[1] : 'unknown';
            return {
                name: `Send to ${recipient} on WhatsApp`,
                type: 'integration',
                integration: {
                    service: 'whatsapp',
                    action: 'send_message',
                    params: {
                        to: recipient,
                        message: '{{context.data}}'
                    }
                }
            };
        }

        // Email operations
        if (lower.includes('email') || lower.includes('mail')) {
            if (lower.includes('leggi') || lower.includes('read')) {
                return {
                    name: 'Read Email',
                    type: 'integration',
                    integration: {
                        service: 'google',
                        action: 'read_email',
                        params: {}
                    }
                };
            }
            if (lower.includes('invia') || lower.includes('send')) {
                return {
                    name: 'Send Email',
                    type: 'integration',
                    integration: {
                        service: 'google',
                        action: 'send_email',
                        params: {
                            subject: 'From TELE',
                            body: '{{context.data}}'
                        }
                    }
                };
            }
        }

        // App launch
        if (lower.includes('apri') || lower.includes('avvia') || lower.includes('launch') || lower.includes('open')) {
            const appMatch = step.match(/(?:apri|avvia|launch|open)\s+(.+)/i);
            const appName = appMatch ? appMatch[1].trim() : 'unknown';
            return {
                name: `Launch ${appName}`,
                type: 'action',
                action: {
                    type: 'EXECUTE_APP',
                    payload: { appName, command: 'launch' }
                }
            };
        }

        // Wait/pause
        if (lower.includes('aspetta') || lower.includes('wait') || lower.includes('pausa')) {
            const timeMatch = step.match(/(\d+)\s*(?:secondi|seconds|sec|s)/i);
            const seconds = timeMatch ? parseInt(timeMatch[1]) : 1;
            return {
                name: `Wait ${seconds}s`,
                type: 'wait',
                waitMs: seconds * 1000
            };
        }

        // Find/Get file (e.g. "prendi un file png")
        if (lower.includes('prendi') || lower.includes('trova') || lower.includes('find') || lower.includes('get')) {
            const fileMatch = step.match(/(?:prendi|trova|find|get)\s+(?:un\s+)?(?:file\s+)?(.+)/i);
            const query = fileMatch ? fileMatch[1].trim() : 'files';

            // Heuristic for "png in immagini"
            let path = '$HOME';
            let filter = '*';

            if (query.includes('png')) filter = '*.png';
            if (query.includes('jpg')) filter = '*.jpg';
            if (query.includes('immagini') || query.includes('pictures')) path = '$HOME\\Pictures';
            if (query.includes('documenti') || query.includes('documents')) path = '$HOME\\Documents';

            return {
                name: `Find File: ${query}`,
                type: 'action',
                action: {
                    type: 'SHELL_EXEC',
                    payload: {
                        // Find first matching file and output its path
                        command: `Get-ChildItem -Path "${path}" -Filter "${filter}" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName`
                    }
                }
            };
        }

        // Default: Safe Echo instead of executing raw shell
        return {
            name: `Unknown Step: ${step.substring(0, 30)}`,
            type: 'action',
            action: {
                type: 'DEBUG_ECHO',
                payload: { message: `I don't know how to: ${step}` }
            }
        };
    }

    /**
     * Save a flow to disk
     */
    save(flow: Flow): void {
        flow.updatedAt = Date.now();

        const flowPath = path.join(FLOWS_DIR, `${flow.id}.json`);
        fs.writeFileSync(flowPath, JSON.stringify(flow, null, 2));

        // Update index
        const existingIdx = this.index.flows.findIndex(f => f.id === flow.id);
        const indexEntry = {
            id: flow.id,
            name: flow.name,
            trigger: flow.trigger,
            tags: flow.tags,
            createdAt: flow.createdAt,
            updatedAt: flow.updatedAt
        };

        if (existingIdx >= 0) {
            this.index.flows[existingIdx] = indexEntry;
        } else {
            this.index.flows.push(indexEntry);
        }
        this.saveIndex();

        // Also remember in agent memory
        agentMemory.remember({
            type: 'flow',
            key: flow.name,
            content: { flowId: flow.id, trigger: flow.trigger },
            source: 'flow_builder',
            confidence: 1.0,
            tags: flow.tags
        });

        console.log(`[FlowBuilder] Saved flow: ${flow.name} (${flow.id})`);
    }

    /**
     * Load a flow by ID
     */
    load(flowId: string): Flow | null {
        try {
            const flowPath = path.join(FLOWS_DIR, `${flowId}.json`);
            if (fs.existsSync(flowPath)) {
                return JSON.parse(fs.readFileSync(flowPath, 'utf8'));
            }
        } catch (e) {
            console.error(`[FlowBuilder] Failed to load flow ${flowId}:`, e);
        }
        return null;
    }

    /**
     * Find a flow by name or trigger pattern
     */
    find(query: string): Flow | null {
        const lower = query.toLowerCase();

        // Check index for matching flow
        const match = this.index.flows.find(f =>
            f.name.toLowerCase().includes(lower) ||
            f.tags.some(t => t.toLowerCase().includes(lower))
        );

        if (match) {
            return this.load(match.id);
        }

        // Check agent memory
        const memResult = agentMemory.search({
            query,
            type: 'flow',
            limit: 1
        });

        if (memResult.length > 0) {
            return this.load(memResult[0].content.flowId);
        }

        return null;
    }

    /**
     * List all saved flows
     */
    list(): FlowIndex['flows'] {
        return this.index.flows;
    }

    /**
     * Delete a flow
     */
    delete(flowId: string): boolean {
        const flowPath = path.join(FLOWS_DIR, `${flowId}.json`);

        if (fs.existsSync(flowPath)) {
            fs.unlinkSync(flowPath);
            this.index.flows = this.index.flows.filter(f => f.id !== flowId);
            this.saveIndex();
            console.log(`[FlowBuilder] Deleted flow: ${flowId}`);
            return true;
        }

        return false;
    }
}

// Singleton export
export const flowBuilder = new FlowBuilder();
