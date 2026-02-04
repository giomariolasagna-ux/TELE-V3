/**
 * Flow Executor - Runs multi-step automation pipelines
 * Handles context passing, error recovery, and integration calls
 */

import { Flow, FlowNode, FlowContext, FlowCondition, FlowExecutionResult } from './flow_types';
import { ActionObject } from '../../../../integrations/gateway_bridge';
import { Executor } from '../executor';
import { actionLog } from '../agent_fs/action_log';
import { agentMemory } from '../agent_fs/agent_memory';
import { v4 as uuidv4 } from 'uuid';

export class FlowExecutor {
    private executor: Executor;
    private abortController: AbortController | null = null;

    constructor(executor: Executor) {
        this.executor = executor;
    }

    /**
     * Execute a complete flow
     */
    async execute(flow: Flow, initialData?: any): Promise<FlowExecutionResult> {
        const startTime = Date.now();
        const nodeResults: FlowExecutionResult['nodeResults'] = [];

        console.log(`[FlowExecutor] Starting flow: ${flow.name} (${flow.id})`);

        // Initialize context
        const context: FlowContext = {
            outputs: {},
            data: initialData ?? null,
            variables: {},
            meta: {
                flowId: flow.id,
                startTime,
                currentNodeId: flow.startNodeId
            }
        };

        this.abortController = new AbortController();
        const signal = this.abortController.signal;

        let currentNodeId: string | undefined = flow.startNodeId;
        let success = true;
        let error: string | undefined;

        try {
            while (currentNodeId && !signal.aborted) {
                const node = flow.nodes.find(n => n.id === currentNodeId);
                if (!node) {
                    throw new Error(`Node not found: ${currentNodeId}`);
                }

                context.meta.currentNodeId = currentNodeId;
                console.log(`[FlowExecutor] Executing node: ${node.name} (${node.type})`);

                const nodeStartTime = Date.now();
                let nodeSuccess = true;
                let nodeOutput: any;
                let nodeError: string | undefined;

                try {
                    nodeOutput = await this.executeNode(node, context, signal);
                    context.outputs[node.id] = nodeOutput;

                    // Update context data if node produced output
                    if (nodeOutput !== undefined && nodeOutput !== null) {
                        context.data = nodeOutput;
                    }
                } catch (e: any) {
                    nodeSuccess = false;
                    nodeError = e.message;

                    // Handle error based on node config
                    if (node.onError === 'stop') {
                        throw e;
                    } else if (node.onError === 'retry' && node.retryCount) {
                        // Retry logic
                        for (let i = 0; i < node.retryCount; i++) {
                            if (node.retryDelayMs) {
                                await this.delay(node.retryDelayMs);
                            }
                            try {
                                nodeOutput = await this.executeNode(node, context, signal);
                                nodeSuccess = true;
                                nodeError = undefined;
                                break;
                            } catch (retryError: any) {
                                nodeError = retryError.message;
                            }
                        }
                        if (!nodeSuccess) throw new Error(nodeError);
                    } else if (typeof node.onError === 'string' && node.onError !== 'continue') {
                        // Jump to error handler node
                        currentNodeId = node.onError;
                        nodeResults.push({
                            nodeId: node.id,
                            nodeName: node.name,
                            success: false,
                            error: nodeError,
                            durationMs: Date.now() - nodeStartTime
                        });
                        continue;
                    }
                    // 'continue' - just proceed to next node
                }

                nodeResults.push({
                    nodeId: node.id,
                    nodeName: node.name,
                    success: nodeSuccess,
                    output: nodeOutput,
                    error: nodeError,
                    durationMs: Date.now() - nodeStartTime
                });

                // Determine next node
                context.meta.previousNodeId = currentNodeId;
                currentNodeId = this.getNextNodeId(node, context, nodeOutput);
            }
        } catch (e: any) {
            success = false;
            error = e.message;
            console.error(`[FlowExecutor] Flow failed:`, e);
        }

        const endTime = Date.now();
        const result: FlowExecutionResult = {
            flowId: flow.id,
            success,
            startTime,
            endTime,
            durationMs: endTime - startTime,
            nodeResults,
            finalOutput: context.data,
            error
        };

        // Log to action log
        actionLog.log({
            id: uuidv4(),
            timestamp: startTime,
            type: 'FLOW_EXECUTION',
            payload: { flowId: flow.id, flowName: flow.name },
            result: success ? 'success' : 'failure',
            latencyMs: result.durationMs,
            error,
            context: { nodeCount: nodeResults.length }
        });

        // Remember successful flows
        if (success) {
            agentMemory.remember({
                type: 'flow',
                key: flow.name,
                content: { flowId: flow.id, lastResult: result },
                source: 'flow_execution',
                confidence: 1.0,
                tags: flow.tags
            });
        }

        console.log(`[FlowExecutor] Flow ${success ? 'completed' : 'failed'}: ${flow.name} (${result.durationMs}ms)`);
        return result;
    }

    /**
     * Execute a single node
     */
    private async executeNode(node: FlowNode, context: FlowContext, signal: AbortSignal): Promise<any> {
        if (signal.aborted) throw new Error('Flow aborted');

        switch (node.type) {
            case 'action':
                return this.executeActionNode(node, context);

            case 'condition':
                return this.evaluateCondition(node.condition!, context);

            case 'wait':
                await this.delay(node.waitMs || 1000);
                return null;

            case 'transform':
                return this.executeTransform(node.transform!, context);

            case 'integration':
                return this.executeIntegration(node, context);

            case 'loop':
                // Loop handling would go here
                return null;

            default:
                throw new Error(`Unknown node type: ${node.type}`);
        }
    }

    /**
     * Execute an action node
     */
    private async executeActionNode(node: FlowNode, context: FlowContext): Promise<any> {
        if (!node.action) throw new Error('Action node missing action config');

        // Build payload from template if provided
        let payload = node.action.payload;
        if (node.action.payloadTemplate) {
            payload = this.resolveTemplate(node.action.payloadTemplate, context);
        }

        const action: ActionObject = {
            id: uuidv4(),
            type: node.action.type,
            payload,
            status: 'READY',
            requiresGesture: false
        };

        await this.executor.execute(action);
        return { success: true, actionId: action.id };
    }

    /**
     * Evaluate a condition
     */
    private evaluateCondition(condition: FlowCondition, context: FlowContext): boolean {
        const value = this.getValueFromPath(condition.field, context);

        switch (condition.operator) {
            case 'eq':
                return value === condition.value;
            case 'neq':
                return value !== condition.value;
            case 'gt':
                return value > condition.value;
            case 'lt':
                return value < condition.value;
            case 'contains':
                return String(value).includes(String(condition.value));
            case 'exists':
                return value !== undefined && value !== null;
            case 'empty':
                return !value || (Array.isArray(value) && value.length === 0);
            default:
                return false;
        }
    }

    /**
     * Execute a transform expression
     */
    private executeTransform(transform: string, context: FlowContext): any {
        // Create a safe evaluation context
        const evalContext = {
            context,
            data: context.data,
            outputs: context.outputs,
            variables: context.variables
        };

        try {
            // Simple expression evaluation (without eval for security)
            // Support basic operations
            if (transform.includes('.toUpperCase()')) {
                return String(context.data).toUpperCase();
            }
            if (transform.includes('.toLowerCase()')) {
                return String(context.data).toLowerCase();
            }
            if (transform.includes('.trim()')) {
                return String(context.data).trim();
            }
            if (transform.includes('.length')) {
                return context.data?.length ?? 0;
            }
            if (transform.startsWith('JSON.parse')) {
                return JSON.parse(context.data);
            }
            if (transform.startsWith('JSON.stringify')) {
                return JSON.stringify(context.data);
            }

            // Return data unchanged if no transform matched
            return context.data;
        } catch (e: any) {
            throw new Error(`Transform failed: ${e.message}`);
        }
    }

    /**
     * Execute an integration call
     */
    private async executeIntegration(node: FlowNode, context: FlowContext): Promise<any> {
        if (!node.integration) throw new Error('Integration node missing integration config');

        const { service, action, params } = node.integration;

        // Resolve params with context
        const resolvedParams: Record<string, any> = {};
        for (const [key, value] of Object.entries(params)) {
            if (typeof value === 'string' && value.includes('{{')) {
                resolvedParams[key] = this.resolveTemplate(value, context);
            } else {
                resolvedParams[key] = value;
            }
        }

        console.log(`[FlowExecutor] Integration: ${service}.${action}`, resolvedParams);

        switch (service) {
            case 'whatsapp':
                return this.executeWhatsAppIntegration(action, resolvedParams, context);
            case 'google':
                return this.executeGoogleIntegration(action, resolvedParams, context);
            case 'email':
                return this.executeEmailIntegration(action, resolvedParams, context);
            default:
                throw new Error(`Unknown integration service: ${service}`);
        }
    }

    private async executeWhatsAppIntegration(action: string, params: Record<string, any>, context: FlowContext): Promise<any> {
        // WhatsApp integration via existing OAuth/connection
        switch (action) {
            case 'send_message':
                // Use existing WhatsApp bridge
                const { to, message } = params;
                // This would call the actual WhatsApp API
                console.log(`[WhatsApp] Sending to ${to}: ${message}`);
                return { sent: true, to, message };

            default:
                throw new Error(`Unknown WhatsApp action: ${action}`);
        }
    }

    private async executeGoogleIntegration(action: string, params: Record<string, any>, context: FlowContext): Promise<any> {
        // Google integration via existing OAuth
        switch (action) {
            case 'read_email':
                // This would use the Google API
                console.log(`[Google] Reading emails...`);
                return { emails: [] };

            case 'send_email':
                const { to, subject, body } = params;
                console.log(`[Google] Sending email to ${to}: ${subject}`);
                return { sent: true };

            default:
                throw new Error(`Unknown Google action: ${action}`);
        }
    }

    private async executeEmailIntegration(action: string, params: Record<string, any>, context: FlowContext): Promise<any> {
        console.log(`[Email] ${action}:`, params);
        return { success: true };
    }

    /**
     * Get next node ID based on node type and output
     */
    private getNextNodeId(node: FlowNode, context: FlowContext, output: any): string | undefined {
        if (node.type === 'condition') {
            return output ? node.nextTrue : node.nextFalse;
        }
        return node.next;
    }

    /**
     * Resolve template strings with context values
     */
    private resolveTemplate(template: string, context: FlowContext): any {
        if (typeof template !== 'string') return template;

        // Replace {{path}} with actual values
        return template.replace(/\{\{([^}]+)\}\}/g, (match, path) => {
            const value = this.getValueFromPath(path.trim(), context);
            return value !== undefined ? String(value) : '';
        });
    }

    /**
     * Get value from dot-notation path
     */
    private getValueFromPath(path: string, obj: any): any {
        const parts = path.split('.');
        let current = obj;

        for (const part of parts) {
            if (current === null || current === undefined) return undefined;
            current = current[part];
        }

        return current;
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Abort current flow execution
     */
    abort(): void {
        if (this.abortController) {
            this.abortController.abort();
            console.log('[FlowExecutor] Flow aborted');
        }
    }
}
