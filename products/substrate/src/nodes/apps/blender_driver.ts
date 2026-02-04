// Blender Driver
// Controls Blender via Command Line

import { AppDriver } from '../app_driver';
import { spawn, exec } from 'child_process';
import * as fs from 'fs';

export class BlenderDriver implements AppDriver {
    name = 'Blender';
    appId = 'blender';

    // Default paths to check
    private potentialPaths = [
        'C:\\Program Files\\Blender Foundation\\Blender 4.4\\blender.exe',
        'C:\\Program Files\\Blender Foundation\\Blender 4.0\\blender.exe',
        'C:\\Program Files\\Blender Foundation\\Blender 3.6\\blender.exe',
        'C:\\Program Files\\Blender Foundation\\Blender 3.5\\blender.exe',
    ];

    async isInstalled(): Promise<boolean> {
        for (const p of this.potentialPaths) {
            if (fs.existsSync(p)) return true;
        }
        return false;
    }

    private getPath(): string {
        for (const p of this.potentialPaths) {
            if (fs.existsSync(p)) return p;
        }
        return 'blender'; // Hope it's in PATH
    }

    async launch(): Promise<void> {
        const path = this.getPath();
        console.log(`[Blender] Launching from ${path}`);
        spawn(path, [], { detached: true, stdio: 'ignore' }).unref();
    }

    async execute(command: string, args?: any): Promise<any> {
        const path = this.getPath();

        // Blender automation usually involves running a python script
        // For security/simplicity, we'll just support rendering a frame or running a script file

        switch (command) {
            case 'render_frame':
                // args: { file: string, output: string, frame: number }
                return new Promise((resolve, reject) => {
                    const argsList = [
                        '-b', args.file,
                        '-o', args.output,
                        '-f', args.frame || 1
                    ];
                    exec(`"${path}" ${argsList.join(' ')}`, (err, stdout, stderr) => {
                        if (err) reject(stderr);
                        else resolve(stdout);
                    });
                });

            case 'run_python':
                // args: { script: string (code) }
                // We need to write code to tmp file then run it
                return new Promise((resolve, reject) => {
                    const tmpFile = `./.tele/blender_script_${Date.now()}.py`;
                    fs.writeFileSync(tmpFile, args.script);

                    const argsList = [
                        '-b',
                        '--python', tmpFile
                    ];
                    exec(`"${path}" ${argsList.join(' ')}`, (err, stdout, stderr) => {
                        fs.unlinkSync(tmpFile); // Clean up
                        if (err) reject(stderr);
                        else resolve(stdout);
                    });
                });

            default:
                throw new Error(`Unknown command: ${command}`);
        }
    }

    async close(): Promise<void> {
        // Hard kill logic since Blender doesn't have a simple IPC quit without setup
        exec('taskkill /IM blender.exe /F');
    }
}
