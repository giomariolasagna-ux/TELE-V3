/**
 * Adobe Skill - Photoshop/Illustrator automation
 * Refactored from AdobeDriver to SkillCard format
 * Part of God Mode System - Challenge 1
 */

import { z } from 'zod';
import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import {
    SkillCard,
    ExecutionContext,
    ActionResult,
    HealthStatus,
    defineSkill,
    defineAction
} from '../../skills/skill_card';

const execAsync = promisify(exec);

// =============================================================================
// Configuration Schema
// =============================================================================

const AdobeConfigSchema = z.object({
    app: z.enum(['photoshop', 'illustrator']),
    preferCOM: z.boolean().optional().default(true)
});

type AdobeConfig = z.infer<typeof AdobeConfigSchema>;

// =============================================================================
// Parameter Schemas
// =============================================================================

const LaunchParams = z.object({
    visible: z.boolean().optional().default(true)
});

const NewDocumentParams = z.object({
    width: z.number().positive().default(1920),
    height: z.number().positive().default(1080),
    name: z.string().optional()
});

const RunScriptParams = z.object({
    script: z.string().describe('JavaScript code to execute in the Adobe app')
});

const OpenFileParams = z.object({
    path: z.string().describe('Path to the file to open')
});

const SaveParams = z.object({
    path: z.string().optional().describe('Save path (optional, uses current if not specified)'),
    format: z.enum(['psd', 'png', 'jpg', 'pdf']).optional()
});

// =============================================================================
// Helper Functions
// =============================================================================

function getProgId(app: 'photoshop' | 'illustrator'): string {
    return app === 'photoshop' ? 'Photoshop.Application' : 'Illustrator.Application';
}

function getExeName(app: 'photoshop' | 'illustrator'): string {
    return app === 'photoshop' ? 'Photoshop.exe' : 'Illustrator.exe';
}

async function runPowerShell(script: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const ps = spawn('powershell', ['-NoProfile', '-Command', script]);
        let stdout = '';
        let stderr = '';

        ps.stdout.on('data', (d: Buffer) => stdout += d);
        ps.stderr.on('data', (d: Buffer) => stderr += d);

        ps.on('close', (code) => {
            if (code !== 0 && stderr) {
                reject(new Error(stderr));
            } else {
                resolve(stdout.trim());
            }
        });
    });
}

async function checkCOMAvailable(progId: string): Promise<boolean> {
    const script = `
    $obj = New-Object -ComObject ${progId} -ErrorAction SilentlyContinue
    if ($obj) { "true" } else { "false" }
    `;
    try {
        const result = await runPowerShell(script);
        return result.trim() === 'true';
    } catch {
        return false;
    }
}

// =============================================================================
// Skill Factory
// =============================================================================

function createAdobeSkill(app: 'photoshop' | 'illustrator'): SkillCard<AdobeConfig> {
    const progId = getProgId(app);
    const exeName = getExeName(app);
    const appName = app === 'photoshop' ? 'Adobe Photoshop' : 'Adobe Illustrator';

    return defineSkill<AdobeConfig>()
        .id(`skill.adobe.${app}`)
        .name(appName)
        .version('1.0.0')
        .description(`${appName} automation via COM and scripting`)
        .author('TELE God Mode')
        .category('app')
        .tags('adobe', app, 'creative', 'design', 'graphics')
        .configSchema(AdobeConfigSchema)

        .action({
            name: 'launch',
            description: `Launch ${appName}`,
            parameters: LaunchParams,
            estimatedDurationMs: 5000,
            execute: async (params, context) => {
                const startTime = Date.now();
                try {
                    context.logger.info(`Launching ${appName}...`);

                    // Try COM first
                    const script = `
                    $app = New-Object -ComObject ${progId} -ErrorAction SilentlyContinue
                    if ($app) { $app.Visible = $${params.visible}; "success" } else { throw "COM Failed" }
                    `;

                    try {
                        await runPowerShell(script);
                        return {
                            success: true,
                            data: { launched: true, method: 'COM' },
                            durationMs: Date.now() - startTime
                        };
                    } catch {
                        // Fallback to direct launch
                        context.logger.info('COM failed, trying direct launch...');
                        exec(`start ${exeName}`);
                        return {
                            success: true,
                            data: { launched: true, method: 'direct' },
                            durationMs: Date.now() - startTime
                        };
                    }
                } catch (error: any) {
                    return {
                        success: false,
                        error: error.message,
                        durationMs: Date.now() - startTime
                    };
                }
            }
        })

        .action({
            name: 'newDocument',
            description: 'Create a new document',
            parameters: NewDocumentParams,
            estimatedDurationMs: 1000,
            execute: async (params, context) => {
                const startTime = Date.now();
                try {
                    if (app !== 'photoshop') {
                        throw new Error('newDocument only supported for Photoshop currently');
                    }

                    const script = `
                    $app = [Runtime.InteropServices.Marshal]::GetActiveObject('${progId}')
                    $app.Documents.Add(${params.width}, ${params.height})
                    `;

                    await runPowerShell(script);

                    return {
                        success: true,
                        data: { created: true, width: params.width, height: params.height },
                        durationMs: Date.now() - startTime
                    };
                } catch (error: any) {
                    return {
                        success: false,
                        error: error.message,
                        durationMs: Date.now() - startTime
                    };
                }
            }
        })

        .action({
            name: 'runScript',
            description: 'Execute JavaScript in the Adobe application',
            parameters: RunScriptParams,
            estimatedDurationMs: 2000,
            execute: async (params, context) => {
                const startTime = Date.now();
                try {
                    if (app !== 'photoshop') {
                        throw new Error('runScript only supported for Photoshop currently');
                    }

                    const escapedScript = params.script.replace(/'/g, "''");
                    const psScript = `
                    $app = [Runtime.InteropServices.Marshal]::GetActiveObject('${progId}')
                    $app.DoJavaScript('${escapedScript}')
                    `;

                    const result = await runPowerShell(psScript);

                    return {
                        success: true,
                        data: { executed: true, result },
                        durationMs: Date.now() - startTime
                    };
                } catch (error: any) {
                    return {
                        success: false,
                        error: error.message,
                        durationMs: Date.now() - startTime
                    };
                }
            }
        })

        .action({
            name: 'openFile',
            description: 'Open a file in the Adobe application',
            parameters: OpenFileParams,
            estimatedDurationMs: 3000,
            execute: async (params, context) => {
                const startTime = Date.now();
                try {
                    if (!fs.existsSync(params.path)) {
                        throw new Error(`File not found: ${params.path}`);
                    }

                    const script = `
                    $app = [Runtime.InteropServices.Marshal]::GetActiveObject('${progId}')
                    $app.Open("${params.path.replace(/\\/g, '\\\\')}")
                    `;

                    await runPowerShell(script);

                    return {
                        success: true,
                        data: { opened: true, path: params.path },
                        durationMs: Date.now() - startTime
                    };
                } catch (error: any) {
                    return {
                        success: false,
                        error: error.message,
                        durationMs: Date.now() - startTime
                    };
                }
            }
        })

        .action({
            name: 'close',
            description: `Close ${appName}`,
            parameters: z.object({}),
            estimatedDurationMs: 2000,
            execute: async (params, context) => {
                const startTime = Date.now();
                try {
                    // Try graceful quit via COM
                    try {
                        const script = `
                        $app = [Runtime.InteropServices.Marshal]::GetActiveObject('${progId}')
                        $app.Quit()
                        `;
                        await runPowerShell(script);
                    } catch {
                        // Hard kill fallback
                        await execAsync(`taskkill /IM ${exeName} /F`);
                    }

                    return {
                        success: true,
                        data: { closed: true },
                        durationMs: Date.now() - startTime
                    };
                } catch (error: any) {
                    return {
                        success: false,
                        error: error.message,
                        durationMs: Date.now() - startTime
                    };
                }
            }
        })

        .healthCheck(async (): Promise<HealthStatus> => {
            try {
                const comAvailable = await checkCOMAvailable(progId);

                if (comAvailable) {
                    return {
                        status: 'healthy',
                        message: `${appName} COM automation available`,
                        lastCheck: Date.now()
                    };
                }

                // Check if app is at least installed (exe exists)
                try {
                    await execAsync(`where ${exeName}`);
                    return {
                        status: 'degraded',
                        message: `${appName} installed but COM not available - direct launch only`,
                        lastCheck: Date.now()
                    };
                } catch {
                    return {
                        status: 'unhealthy',
                        message: `${appName} not found`,
                        lastCheck: Date.now()
                    };
                }
            } catch (error: any) {
                return {
                    status: 'unhealthy',
                    message: error.message,
                    lastCheck: Date.now()
                };
            }
        })

        .build();
}

// =============================================================================
// Exported Skills
// =============================================================================

export const photoshopSkill = createAdobeSkill('photoshop');
export const illustratorSkill = createAdobeSkill('illustrator');

// =============================================================================
// Legacy Compatibility Adapter
// =============================================================================

export class AdobeSkillAdapter {
    private skill: SkillCard<AdobeConfig>;
    name: string;
    appId: string;

    constructor(app: 'photoshop' | 'illustrator') {
        this.skill = app === 'photoshop' ? photoshopSkill : illustratorSkill;
        this.name = this.skill.name;
        this.appId = `adobe.${app}`;
    }

    async isInstalled(): Promise<boolean> {
        const health = await this.skill.healthCheck();
        return health.status !== 'unhealthy';
    }

    async launch(): Promise<void> {
        const action = this.skill.actions.find(a => a.name === 'launch');
        if (action) {
            const context = this.createContext();
            const result = await action.execute({ visible: true }, context);
            if (!result.success) throw new Error(result.error);
        }
    }

    async execute(command: string, args?: any): Promise<any> {
        const action = this.skill.actions.find(a => a.name === command);
        if (!action) {
            throw new Error(`Unknown command: ${command}`);
        }
        const context = this.createContext();
        return action.execute(args || {}, context);
    }

    async close(): Promise<void> {
        const action = this.skill.actions.find(a => a.name === 'close');
        if (action) {
            const context = this.createContext();
            await action.execute({}, context);
        }
    }

    private createContext(): ExecutionContext {
        return {
            sessionId: `legacy_${Date.now()}`,
            startTime: Date.now(),
            signal: new AbortController().signal,
            logger: {
                debug: console.debug,
                info: console.log,
                warn: console.warn,
                error: console.error
            },
            telemetry: {
                recordLatency: () => { },
                recordSuccess: () => { },
                recordFailure: () => { },
                recordMetric: () => { }
            }
        };
    }
}

export default photoshopSkill;
