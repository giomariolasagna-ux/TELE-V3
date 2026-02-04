// Moonshot Node (HTTP Orchestrator)
// Executes HTTP requests and acts as a connector/processor in the graph

import { BaseNode } from './base_node';
import axios from 'axios';

export class MoonshotNode extends BaseNode {
    constructor(id?: string) {
        super('Moonshot HTTP', 'moonshot_http', id);

        // Inputs
        this.addInput('url', 'string');
        this.addInput('method', 'string', 'GET');
        this.addInput('headers', 'json', {});
        this.addInput('body', 'any', null);

        // Outputs
        this.addOutput('response', 'any');
        this.addOutput('status', 'number');
        this.addOutput('error', 'string');
    }

    async process(context?: any): Promise<void> {
        const url = this.inputs.get('url')?.value;
        const method = this.inputs.get('method')?.value || 'GET';
        const headers = this.inputs.get('headers')?.value || {};
        const body = this.inputs.get('body')?.value;

        if (!url) {
            this.outputs.get('error')!.value = 'Missing URL input';
            return;
        }

        console.log(`[MoonshotNode] Executing ${method} ${url}`);

        try {
            const response = await axios({
                url,
                method,
                headers,
                data: body,
                validateStatus: () => true // Don't throw on error status
            });

            // Set outputs
            this.outputs.get('status')!.value = response.status;
            this.outputs.get('response')!.value = response.data;
            this.outputs.get('error')!.value = null;

            console.log(`[MoonshotNode] Success: ${response.status}`);
        } catch (error: any) {
            console.error(`[MoonshotNode] Error: ${error.message}`);
            this.outputs.get('error')!.value = error.message;
            this.outputs.get('status')!.value = 0;
            this.outputs.get('response')!.value = null;
        }
    }
}
