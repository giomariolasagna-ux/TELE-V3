// Office App Driver (Word/Excel)
// Uses PowerShell COM automation

import { AppDriver } from '../app_driver';
import { spawn } from 'child_process';

export class LinkWordDriver implements AppDriver {
    name = 'Microsoft Word';
    appId = 'word';

    async isInstalled(): Promise<boolean> {
        const psScript = `
        $obj = New-Object -ComObject Word.Application -ErrorAction SilentlyContinue
        if ($obj) { 
            try { $obj.Quit() } catch {}
            "true" 
        } else { 
            "false" 
        }
        `;
        try {
            const result = await this.runPowerShell(psScript);
            return result.trim() === 'true';
        } catch (e) {
            return false;
        }
    }

    async launch(): Promise<void> {
        const psScript = `
        $word = New-Object -ComObject Word.Application
        $word.Visible = $true
        `;
        await this.runPowerShell(psScript);
    }

    async execute(command: string, args?: any): Promise<any> {
        let psScript = '';

        switch (command) {
            case 'write_text':
                // args: { text: string }
                psScript = `
                $word = [Runtime.InteropServices.Marshal]::GetActiveObject('Word.Application')
                $doc = $word.ActiveDocument
                $selection = $word.Selection
                $selection.TypeText('${args.text || ""}')
                `;
                break;

            case 'new_document':
                psScript = `
                $word = [Runtime.InteropServices.Marshal]::GetActiveObject('Word.Application')
                $word.Documents.Add()
                `;
                break;

            default:
                throw new Error(`Unknown command: ${command}`);
        }

        return await this.runPowerShell(psScript);
    }

    async close(): Promise<void> {
        const psScript = `
        $word = [Runtime.InteropServices.Marshal]::GetActiveObject('Word.Application')
        $word.Quit()
        `;
        await this.runPowerShell(psScript);
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
