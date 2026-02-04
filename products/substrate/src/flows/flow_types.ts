/**
 * Flow Types - Definitions for multi-step automation pipelines
 * Similar to n8n workflow concepts
 */

import { ActionObject } from '../../../../integrations/gateway_bridge';

/**
 * Context passed between flow nodes
 */
export interface FlowContext {
    // Output from previous nodes, keyed by node ID
    outputs: Record<string, any>;

    // Current working data (e.g., file content, message text)
    data: any;

    // Variables set during flow execution
    variables: Record<string, any>;

    // Metadata about the flow execution
    meta: {
        flowId: string;
        startTime: number;
        currentNodeId: string;
        previousNodeId?: string;
    };
}

/**
 * Condition evaluator for branching
 */
export interface FlowCondition {
    field: string;          // Path to value in context (e.g., 'data.length', 'outputs.node1.success')
    operator: 'eq' | 'neq' | 'gt' | 'lt' | 'contains' | 'exists' | 'empty';
    value?: any;            // Value to compare against
}

/**
 * A single node in a flow
 */
export interface FlowNode {
    id: string;
    name: string;
    type: 'action' | 'condition' | 'loop' | 'wait' | 'transform' | 'integration';

    // For 'action' type
    action?: {
        type: string;       // Action type (e.g., 'EXECUTE_APP', 'SHELL_EXEC')
        payload: any;       // Static payload
        payloadTemplate?: string; // Template with {{context.data}} placeholders
    };

    // For 'condition' type
    condition?: FlowCondition;

    // For 'wait' type
    waitMs?: number;

    // For 'transform' type - JavaScript expression
    transform?: string;     // e.g., "context.data.toUpperCase()"

    // For 'integration' type
    integration?: {
        service: 'whatsapp' | 'google' | 'telegram' | 'email';
        action: string;     // e.g., 'send_message', 'read_email'
        params: Record<string, any>;
    };

    // Next node(s)
    next?: string;          // Single next node ID
    nextTrue?: string;      // For conditions: if true
    nextFalse?: string;     // For conditions: if false

    // Error handling
    onError?: 'stop' | 'continue' | 'retry' | string; // string = jump to node ID
    retryCount?: number;
    retryDelayMs?: number;
}

/**
 * A complete flow definition
 */
export interface Flow {
    id: string;
    name: string;
    description?: string;

    // Trigger type
    trigger: 'manual' | 'voice' | 'schedule' | 'event';
    triggerConfig?: {
        voicePattern?: string;    // Regex for voice trigger
        schedule?: string;        // Cron expression
        event?: string;           // Event name to listen for
    };

    // Flow structure
    nodes: FlowNode[];
    startNodeId: string;

    // Metadata
    createdAt: number;
    updatedAt: number;
    version: number;
    tags: string[];

    // Statistics
    runCount: number;
    lastRunAt?: number;
    lastRunSuccess?: boolean;
}

/**
 * Result of a flow execution
 */
export interface FlowExecutionResult {
    flowId: string;
    success: boolean;
    startTime: number;
    endTime: number;
    durationMs: number;

    // Node execution details
    nodeResults: Array<{
        nodeId: string;
        nodeName: string;
        success: boolean;
        output?: any;
        error?: string;
        durationMs: number;
    }>;

    // Final output
    finalOutput?: any;
    error?: string;
}

/**
 * Flow storage format
 */
export interface FlowIndex {
    version: number;
    flows: Array<{
        id: string;
        name: string;
        trigger: string;
        tags: string[];
        createdAt: number;
        updatedAt: number;
    }>;
}
