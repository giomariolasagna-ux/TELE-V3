// Adobe App Driver (Photoshop/Illustrator)
// Hybrid automation: Prefer COM, fallback to exe launch
// Now uses dynamic path resolution from AppRegistry

import { AppDriver } from '../app_driver';
import { spawn, exec } from 'child_process';
import * as fs from 'fs';
import { AppInfo, appRegistry } from '../app_registry';
import { agentMemory } from '../../agent_fs/agent_memory';

export class AdobeDriver implements AppDriver {
    name: string;
    appId: string;
    progId: string;
    private exePath: string | null = null;
    private appInfo: AppInfo | null = null;

    constructor(app: 'photoshop' | 'illustrator', appInfo?: AppInfo) {
        this.appId = `adobe.${app}`;
        this.name = app === 'photoshop' ? 'Adobe Photoshop' : 'Adobe Illustrator';
        this.progId = app === 'photoshop' ? 'Photoshop.Application' : 'Illustrator.Application';

        // Use provided appInfo or resolve dynamically
        if (appInfo) {
            this.appInfo = appInfo;
            this.exePath = appInfo.executablePath;
        }
    }

    async isInstalled(): Promise<boolean> {
        // 1. Try COM first
        const psScript = `
        $obj = New-Object -ComObject ${this.progId} -ErrorAction SilentlyContinue
        if ($obj) { "true" } else { "false" }
        `;
        try {
            const result = await this.runPowerShell(psScript);
            if (result.trim() === 'true') return true;
        } catch (e) { }

        // 2. Try dynamic resolution from AppRegistry
        if (!this.appInfo) {
            this.appInfo = await appRegistry.resolve(this.appId);
        }

        if (this.appInfo?.executablePath && fs.existsSync(this.appInfo.executablePath)) {
            this.exePath = this.appInfo.executablePath;
            return true;
        }

        return false;
    }


    async launch(): Promise<void> {
        // Try COM first
        const psScript = `
        $app = New-Object -ComObject ${this.progId} -ErrorAction SilentlyContinue
        if ($app) { $app.Visible = $true } else { throw "COM Failed" }
        `;
        try {
            await this.runPowerShell(psScript);
        } catch (e) {
            // Fallback to EXE
            if (this.exePath || this.findExePath()) {
                console.log(`[Adobe] COM failed, launching from path: ${this.exePath}`);
                spawn(this.exePath!, [], { detached: true, stdio: 'ignore' }).unref();
            } else {
                throw new Error('Could not launch Adobe app (COM failed and no path found)');
            }
        }
    }

    async execute(command: string, args?: any): Promise<any> {
        // Advanced commands like 'run_javascript' require COM
        // If we launched via EXE, we might not have COM control unless the app registers itself on startup
        // We will try COM for execution regardless of launch method

        let psScript = '';

        if (this.appId === 'photoshop') {
            switch (command) {
                case 'new_document':
                    psScript = `
                    $app = [Runtime.InteropServices.Marshal]::GetActiveObject('${this.progId}')
                    $app.Documents.Add(${args.width || 1920}, ${args.height || 1080})
                    `;
                    break;
                case 'run_javascript':
                    const script = args.script.replace(/'/g, "''");
                    psScript = `
                    $app = [Runtime.InteropServices.Marshal]::GetActiveObject('${this.progId}')
                    $app.DoJavaScript('${script}')
                    `;
                    break;
                default:
                    throw new Error(`Unknown command: ${command}`);
            }
        } else {
            throw new Error(`Commands for ${this.name} not yet implemented via Driver`);
        }

        return await this.runPowerShell(psScript);
    }

    async close(): Promise<void> {
        const psScript = `
        $app = [Runtime.InteropServices.Marshal]::GetActiveObject('${this.progId}')
        $app.Quit()
        `;
        try {
            await this.runPowerShell(psScript);
        } catch (e) {
            // Hard kill fallback
            exec(`taskkill /IM ${this.appId === 'photoshop' ? 'Photoshop.exe' : 'Illustrator.exe'} /F`);
        }
    }

    private findExePath(): string | null {
        // Now uses AppRegistry - return cached path if available
        if (this.appInfo?.executablePath && fs.existsSync(this.appInfo.executablePath)) {
            this.exePath = this.appInfo.executablePath;
            return this.exePath;
        }
        return null;
    }

    private runPowerShell(script: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const ps = spawn('powershell', ['-NoProfile', '-Command', script]);

            let stdout = '';
            let stderr = '';

            ps.stdout.on('data', d => stdout += d);
            ps.stderr.on('data', d => stderr += d);

            ps.on('close', (code) => {
                if (code !== 0 && stderr) {
                    reject(new Error(stderr));
                } else {
                    resolve(stdout.trim());
                }
            });
        });
    }
}
