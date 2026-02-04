/**
 * Hierarchical Planner - Multi-skill flow composition
 * Part of God Mode System - Challenge 8
 * 
 * Features:
 * - DAG-based task decomposition
 * - Dependency resolution
 * - Parallel execution where possible
 * - Intent matching to skills
 * - Dynamic plan optimization
 */

import { EventEmitter } from 'events';
import { SkillCard, SkillAction, ExecutionContext, ActionResult } from './skill_card';
import { globalSkillsRegistry } from './registry';
import { globalTelemetry } from './telemetry';

// =============================================================================
// Types
// =============================================================================

export interface PlanNode {
    id: string;
    type: 'skill' | 'conditional' | 'parallel' | 'sequence' | 'wait';

    // Skill node properties
    skillId?: string;
    actionName?: string;
    params?: Record<string, any>;

    // Flow control properties
    condition?: ((context: PlanContext) => boolean) | string;
    children?: PlanNode[];

    // Metadata
    description?: string;
    estimatedDurationMs?: number;
    waitMs?: number;       // Alias for readability (used by UI)
    priority?: number;
    retryCount?: number;
    maxRetries?: number;

    // Dependencies (for DAG)
    dependsOn?: string[];  // Node IDs this node depends on
}

export interface Plan {
    id: string;
    name: string;
    description?: string;
    rootNode: PlanNode;
    createdAt: number;
    estimatedDurationMs?: number;
}

export interface PlanContext {
    planId: string;
    startTime: number;
    results: Map<string, ActionResult>;
    variables: Map<string, any>;
    signal: AbortSignal;
}

export interface PlanExecutionResult {
    success: boolean;
    totalDurationMs: number;
    nodesExecuted: number;
    nodesFailed: number;
    results: Map<string, ActionResult>;
    error?: string;
}

export interface IntentMatch {
    skillId: string;
    actionName: string;
    confidence: number;
    params: Record<string, any>;
}

// =============================================================================
// Intent Matcher
// =============================================================================

export class IntentMatcher {
    private patterns: Map<string, RegExp[]> = new Map();

    constructor() {
        this.initializePatterns();
    }

    private initializePatterns(): void {
        // Common intent patterns
        this.patterns.set('open', [
            /^open\s+(.+)/i,
            /^launch\s+(.+)/i,
            /^start\s+(.+)/i,
        ]);

        this.patterns.set('close', [
            /^close\s+(.+)/i,
            /^quit\s+(.+)/i,
            /^exit\s+(.+)/i,
        ]);

        this.patterns.set('navigate', [
            /^(?:go|navigate)\s+to\s+(.+)/i,
            /^open\s+folder\s+(.+)/i,
        ]);

        this.patterns.set('play', [
            /^play\s+(.+)/i,
            /^listen\s+to\s+(.+)/i,
        ]);

        this.patterns.set('render', [
            /^render\s+(.+)/i,
            /^export\s+(.+)\s+(?:as|to)\s+(.+)/i,
        ]);

        this.patterns.set('create', [
            /^create\s+(?:a\s+)?(?:new\s+)?(.+)/i,
            /^make\s+(?:a\s+)?(?:new\s+)?(.+)/i,
        ]);
    }

    /**
     * Match a natural language intent to available skills
     */
    match(input: string): IntentMatch[] {
        const matches: IntentMatch[] = [];
        const lowerInput = input.toLowerCase();
        const skills = globalSkillsRegistry.getEnabledSkillCards();

        for (const skill of skills) {
            for (const action of skill.actions) {
                const score = this.calculateMatchScore(lowerInput, skill, action);

                if (score > 0.3) {
                    matches.push({
                        skillId: skill.id,
                        actionName: action.name,
                        confidence: score,
                        params: this.extractParams(input, action)
                    });
                }
            }
        }

        // Sort by confidence
        return matches.sort((a, b) => b.confidence - a.confidence);
    }

    private calculateMatchScore(input: string, skill: SkillCard, action: SkillAction): number {
        let score = 0;

        // Check skill name/tags
        if (input.includes(skill.name.toLowerCase())) score += 0.3;
        for (const tag of skill.tags) {
            if (input.includes(tag.toLowerCase())) score += 0.15;
        }

        // Check action name
        if (input.includes(action.name.toLowerCase())) score += 0.4;

        // Check action description
        const descWords = action.description.toLowerCase().split(/\s+/);
        for (const word of descWords) {
            if (word.length > 3 && input.includes(word)) score += 0.05;
        }

        // Check against common patterns
        for (const [intent, patterns] of this.patterns) {
            if (action.name.toLowerCase().includes(intent)) {
                for (const pattern of patterns) {
                    if (pattern.test(input)) score += 0.2;
                }
            }
        }

        return Math.min(1, score);
    }

    private extractParams(input: string, action: SkillAction): Record<string, any> {
        const params: Record<string, any> = {};

        // Extract quoted strings
        const quoted = input.match(/"([^"]+)"|'([^']+)'/g);
        if (quoted) {
            // Assume first quoted value is a path/name parameter
            params.path = quoted[0].replace(/['"]/g, '');
        }

        // Extract file paths
        const pathMatch = input.match(/([A-Za-z]:\\[^\s]+|\/[^\s]+)/);
        if (pathMatch) {
            params.path = pathMatch[1];
        }

        // Extract URLs
        const urlMatch = input.match(/(https?:\/\/[^\s]+)/);
        if (urlMatch) {
            params.url = urlMatch[1];
        }

        // Extract numbers
        const numMatch = input.match(/\b(\d+(?:\.\d+)?)\b/);
        if (numMatch) {
            params.value = parseFloat(numMatch[1]);
        }

        return params;
    }
}

// =============================================================================
// Hierarchical Planner
// =============================================================================

export class HierarchicalPlanner extends EventEmitter {
    private intentMatcher: IntentMatcher;
    private activePlan: Plan | null = null;
    private abortController: AbortController | null = null;

    constructor() {
        super();
        this.intentMatcher = new IntentMatcher();
    }

    // -------------------------------------------------------------------------
    // Plan Creation
    // -------------------------------------------------------------------------

    /**
     * Create a plan from natural language
     */
    createPlanFromNL(input: string): Plan {
        const matches = this.intentMatcher.match(input);

        if (matches.length === 0) {
            throw new Error(`No matching skills found for: "${input}"`);
        }

        const bestMatch = matches[0];
        const nodeId = `node_${Date.now()}`;

        const plan: Plan = {
            id: `plan_${Date.now()}`,
            name: input.substring(0, 50),
            rootNode: {
                id: nodeId,
                type: 'skill',
                skillId: bestMatch.skillId,
                actionName: bestMatch.actionName,
                params: bestMatch.params,
                description: input
            },
            createdAt: Date.now()
        };

        console.log(`[Planner] Created plan: ${plan.name}`);
        console.log(`[Planner] Matched: ${bestMatch.skillId}.${bestMatch.actionName} (${(bestMatch.confidence * 100).toFixed(0)}%)`);

        return plan;
    }

    /**
     * Create a multi-step plan from a sequence of commands
     */
    createSequencePlan(name: string, steps: string[]): Plan {
        const children: PlanNode[] = [];

        for (let i = 0; i < steps.length; i++) {
            const matches = this.intentMatcher.match(steps[i]);

            if (matches.length > 0) {
                const match = matches[0];
                children.push({
                    id: `step_${i}`,
                    type: 'skill',
                    skillId: match.skillId,
                    actionName: match.actionName,
                    params: match.params,
                    description: steps[i],
                    dependsOn: i > 0 ? [`step_${i - 1}`] : undefined
                });
            }
        }

        return {
            id: `plan_${Date.now()}`,
            name,
            rootNode: {
                id: 'root',
                type: 'sequence',
                children
            },
            createdAt: Date.now()
        };
    }

    /**
     * Create a plan that runs steps in parallel
     */
    createParallelPlan(name: string, steps: string[]): Plan {
        const children: PlanNode[] = [];

        for (let i = 0; i < steps.length; i++) {
            const matches = this.intentMatcher.match(steps[i]);

            if (matches.length > 0) {
                const match = matches[0];
                children.push({
                    id: `parallel_${i}`,
                    type: 'skill',
                    skillId: match.skillId,
                    actionName: match.actionName,
                    params: match.params,
                    description: steps[i]
                });
            }
        }

        return {
            id: `plan_${Date.now()}`,
            name,
            rootNode: {
                id: 'root',
                type: 'parallel',
                children
            },
            createdAt: Date.now()
        };
    }

    /**
     * Build a custom DAG plan
     */
    buildPlan(name: string): PlanBuilder {
        return new PlanBuilder(name);
    }

    // -------------------------------------------------------------------------
    // Plan Execution
    // -------------------------------------------------------------------------

    async executePlan(plan: Plan): Promise<PlanExecutionResult> {
        this.activePlan = plan;
        this.abortController = new AbortController();

        const context: PlanContext = {
            planId: plan.id,
            startTime: Date.now(),
            results: new Map(),
            variables: new Map(),
            signal: this.abortController.signal
        };

        this.emit('plan_start', plan);
        console.log(`[Planner] Executing plan: ${plan.name}`);

        let nodesExecuted = 0;
        let nodesFailed = 0;

        try {
            const result = await this.executeNode(plan.rootNode, context);
            nodesExecuted = context.results.size;
            nodesFailed = Array.from(context.results.values()).filter(r => !r.success).length;

            this.emit('plan_complete', { plan, result });

            return {
                success: result.success,
                totalDurationMs: Date.now() - context.startTime,
                nodesExecuted,
                nodesFailed,
                results: context.results
            };
        } catch (error: any) {
            this.emit('plan_error', { plan, error });

            return {
                success: false,
                totalDurationMs: Date.now() - context.startTime,
                nodesExecuted,
                nodesFailed: nodesFailed + 1,
                results: context.results,
                error: error.message
            };
        } finally {
            this.activePlan = null;
            this.abortController = null;
        }
    }

    private async executeNode(node: PlanNode, context: PlanContext): Promise<ActionResult> {
        // Check abort
        if (context.signal.aborted) {
            return { success: false, error: 'Plan aborted', durationMs: 0 };
        }

        // Wait for dependencies
        if (node.dependsOn) {
            for (const depId of node.dependsOn) {
                if (!context.results.has(depId)) {
                    throw new Error(`Missing dependency: ${depId}`);
                }
                const depResult = context.results.get(depId)!;
                if (!depResult.success) {
                    return { success: false, error: `Dependency failed: ${depId}`, durationMs: 0 };
                }
            }
        }

        this.emit('node_start', node);

        let result: ActionResult;

        switch (node.type) {
            case 'skill':
                result = await this.executeSkillNode(node, context);
                break;

            case 'sequence':
                result = await this.executeSequence(node.children || [], context);
                break;

            case 'parallel':
                result = await this.executeParallel(node.children || [], context);
                break;

            case 'conditional':
                result = await this.executeConditional(node, context);
                break;

            case 'wait':
                await new Promise(r => setTimeout(r, node.estimatedDurationMs || 1000));
                result = { success: true, durationMs: node.estimatedDurationMs || 1000 };
                break;

            default:
                result = { success: false, error: `Unknown node type: ${node.type}`, durationMs: 0 };
        }

        context.results.set(node.id, result);
        this.emit('node_complete', { node, result });

        return result;
    }

    private async executeSkillNode(node: PlanNode, context: PlanContext): Promise<ActionResult> {
        if (!node.skillId || !node.actionName) {
            return { success: false, error: 'Invalid skill node', durationMs: 0 };
        }

        const skill = globalSkillsRegistry.getSkillCard(node.skillId);
        if (!skill) {
            return { success: false, error: `Skill not found: ${node.skillId}`, durationMs: 0 };
        }

        const action = skill.actions.find(a => a.name === node.actionName);
        if (!action) {
            return { success: false, error: `Action not found: ${node.actionName}`, durationMs: 0 };
        }

        const execContext: ExecutionContext = {
            sessionId: context.planId,
            startTime: Date.now(),
            signal: context.signal,
            logger: {
                debug: (msg) => console.debug(`[${node.id}] ${msg}`),
                info: (msg) => console.log(`[${node.id}] ${msg}`),
                warn: (msg) => console.warn(`[${node.id}] ${msg}`),
                error: (msg) => console.error(`[${node.id}] ${msg}`)
            },
            telemetry: {
                recordLatency: (actionName, lat) => globalTelemetry.recordLatency(node.skillId!, actionName, lat),
                recordSuccess: (actionName) => globalTelemetry.recordSuccess(node.skillId!, actionName, 0),
                recordFailure: (actionName, err) => globalTelemetry.recordFailure(node.skillId!, actionName, 0, err.message),
                recordMetric: () => { }
            }
        };

        // Substitute variables in params
        const params = this.substituteVariables(node.params || {}, context);

        // Execute with retry
        let attempt = 0;
        const maxAttempts = (node.maxRetries || 0) + 1;

        while (attempt < maxAttempts) {
            try {
                const result = await action.execute(params, execContext);

                // Record telemetry
                if (result.success) {
                    globalTelemetry.recordSuccess(node.skillId!, node.actionName!, result.durationMs);
                } else {
                    globalTelemetry.recordFailure(node.skillId!, node.actionName!, result.durationMs, result.error || 'Unknown');
                }

                return result;
            } catch (error: any) {
                attempt++;
                if (attempt >= maxAttempts) {
                    return { success: false, error: error.message, durationMs: 0 };
                }
                console.log(`[Planner] Retrying ${node.id} (attempt ${attempt + 1}/${maxAttempts})`);
            }
        }

        return { success: false, error: 'Max retries exceeded', durationMs: 0 };
    }

    private async executeSequence(nodes: PlanNode[], context: PlanContext): Promise<ActionResult> {
        const startTime = Date.now();

        for (const node of nodes) {
            const result = await this.executeNode(node, context);
            if (!result.success) {
                return { success: false, error: `Sequence failed at ${node.id}`, durationMs: Date.now() - startTime };
            }
        }

        return { success: true, durationMs: Date.now() - startTime };
    }

    private async executeParallel(nodes: PlanNode[], context: PlanContext): Promise<ActionResult> {
        const startTime = Date.now();

        const results = await Promise.all(
            nodes.map(node => this.executeNode(node, context))
        );

        const failed = results.filter(r => !r.success);

        return {
            success: failed.length === 0,
            error: failed.length > 0 ? `${failed.length} parallel nodes failed` : undefined,
            durationMs: Date.now() - startTime
        };
    }

    private async executeConditional(node: PlanNode, context: PlanContext): Promise<ActionResult> {
        if (!node.condition || !node.children || node.children.length === 0) {
            return { success: false, error: 'Invalid conditional node', durationMs: 0 };
        }

        const conditionMet = typeof node.condition === 'function'
            ? node.condition(context)
            : this.evalCondition(node.condition as string, context);

        if (conditionMet) {
            return this.executeNode(node.children[0], context);
        } else if (node.children.length > 1) {
            return this.executeNode(node.children[1], context);
        }

        return { success: true, durationMs: 0 };
    }

    private evalCondition(condition: string, context: PlanContext): boolean {
        // Simple condition evaluation
        if (condition === 'true') return true;
        if (condition === 'false') return false;

        // Check for variable presence if format is "$var"
        if (condition.startsWith('$')) {
            const varName = condition.substring(1);
            return context.variables.has(varName) && !!context.variables.get(varName);
        }

        return false;
    }

    private substituteVariables(params: Record<string, any>, context: PlanContext): Record<string, any> {
        const result: Record<string, any> = {};

        for (const [key, value] of Object.entries(params)) {
            if (typeof value === 'string' && value.startsWith('$')) {
                const varName = value.substring(1);
                result[key] = context.variables.get(varName) ?? value;
            } else {
                result[key] = value;
            }
        }

        return result;
    }

    // -------------------------------------------------------------------------
    // Control
    // -------------------------------------------------------------------------

    abort(): void {
        if (this.abortController) {
            this.abortController.abort();
            console.log('[Planner] Plan aborted');
        }
    }

    isExecuting(): boolean {
        return this.activePlan !== null;
    }

    getActivePlan(): Plan | null {
        return this.activePlan;
    }
}

// =============================================================================
// Plan Builder (Fluent API)
// =============================================================================

export class PlanBuilder {
    private plan: Partial<Plan>;
    private currentNode: PlanNode | null = null;
    private nodes: Map<string, PlanNode> = new Map();

    constructor(name: string) {
        this.plan = {
            id: `plan_${Date.now()}`,
            name,
            createdAt: Date.now()
        };
    }

    skill(id: string, skillId: string, actionName: string, params?: Record<string, any>): this {
        const node: PlanNode = {
            id,
            type: 'skill',
            skillId,
            actionName,
            params
        };
        this.nodes.set(id, node);
        this.currentNode = node;
        return this;
    }

    wait(id: string, durationMs: number): this {
        const node: PlanNode = {
            id,
            type: 'wait',
            estimatedDurationMs: durationMs
        };
        this.nodes.set(id, node);
        this.currentNode = node;
        return this;
    }

    conditional(id: string, condition: ((context: PlanContext) => boolean) | string, ifNodeId: string, elseNodeId?: string): this {
        const children: PlanNode[] = [];
        const ifNode = this.nodes.get(ifNodeId);
        if (ifNode) children.push(ifNode);

        if (elseNodeId) {
            const elseNode = this.nodes.get(elseNodeId);
            if (elseNode) children.push(elseNode);
        }

        const node: PlanNode = {
            id,
            type: 'conditional',
            condition,
            children
        };
        this.nodes.set(id, node);
        this.currentNode = node;
        return this;
    }

    dependsOn(...nodeIds: string[]): this {
        if (this.currentNode) {
            this.currentNode.dependsOn = nodeIds;
        }
        return this;
    }

    retry(maxRetries: number): this {
        if (this.currentNode) {
            this.currentNode.maxRetries = maxRetries;
        }
        return this;
    }

    parallel(id: string, ...nodeIds: string[]): this {
        const children = nodeIds.map(nid => this.nodes.get(nid)).filter(n => n) as PlanNode[];
        const node: PlanNode = {
            id,
            type: 'parallel',
            children
        };
        this.nodes.set(id, node);
        this.currentNode = node;
        return this;
    }

    sequence(id: string, ...nodeIds: string[]): this {
        const children = nodeIds.map(nid => this.nodes.get(nid)).filter(n => n) as PlanNode[];
        const node: PlanNode = {
            id,
            type: 'sequence',
            children
        };
        this.nodes.set(id, node);
        this.currentNode = node;
        return this;
    }

    root(nodeId: string): this {
        const node = this.nodes.get(nodeId);
        if (node) {
            this.plan.rootNode = node;
        }
        return this;
    }

    build(): Plan {
        if (!this.plan.rootNode) {
            // Find start node
            const allNodes = Array.from(this.nodes.values());
            if (allNodes.length > 0) {
                this.plan.rootNode = allNodes[0];
            }
        }

        if (!this.plan.rootNode) {
            throw new Error('Plan must have a root node');
        }

        return this.plan as Plan;
    }
}

// =============================================================================
// Singleton Export
// =============================================================================

export const globalPlanner = new HierarchicalPlanner();
