// Base Node Abstraction
// Foundation for all Workspace Nodes

import { v4 as uuidv4 } from 'uuid';

export type NodePortType = 'string' | 'number' | 'boolean' | 'json' | 'binary' | 'any';

export interface NodePort {
    id: string;
    name: string;
    type: NodePortType;
    value?: any;
    connectedTo?: string; // ID of the source/target port
}

export abstract class BaseNode {
    id: string;
    name: string;
    type: string;

    inputs: Map<string, NodePort> = new Map();
    outputs: Map<string, NodePort> = new Map();

    constructor(name: string, type: string, id?: string) {
        this.id = id || uuidv4();
        this.name = name;
        this.type = type;
    }

    addInput(name: string, type: NodePortType = 'any', defaultValue?: any) {
        const id = `${this.id}_in_${name}`;
        this.inputs.set(name, { id, name, type, value: defaultValue });
    }

    addOutput(name: string, type: NodePortType = 'any') {
        const id = `${this.id}_out_${name}`;
        this.outputs.set(name, { id, name, type });
    }

    setInput(portName: string, value: any) {
        const port = this.inputs.get(portName);
        if (port) {
            port.value = value;
        }
    }

    getOutput(portName: string): any {
        return this.outputs.get(portName)?.value;
    }

    // Abstract process method to be implemented by robust nodes
    abstract process(context?: any): Promise<void>;

    toJSON() {
        return {
            id: this.id,
            name: this.name,
            type: this.type,
            inputs: Array.from(this.inputs.entries()),
            outputs: Array.from(this.outputs.entries())
        };
    }
}
