// App Controller Node
// Wraps specific application drivers to control local apps via the graph

import { BaseNode } from './base_node';
import { AppDriver } from './app_driver';

export class AppNode extends BaseNode {
    private driver: AppDriver;

    constructor(driver: AppDriver, id?: string) {
        super(driver.name, `app_${driver.appId}`, id);
        this.driver = driver;

        // Common Inputs
        this.addInput('command', 'string');
        this.addInput('args', 'json', {});
        this.addInput('launch', 'boolean', false); // Trigger launch

        // Common Outputs
        this.addOutput('result', 'any');
        this.addOutput('error', 'string');
    }

    async process(context?: any): Promise<void> {
        const command = this.inputs.get('command')?.value;
        const args = this.inputs.get('args')?.value || {};
        const shouldLaunch = this.inputs.get('launch')?.value;

        if (shouldLaunch) {
            console.log(`[AppNode] Launching ${this.driver.name}...`);
            try {
                await this.driver.launch();
            } catch (e: any) {
                this.outputs.get('error')!.value = `Launch failed: ${e.message}`;
                return;
            }
        }

        if (command) {
            console.log(`[AppNode] Executing ${command} on ${this.driver.name}`);
            try {
                const result = await this.driver.execute(command, args);
                this.outputs.get('result')!.value = result;
                this.outputs.get('error')!.value = null;
            } catch (e: any) {
                console.error(`[AppNode] Execution error:`, e);
                this.outputs.get('error')!.value = e.message;
                this.outputs.get('result')!.value = null;
            }
        }
    }
}
