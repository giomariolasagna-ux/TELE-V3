/**
 * Office Skill - Microsoft Office automation (Word, Excel, PowerPoint)
 * Refactored from LinkWordDriver to SkillCard format
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
// Helper Functions
// =============================================================================

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
    if ($obj) { 
        try { $obj.Quit() } catch {}
        "true" 
    } else { 
        "false" 
    }
    `;
    try {
        const result = await runPowerShell(script);
        return result.trim() === 'true';
    } catch {
        return false;
    }
}

// =============================================================================
// Configuration
// =============================================================================

type OfficeApp = 'word' | 'excel' | 'powerpoint';

const APP_CONFIG: Record<OfficeApp, { progId: string; name: string; exeName: string }> = {
    word: { progId: 'Word.Application', name: 'Microsoft Word', exeName: 'WINWORD.EXE' },
    excel: { progId: 'Excel.Application', name: 'Microsoft Excel', exeName: 'EXCEL.EXE' },
    powerpoint: { progId: 'PowerPoint.Application', name: 'Microsoft PowerPoint', exeName: 'POWERPNT.EXE' }
};

// =============================================================================
// Parameter Schemas
// =============================================================================

const LaunchParams = z.object({
    visible: z.boolean().optional().default(true)
});

const OpenFileParams = z.object({
    path: z.string().describe('Path to the document to open'),
    readOnly: z.boolean().optional().default(false)
});

const WriteTextParams = z.object({
    text: z.string().describe('Text to write at the current cursor position')
});

const NewDocumentParams = z.object({
    template: z.string().optional().describe('Optional template path')
});

const SaveParams = z.object({
    path: z.string().optional().describe('Save path (optional, uses current if not specified)'),
    format: z.string().optional().describe('File format')
});

const RunMacroParams = z.object({
    macroName: z.string().describe('Name of the VBA macro to run'),
    args: z.array(z.any()).optional().describe('Arguments to pass to the macro')
});

// =============================================================================
// Skill Factory
// =============================================================================

function createOfficeSkill(app: OfficeApp): SkillCard {
    const config = APP_CONFIG[app];

    return defineSkill()
        .id(`skill.office.${app}`)
        .name(config.name)
        .version('1.0.0')
        .description(`${config.name} automation via COM`)
        .author('TELE God Mode')
        .category('app')
        .tags('office', 'microsoft', app, 'documents', 'productivity')

        .action({
            name: 'launch',
            description: `Launch ${config.name}`,
            parameters: LaunchParams,
            estimatedDurationMs: 3000,
            execute: async (params, context) => {
                const startTime = Date.now();
                try {
                    context.logger.info(`Launching ${config.name}...`);

                    const script = `
                    $app = New-Object -ComObject ${config.progId}
                    $app.Visible = $${params.visible}
                    `;

                    await runPowerShell(script);

                    return {
                        success: true,
                        data: { launched: true },
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
            name: 'newDocument',
            description: 'Create a new document',
            parameters: NewDocumentParams,
            estimatedDurationMs: 1000,
            execute: async (params, context) => {
                const startTime = Date.now();
                try {
                    const docType = app === 'excel' ? 'Workbooks' : (app === 'powerpoint' ? 'Presentations' : 'Documents');

                    const script = `
                    $app = [Runtime.InteropServices.Marshal]::GetActiveObject('${config.progId}')
                    $app.${docType}.Add()
                    `;

                    await runPowerShell(script);

                    return {
                        success: true,
                        data: { created: true },
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
            description: 'Open a document',
            parameters: OpenFileParams,
            estimatedDurationMs: 2000,
            execute: async (params, context) => {
                const startTime = Date.now();
                try {
                    if (!fs.existsSync(params.path)) {
                        throw new Error(`File not found: ${params.path}`);
                    }

                    const docType = app === 'excel' ? 'Workbooks' : (app === 'powerpoint' ? 'Presentations' : 'Documents');
                    const readOnlyArg = params.readOnly ? ', $true' : '';

                    const script = `
                    $app = [Runtime.InteropServices.Marshal]::GetActiveObject('${config.progId}')
                    $app.${docType}.Open("${params.path.replace(/\\/g, '\\\\')}"${readOnlyArg})
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
            name: 'writeText',
            description: 'Write text at current cursor position (Word only)',
            parameters: WriteTextParams,
            estimatedDurationMs: 500,
            execute: async (params, context) => {
                const startTime = Date.now();
                try {
                    if (app !== 'word') {
                        throw new Error('writeText is only supported for Word');
                    }

                    const escapedText = params.text.replace(/'/g, "''").replace(/\n/g, '`n');

                    const script = `
                    $word = [Runtime.InteropServices.Marshal]::GetActiveObject('${config.progId}')
                    $doc = $word.ActiveDocument
                    $selection = $word.Selection
                    $selection.TypeText('${escapedText}')
                    `;

                    await runPowerShell(script);

                    return {
                        success: true,
                        data: { written: true, textLength: params.text.length },
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
            name: 'save',
            description: 'Save the active document',
            parameters: SaveParams,
            estimatedDurationMs: 1000,
            execute: async (params, context) => {
                const startTime = Date.now();
                try {
                    const activeDocProp = app === 'excel' ? 'ActiveWorkbook' :
                        (app === 'powerpoint' ? 'ActivePresentation' : 'ActiveDocument');

                    let script: string;
                    if (params.path) {
                        script = `
                        $app = [Runtime.InteropServices.Marshal]::GetActiveObject('${config.progId}')
                        $doc = $app.${activeDocProp}
                        $doc.SaveAs("${params.path.replace(/\\/g, '\\\\')}")
                        `;
                    } else {
                        script = `
                        $app = [Runtime.InteropServices.Marshal]::GetActiveObject('${config.progId}')
                        $doc = $app.${activeDocProp}
                        $doc.Save()
                        `;
                    }

                    await runPowerShell(script);

                    return {
                        success: true,
                        data: { saved: true, path: params.path },
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
            name: 'runMacro',
            description: 'Execute a VBA macro',
            parameters: RunMacroParams,
            estimatedDurationMs: 5000,
            requiresElevation: false,
            execute: async (params, context) => {
                const startTime = Date.now();
                try {
                    context.logger.info(`Running macro: ${params.macroName}`);

                    const argsStr = params.args ? params.args.map((a, i) => `$arg${i}`).join(', ') : '';
                    const argsDecl = params.args ? params.args.map((a, i) => `$arg${i} = "${a}"`).join('\n') : '';

                    const script = `
                    ${argsDecl}
                    $app = [Runtime.InteropServices.Marshal]::GetActiveObject('${config.progId}')
                    $app.Run("${params.macroName}"${argsStr ? ', ' + argsStr : ''})
                    `;

                    await runPowerShell(script);

                    return {
                        success: true,
                        data: { executed: true, macroName: params.macroName },
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
            description: `Close ${config.name}`,
            parameters: z.object({
                saveChanges: z.boolean().optional().default(false)
            }),
            estimatedDurationMs: 2000,
            execute: async (params, context) => {
                const startTime = Date.now();
                try {
                    const script = `
                    $app = [Runtime.InteropServices.Marshal]::GetActiveObject('${config.progId}')
                    $app.Quit()
                    `;

                    try {
                        await runPowerShell(script);
                    } catch {
                        // Fallback to taskkill
                        await execAsync(`taskkill /IM ${config.exeName} /F`);
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
                const available = await checkCOMAvailable(config.progId);

                if (available) {
                    return {
                        status: 'healthy',
                        message: `${config.name} COM automation available`,
                        lastCheck: Date.now()
                    };
                }

                return {
                    status: 'unhealthy',
                    message: `${config.name} not installed or COM not available`,
                    lastCheck: Date.now()
                };
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

export const wordSkill = createOfficeSkill('word');
export const excelSkill = createOfficeSkill('excel');
export const powerpointSkill = createOfficeSkill('powerpoint');

// =============================================================================
// Legacy Compatibility Adapter
// =============================================================================

export class OfficeSkillAdapter {
    private skill: SkillCard;
    name: string;
    appId: string;

    constructor(app: OfficeApp) {
        switch (app) {
            case 'word': this.skill = wordSkill; break;
            case 'excel': this.skill = excelSkill; break;
            case 'powerpoint': this.skill = powerpointSkill; break;
        }
        this.name = this.skill.name;
        this.appId = app;
    }

    async isInstalled(): Promise<boolean> {
        const health = await this.skill.healthCheck();
        return health.status === 'healthy';
    }

    async launch(): Promise<void> {
        const action = this.skill.actions.find(a => a.name === 'launch');
        if (action) {
            const result = await action.execute({ visible: true }, this.createContext());
            if (!result.success) throw new Error(result.error);
        }
    }

    async execute(command: string, args?: any): Promise<any> {
        // Map legacy commands to new action names
        const commandMap: Record<string, string> = {
            'write_text': 'writeText',
            'new_document': 'newDocument',
            'open_file': 'openFile',
            'run_macro': 'runMacro'
        };

        const actionName = commandMap[command] || command;
        const action = this.skill.actions.find(a => a.name === actionName);

        if (!action) {
            throw new Error(`Unknown command: ${command}`);
        }

        return action.execute(args || {}, this.createContext());
    }

    async close(): Promise<void> {
        const action = this.skill.actions.find(a => a.name === 'close');
        if (action) {
            await action.execute({ saveChanges: false }, this.createContext());
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

// Alias for backward compatibility with LinkWordDriver
export const LinkWordDriver = class extends OfficeSkillAdapter {
    constructor() { super('word'); }
};

export default wordSkill;
