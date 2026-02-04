/**
 * Blender Skill - 3D modeling/rendering automation
 * Refactored from BlenderDriver to SkillCard format
 * Part of God Mode System - Challenge 1
 */

import { z } from 'zod';
import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
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
// Configuration
// =============================================================================

const BLENDER_PATHS = [
    'C:\\Program Files\\Blender Foundation\\Blender 4.4\\blender.exe',
    'C:\\Program Files\\Blender Foundation\\Blender 4.0\\blender.exe',
    'C:\\Program Files\\Blender Foundation\\Blender 3.6\\blender.exe',
    'C:\\Program Files\\Blender Foundation\\Blender 3.5\\blender.exe',
];

function findBlenderPath(): string | null {
    for (const p of BLENDER_PATHS) {
        if (fs.existsSync(p)) return p;
    }
    return null;
}

// =============================================================================
// Parameter Schemas
// =============================================================================

const LaunchParams = z.object({
    file: z.string().optional().describe('Optional .blend file to open')
});

const RenderFrameParams = z.object({
    file: z.string().describe('Path to .blend file'),
    output: z.string().describe('Output path for rendered image'),
    frame: z.number().int().positive().default(1).describe('Frame number to render')
});

const RenderAnimationParams = z.object({
    file: z.string().describe('Path to .blend file'),
    output: z.string().describe('Output directory for animation'),
    startFrame: z.number().int().positive().optional(),
    endFrame: z.number().int().positive().optional(),
    format: z.enum(['PNG', 'JPEG', 'FFMPEG']).optional().default('PNG')
});

const RunPythonParams = z.object({
    script: z.string().describe('Python code to execute in Blender'),
    file: z.string().optional().describe('Optional .blend file to load first')
});

const ExportParams = z.object({
    file: z.string().describe('Input .blend file'),
    output: z.string().describe('Output file path'),
    format: z.enum(['fbx', 'obj', 'gltf', 'stl']).describe('Export format')
});

// =============================================================================
// Skill Definition
// =============================================================================

export const blenderSkill: SkillCard = defineSkill()
    .id('skill.blender')
    .name('Blender')
    .version('1.0.0')
    .description('Blender 3D automation - rendering, scripting, and batch operations')
    .author('TELE God Mode')
    .category('media')
    .tags('blender', '3d', 'rendering', 'modeling', 'animation', 'creative')

    .action({
        name: 'launch',
        description: 'Launch Blender, optionally with a file',
        parameters: LaunchParams,
        estimatedDurationMs: 3000,
        execute: async (params, context) => {
            const startTime = Date.now();
            try {
                const blenderPath = findBlenderPath();
                if (!blenderPath) {
                    throw new Error('Blender not found');
                }

                context.logger.info(`Launching Blender from ${blenderPath}`);

                const args = params.file ? [params.file] : [];
                spawn(blenderPath, args, { detached: true, stdio: 'ignore' }).unref();

                return {
                    success: true,
                    data: { launched: true, path: blenderPath },
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
        name: 'renderFrame',
        description: 'Render a single frame from a .blend file',
        parameters: RenderFrameParams,
        estimatedDurationMs: 60000, // Rendering can take a while
        execute: async (params, context) => {
            const startTime = Date.now();
            try {
                const blenderPath = findBlenderPath();
                if (!blenderPath) throw new Error('Blender not found');

                if (!fs.existsSync(params.file)) {
                    throw new Error(`File not found: ${params.file}`);
                }

                context.logger.info(`Rendering frame ${params.frame} from ${params.file}`);

                const args = [
                    '-b', params.file,
                    '-o', params.output,
                    '-f', String(params.frame)
                ];

                const { stdout, stderr } = await execAsync(`"${blenderPath}" ${args.join(' ')}`);

                return {
                    success: true,
                    data: {
                        rendered: true,
                        frame: params.frame,
                        output: params.output,
                        log: stdout.substring(0, 500)
                    },
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
        name: 'renderAnimation',
        description: 'Render an animation sequence',
        parameters: RenderAnimationParams,
        estimatedDurationMs: 300000, // Animations take longer
        execute: async (params, context) => {
            const startTime = Date.now();
            try {
                const blenderPath = findBlenderPath();
                if (!blenderPath) throw new Error('Blender not found');

                context.logger.info(`Rendering animation from ${params.file}`);

                const args = [
                    '-b', params.file,
                    '-o', params.output,
                    '-F', params.format || 'PNG',
                    '-a'
                ];

                if (params.startFrame) args.push('-s', String(params.startFrame));
                if (params.endFrame) args.push('-e', String(params.endFrame));

                const { stdout } = await execAsync(`"${blenderPath}" ${args.join(' ')}`);

                return {
                    success: true,
                    data: {
                        rendered: true,
                        output: params.output,
                        log: stdout.substring(0, 500)
                    },
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
        name: 'runPython',
        description: 'Execute Python script in Blender',
        parameters: RunPythonParams,
        estimatedDurationMs: 10000,
        execute: async (params, context) => {
            const startTime = Date.now();
            try {
                const blenderPath = findBlenderPath();
                if (!blenderPath) throw new Error('Blender not found');

                // Write script to temp file
                const tmpDir = './.tele';
                if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

                const tmpFile = path.join(tmpDir, `blender_script_${Date.now()}.py`);
                fs.writeFileSync(tmpFile, params.script);

                context.logger.info(`Running Python script in Blender...`);

                const args = params.file
                    ? ['-b', params.file, '--python', tmpFile]
                    : ['-b', '--python', tmpFile];

                try {
                    const { stdout, stderr } = await execAsync(`"${blenderPath}" ${args.join(' ')}`);

                    return {
                        success: true,
                        data: {
                            executed: true,
                            stdout: stdout.substring(0, 1000),
                            stderr: stderr?.substring(0, 500)
                        },
                        durationMs: Date.now() - startTime
                    };
                } finally {
                    // Cleanup temp file
                    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
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
        name: 'export',
        description: 'Export .blend file to another format',
        parameters: ExportParams,
        estimatedDurationMs: 30000,
        canRollback: true,
        execute: async (params, context) => {
            const startTime = Date.now();
            try {
                const blenderPath = findBlenderPath();
                if (!blenderPath) throw new Error('Blender not found');

                // Build export script based on format
                let exportScript: string;
                switch (params.format) {
                    case 'fbx':
                        exportScript = `import bpy; bpy.ops.export_scene.fbx(filepath="${params.output.replace(/\\/g, '/')}")`;
                        break;
                    case 'obj':
                        exportScript = `import bpy; bpy.ops.wm.obj_export(filepath="${params.output.replace(/\\/g, '/')}")`;
                        break;
                    case 'gltf':
                        exportScript = `import bpy; bpy.ops.export_scene.gltf(filepath="${params.output.replace(/\\/g, '/')}")`;
                        break;
                    case 'stl':
                        exportScript = `import bpy; bpy.ops.export_mesh.stl(filepath="${params.output.replace(/\\/g, '/')}")`;
                        break;
                    default:
                        throw new Error(`Unsupported format: ${params.format}`);
                }

                context.logger.info(`Exporting ${params.file} to ${params.format}...`);

                const args = [
                    '-b', params.file,
                    '--python-expr', `"${exportScript}"`
                ];

                await execAsync(`"${blenderPath}" ${args.join(' ')}`);

                return {
                    success: true,
                    data: {
                        exported: true,
                        output: params.output,
                        format: params.format
                    },
                    durationMs: Date.now() - startTime,
                    rollbackData: { output: params.output }
                };
            } catch (error: any) {
                return {
                    success: false,
                    error: error.message,
                    durationMs: Date.now() - startTime
                };
            }
        },
        rollback: async (data, context) => {
            const startTime = Date.now();
            try {
                if (fs.existsSync(data.output)) {
                    fs.unlinkSync(data.output);
                }
                return { success: true, durationMs: Date.now() - startTime };
            } catch (error: any) {
                return { success: false, error: error.message, durationMs: Date.now() - startTime };
            }
        }
    })

    .action({
        name: 'close',
        description: 'Close Blender',
        parameters: z.object({}),
        estimatedDurationMs: 1000,
        execute: async (params, context) => {
            const startTime = Date.now();
            try {
                await execAsync('taskkill /IM blender.exe /F');
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
        const blenderPath = findBlenderPath();

        if (blenderPath) {
            return {
                status: 'healthy',
                message: `Blender found at ${blenderPath}`,
                lastCheck: Date.now(),
                details: { path: blenderPath }
            };
        }

        return {
            status: 'unhealthy',
            message: 'Blender not found in standard locations',
            lastCheck: Date.now()
        };
    })

    .build();

// =============================================================================
// Legacy Adapter
// =============================================================================

export class BlenderSkillAdapter {
    name = blenderSkill.name;
    appId = 'blender';

    async isInstalled(): Promise<boolean> {
        const health = await blenderSkill.healthCheck();
        return health.status === 'healthy';
    }

    async launch(): Promise<void> {
        const action = blenderSkill.actions.find(a => a.name === 'launch');
        if (action) {
            const context = this.createContext();
            const result = await action.execute({}, context);
            if (!result.success) throw new Error(result.error);
        }
    }

    async execute(command: string, args?: any): Promise<any> {
        const action = blenderSkill.actions.find(a => a.name === command);
        if (!action) {
            throw new Error(`Unknown command: ${command}`);
        }
        const context = this.createContext();
        return action.execute(args || {}, context);
    }

    async close(): Promise<void> {
        const action = blenderSkill.actions.find(a => a.name === 'close');
        if (action) {
            await action.execute({}, this.createContext());
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

export default blenderSkill;
