/**
 * Visual Workflow Editor - Node-based flow editing
 * Part of God Mode System - Challenge 14
 * 
 * Features:
 * - Canvas with draggable nodes
 * - Connection management
 * - Skill palette
 * - Serialization to Plan objects
 * - Validation
 * - Direct execution
 */

import { EventEmitter } from 'events';
import { globalSkillsRegistry } from '../skills/registry';
import { Plan, PlanNode, globalPlanner, PlanBuilder } from '../skills/planner';
import { SkillCard } from '../skills/skill_card';

// =============================================================================
// Types
// =============================================================================

export interface Position {
    x: number;
    y: number;
}

export interface NodeStyle {
    width: number;
    height: number;
    color: string;
    borderColor: string;
    icon?: string;
}

export type EditorNodeType = 'skill' | 'condition' | 'parallel' | 'sequence' | 'wait' | 'start' | 'end';

export interface EditorNode {
    id: string;
    type: EditorNodeType;
    position: Position;
    data: {
        label: string;
        skillId?: string;
        actionName?: string;
        params?: Record<string, any>;
        condition?: string;
        waitMs?: number;
    };
    style?: Partial<NodeStyle>;
    selected?: boolean;
    locked?: boolean;
}

export interface EditorConnection {
    id: string;
    sourceId: string;
    targetId: string;
    sourcePort?: string;
    targetPort?: string;
    label?: string;
    type?: 'default' | 'success' | 'failure';
}

export interface EditorCanvas {
    nodes: EditorNode[];
    connections: EditorConnection[];
    metadata: {
        name: string;
        version: string;
        createdAt: number;
        modifiedAt: number;
    };
}

export interface ValidationError {
    nodeId?: string;
    connectionId?: string;
    message: string;
    severity: 'error' | 'warning';
}

export interface PaletteItem {
    type: EditorNodeType;
    label: string;
    description: string;
    skill?: SkillCard;
    action?: string;
}

// =============================================================================
// Default Styles
// =============================================================================

const NODE_STYLES: Record<EditorNodeType, NodeStyle> = {
    skill: { width: 180, height: 60, color: '#4A90D9', borderColor: '#2E6DB4' },
    condition: { width: 140, height: 80, color: '#F5A623', borderColor: '#D4820A' },
    parallel: { width: 160, height: 50, color: '#7B68EE', borderColor: '#5C4BC9' },
    sequence: { width: 160, height: 50, color: '#50C878', borderColor: '#3AA860' },
    wait: { width: 120, height: 50, color: '#808080', borderColor: '#606060' },
    start: { width: 80, height: 40, color: '#2ECC71', borderColor: '#27AE60' },
    end: { width: 80, height: 40, color: '#E74C3C', borderColor: '#C0392B' }
};

// =============================================================================
// Workflow Editor
// =============================================================================

export class WorkflowEditor extends EventEmitter {
    private canvas: EditorCanvas;
    private selectedNodes: Set<string> = new Set();
    private clipboard: EditorNode[] = [];
    private undoStack: EditorCanvas[] = [];
    private redoStack: EditorCanvas[] = [];
    private maxUndoHistory = 50;

    constructor(name = 'Untitled Workflow') {
        super();
        this.canvas = this.createEmptyCanvas(name);
    }

    // -------------------------------------------------------------------------
    // Canvas Management
    // -------------------------------------------------------------------------

    private createEmptyCanvas(name: string): EditorCanvas {
        const now = Date.now();
        return {
            nodes: [
                {
                    id: 'start',
                    type: 'start',
                    position: { x: 100, y: 200 },
                    data: { label: 'Start' }
                },
                {
                    id: 'end',
                    type: 'end',
                    position: { x: 600, y: 200 },
                    data: { label: 'End' }
                }
            ],
            connections: [],
            metadata: {
                name,
                version: '1.0.0',
                createdAt: now,
                modifiedAt: now
            }
        };
    }

    getCanvas(): EditorCanvas {
        return this.canvas;
    }

    setCanvas(canvas: EditorCanvas): void {
        this.saveUndo();
        this.canvas = canvas;
        this.emit('canvas_changed', canvas);
    }

    clear(name?: string): void {
        this.saveUndo();
        this.canvas = this.createEmptyCanvas(name || 'Untitled Workflow');
        this.selectedNodes.clear();
        this.emit('canvas_cleared');
    }

    // -------------------------------------------------------------------------
    // Node Operations
    // -------------------------------------------------------------------------

    addNode(node: Omit<EditorNode, 'id'>): EditorNode {
        this.saveUndo();

        const newNode: EditorNode = {
            ...node,
            id: `node_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            style: { ...NODE_STYLES[node.type], ...node.style }
        };

        this.canvas.nodes.push(newNode);
        this.canvas.metadata.modifiedAt = Date.now();

        this.emit('node_added', newNode);
        return newNode;
    }

    addSkillNode(
        skillId: string,
        actionName: string,
        position: Position,
        params?: Record<string, any>
    ): EditorNode {
        const skill = globalSkillsRegistry.getSkillCard(skillId);
        const action = skill?.actions.find(a => a.name === actionName);

        return this.addNode({
            type: 'skill',
            position,
            data: {
                label: action?.name || actionName,
                skillId,
                actionName,
                params: params || {}
            }
        });
    }

    removeNode(nodeId: string): boolean {
        // Prevent removing start/end
        if (nodeId === 'start' || nodeId === 'end') return false;

        this.saveUndo();

        const idx = this.canvas.nodes.findIndex(n => n.id === nodeId);
        if (idx < 0) return false;

        this.canvas.nodes.splice(idx, 1);

        // Remove connected connections
        this.canvas.connections = this.canvas.connections.filter(
            c => c.sourceId !== nodeId && c.targetId !== nodeId
        );

        this.selectedNodes.delete(nodeId);
        this.canvas.metadata.modifiedAt = Date.now();

        this.emit('node_removed', nodeId);
        return true;
    }

    updateNode(nodeId: string, updates: Partial<EditorNode>): boolean {
        const node = this.canvas.nodes.find(n => n.id === nodeId);
        if (!node) return false;

        this.saveUndo();
        Object.assign(node, updates);
        this.canvas.metadata.modifiedAt = Date.now();

        this.emit('node_updated', node);
        return true;
    }

    moveNode(nodeId: string, position: Position): boolean {
        const node = this.canvas.nodes.find(n => n.id === nodeId);
        if (!node || node.locked) return false;

        node.position = position;
        this.emit('node_moved', { nodeId, position });
        return true;
    }

    getNode(nodeId: string): EditorNode | undefined {
        return this.canvas.nodes.find(n => n.id === nodeId);
    }

    getNodes(): EditorNode[] {
        return [...this.canvas.nodes];
    }

    // -------------------------------------------------------------------------
    // Connection Operations
    // -------------------------------------------------------------------------

    connect(sourceId: string, targetId: string, type?: 'default' | 'success' | 'failure'): EditorConnection | null {
        // Validate nodes exist
        const source = this.getNode(sourceId);
        const target = this.getNode(targetId);
        if (!source || !target) return null;

        // Prevent self-connection
        if (sourceId === targetId) return null;

        // Prevent duplicate connections
        if (this.canvas.connections.some(c => c.sourceId === sourceId && c.targetId === targetId)) {
            return null;
        }

        this.saveUndo();

        const connection: EditorConnection = {
            id: `conn_${Date.now()}`,
            sourceId,
            targetId,
            type: type || 'default'
        };

        this.canvas.connections.push(connection);
        this.canvas.metadata.modifiedAt = Date.now();

        this.emit('connection_added', connection);
        return connection;
    }

    disconnect(connectionId: string): boolean {
        this.saveUndo();

        const idx = this.canvas.connections.findIndex(c => c.id === connectionId);
        if (idx < 0) return false;

        this.canvas.connections.splice(idx, 1);
        this.canvas.metadata.modifiedAt = Date.now();

        this.emit('connection_removed', connectionId);
        return true;
    }

    getConnections(): EditorConnection[] {
        return [...this.canvas.connections];
    }

    getNodeConnections(nodeId: string): { incoming: EditorConnection[]; outgoing: EditorConnection[] } {
        return {
            incoming: this.canvas.connections.filter(c => c.targetId === nodeId),
            outgoing: this.canvas.connections.filter(c => c.sourceId === nodeId)
        };
    }

    // -------------------------------------------------------------------------
    // Selection
    // -------------------------------------------------------------------------

    select(nodeId: string, addToSelection = false): void {
        if (!addToSelection) {
            this.clearSelection();
        }

        const node = this.getNode(nodeId);
        if (node) {
            node.selected = true;
            this.selectedNodes.add(nodeId);
            this.emit('selection_changed', Array.from(this.selectedNodes));
        }
    }

    deselect(nodeId: string): void {
        const node = this.getNode(nodeId);
        if (node) {
            node.selected = false;
            this.selectedNodes.delete(nodeId);
            this.emit('selection_changed', Array.from(this.selectedNodes));
        }
    }

    clearSelection(): void {
        for (const nodeId of this.selectedNodes) {
            const node = this.getNode(nodeId);
            if (node) node.selected = false;
        }
        this.selectedNodes.clear();
        this.emit('selection_changed', []);
    }

    getSelection(): string[] {
        return Array.from(this.selectedNodes);
    }

    // -------------------------------------------------------------------------
    // Undo/Redo
    // -------------------------------------------------------------------------

    private saveUndo(): void {
        this.undoStack.push(JSON.parse(JSON.stringify(this.canvas)));
        if (this.undoStack.length > this.maxUndoHistory) {
            this.undoStack.shift();
        }
        this.redoStack = [];
    }

    undo(): boolean {
        const previous = this.undoStack.pop();
        if (!previous) return false;

        this.redoStack.push(JSON.parse(JSON.stringify(this.canvas)));
        this.canvas = previous;

        this.emit('canvas_changed', this.canvas);
        return true;
    }

    redo(): boolean {
        const next = this.redoStack.pop();
        if (!next) return false;

        this.undoStack.push(JSON.parse(JSON.stringify(this.canvas)));
        this.canvas = next;

        this.emit('canvas_changed', this.canvas);
        return true;
    }

    // -------------------------------------------------------------------------
    // Copy/Paste
    // -------------------------------------------------------------------------

    copy(): void {
        this.clipboard = Array.from(this.selectedNodes)
            .map(id => this.getNode(id))
            .filter((n): n is EditorNode => n !== undefined)
            .map(n => JSON.parse(JSON.stringify(n)));
    }

    paste(offset: Position = { x: 50, y: 50 }): EditorNode[] {
        if (this.clipboard.length === 0) return [];

        this.saveUndo();

        const idMap = new Map<string, string>();
        const newNodes: EditorNode[] = [];

        for (const node of this.clipboard) {
            const newId = `node_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            idMap.set(node.id, newId);

            const newNode: EditorNode = {
                ...node,
                id: newId,
                position: {
                    x: node.position.x + offset.x,
                    y: node.position.y + offset.y
                }
            };

            this.canvas.nodes.push(newNode);
            newNodes.push(newNode);
        }

        this.canvas.metadata.modifiedAt = Date.now();
        this.emit('nodes_pasted', newNodes);

        return newNodes;
    }

    // -------------------------------------------------------------------------
    // Validation
    // -------------------------------------------------------------------------

    validate(): ValidationError[] {
        const errors: ValidationError[] = [];

        // Check for disconnected nodes (except start/end)
        for (const node of this.canvas.nodes) {
            if (node.type === 'start' || node.type === 'end') continue;

            const conns = this.getNodeConnections(node.id);
            if (conns.incoming.length === 0 && conns.outgoing.length === 0) {
                errors.push({
                    nodeId: node.id,
                    message: `Node "${node.data.label}" is disconnected`,
                    severity: 'warning'
                });
            }
        }

        // Check for missing skill references
        for (const node of this.canvas.nodes) {
            if (node.type === 'skill' && node.data.skillId) {
                const skill = globalSkillsRegistry.getSkillCard(node.data.skillId);
                if (!skill) {
                    errors.push({
                        nodeId: node.id,
                        message: `Skill not found: ${node.data.skillId}`,
                        severity: 'error'
                    });
                } else if (node.data.actionName) {
                    const action = skill.actions.find(a => a.name === node.data.actionName);
                    if (!action) {
                        errors.push({
                            nodeId: node.id,
                            message: `Action not found: ${node.data.actionName}`,
                            severity: 'error'
                        });
                    }
                }
            }
        }

        // Check start has outgoing
        const startConns = this.getNodeConnections('start');
        if (startConns.outgoing.length === 0) {
            errors.push({
                nodeId: 'start',
                message: 'Start node has no outgoing connections',
                severity: 'error'
            });
        }

        // Check end has incoming
        const endConns = this.getNodeConnections('end');
        if (endConns.incoming.length === 0) {
            errors.push({
                nodeId: 'end',
                message: 'End node has no incoming connections',
                severity: 'warning'
            });
        }

        return errors;
    }

    isValid(): boolean {
        return this.validate().filter(e => e.severity === 'error').length === 0;
    }

    // -------------------------------------------------------------------------
    // Serialization
    // -------------------------------------------------------------------------

    toPlan(): Plan {
        const builder = new PlanBuilder(this.canvas.metadata.name);

        // Build nodes
        for (const node of this.canvas.nodes) {
            if (node.type === 'start' || node.type === 'end') continue;

            if (node.type === 'skill' && node.data.skillId && node.data.actionName) {
                builder.skill(
                    node.id,
                    node.data.skillId,
                    node.data.actionName,
                    node.data.params || {}
                );
            } else if (node.type === 'wait' && node.data.waitMs) {
                builder.wait(node.id, node.data.waitMs);
            } else if (node.type === 'condition' && node.data.condition) {
                // Find success/failure branches
                const outgoing = this.getNodeConnections(node.id).outgoing;
                const successConn = outgoing.find(c => c.type === 'success');
                const failureConn = outgoing.find(c => c.type === 'failure');

                if (successConn && failureConn) {
                    builder.conditional(
                        node.id,
                        node.data.condition,
                        successConn.targetId,
                        failureConn.targetId
                    );
                }
            } else if (node.type === 'parallel') {
                // Find all outgoing targets
                const targets = this.getNodeConnections(node.id).outgoing.map(c => c.targetId);
                if (targets.length > 0) {
                    builder.parallel(node.id, ...targets);
                }
            } else if (node.type === 'sequence') {
                // Find ordered targets
                const targets = this.getNodeConnections(node.id).outgoing.map(c => c.targetId);
                if (targets.length > 0) {
                    builder.sequence(node.id, ...targets);
                }
            }
        }

        // Set dependencies from connections
        for (const conn of this.canvas.connections) {
            if (conn.sourceId === 'start' || conn.targetId === 'end') continue;
            if (conn.type === 'success' || conn.type === 'failure') continue;

            builder.dependsOn(conn.sourceId);
        }

        // Find root (first node after start)
        const startOutgoing = this.getNodeConnections('start').outgoing;
        if (startOutgoing.length > 0) {
            builder.root(startOutgoing[0].targetId);
        }

        return builder.build();
    }

    fromPlan(plan: Plan): void {
        this.saveUndo();
        this.canvas = this.createEmptyCanvas(plan.id);

        // Position nodes
        let x = 250;
        const y = 200;

        const processNode = (planNode: PlanNode): string => {
            let editorNode: EditorNode;

            if (planNode.type === 'skill') {
                editorNode = this.addNode({
                    type: 'skill',
                    position: { x, y },
                    data: {
                        label: planNode.actionName || planNode.skillId || '',
                        skillId: planNode.skillId,
                        actionName: planNode.actionName,
                        params: planNode.params
                    }
                });
            } else if (planNode.type === 'wait') {
                editorNode = this.addNode({
                    type: 'wait',
                    position: { x, y },
                    data: {
                        label: `Wait ${planNode.waitMs}ms`,
                        waitMs: planNode.waitMs
                    }
                });
            } else if (planNode.type === 'conditional') {
                editorNode = this.addNode({
                    type: 'condition',
                    position: { x, y },
                    data: {
                        label: 'Condition',
                        condition: typeof planNode.condition === 'string' ? planNode.condition : 'true'
                    }
                });
            } else if (planNode.type === 'parallel') {
                editorNode = this.addNode({
                    type: 'parallel',
                    position: { x, y },
                    data: { label: 'Parallel' }
                });
            } else {
                editorNode = this.addNode({
                    type: 'sequence',
                    position: { x, y },
                    data: { label: 'Sequence' }
                });
            }

            x += 200;
            return editorNode.id;
        };

        // Process root node
        if (plan.rootNode) {
            const rootId = processNode(plan.rootNode);
            this.connect('start', rootId);
            this.connect(rootId, 'end');
        }

        this.emit('canvas_changed', this.canvas);
    }

    // -------------------------------------------------------------------------
    // Execution
    // -------------------------------------------------------------------------

    async execute(): Promise<any> {
        const errors = this.validate();
        if (errors.some(e => e.severity === 'error')) {
            throw new Error(`Workflow has validation errors: ${errors.map(e => e.message).join(', ')}`);
        }

        const plan = this.toPlan();
        this.emit('execution_start', plan);

        try {
            const result = await globalPlanner.executePlan(plan);
            this.emit('execution_complete', result);
            return result;
        } catch (error) {
            this.emit('execution_error', error);
            throw error;
        }
    }

    // -------------------------------------------------------------------------
    // Palette
    // -------------------------------------------------------------------------

    getPalette(): PaletteItem[] {
        const items: PaletteItem[] = [
            { type: 'condition', label: 'Condition', description: 'Branch based on condition' },
            { type: 'parallel', label: 'Parallel', description: 'Run nodes in parallel' },
            { type: 'sequence', label: 'Sequence', description: 'Run nodes in sequence' },
            { type: 'wait', label: 'Wait', description: 'Pause execution' }
        ];

        // Add skill items
        const skills = globalSkillsRegistry.getAllSkillCards();
        for (const skill of skills) {
            for (const action of skill.actions) {
                items.push({
                    type: 'skill',
                    label: `${skill.name}: ${action.name}`,
                    description: action.description,
                    skill,
                    action: action.name
                });
            }
        }

        return items;
    }

    // -------------------------------------------------------------------------
    // Import/Export
    // -------------------------------------------------------------------------

    exportJSON(): string {
        return JSON.stringify(this.canvas, null, 2);
    }

    importJSON(json: string): void {
        const canvas = JSON.parse(json);
        this.setCanvas(canvas);
    }
}

// =============================================================================
// Singleton Export
// =============================================================================

export const globalWorkflowEditor = new WorkflowEditor();
