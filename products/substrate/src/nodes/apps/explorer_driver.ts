
import { AppDriver } from '../app_driver';
import { exec } from 'child_process';

export class ExplorerDriver implements AppDriver {
    name = 'File Explorer';
    appId = 'explorer';

    async isInstalled(): Promise<boolean> {
        return true; // Use assumes Windows
    }

    async launch(): Promise<void> {
        // Just opens Home
        exec('start explorer');
    }

    async sendCommand(command: string, args: any): Promise<void> {
        if (command === 'launch') {
            const target = args.path || args.target || '';
            console.log(`[Explorer] Opening: ${target}`);
            if (target) {
                exec(`start explorer "${target}"`);
            } else {
                exec('start explorer');
            }
        }
    }

    // Stubs to satisfy interface
    async execute(code: string): Promise<any> { return null; }
    async close(): Promise<void> { }
}
