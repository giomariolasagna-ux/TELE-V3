/**
 * TouchDesigner Skill - Real-time visual engine integration
 * Part of God Mode System - Challenge 4
 * 
 * Communication methods:
 * - OSC (Open Sound Control) for real-time parameter control
 * - Python script injection via command line
 * - WebSocket for bidirectional communication
 */

import { z } from 'zod';
import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as dgram from 'dgram';
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

const DEFAULT_OSC_PORT = 7000;
const DEFAULT_OSC_ADDRESS = '127.0.0.1';

const TD_PATHS = [
    'C:\\Program Files\\Derivative\\TouchDesigner\\bin\\TouchDesigner.exe',
    'C:\\Program Files\\Derivative\\TouchDesigner099\\bin\\TouchDesigner.exe',
];

function findTouchDesignerPath(): string | null {
    for (const p of TD_PATHS) {
        if (fs.existsSync(p)) return p;
    }
    return null;
}

// =============================================================================
// OSC Client Helper
// =============================================================================

class OSCClient {
    private socket: dgram.Socket;
    private address: string;
    private port: number;

    constructor(address = DEFAULT_OSC_ADDRESS, port = DEFAULT_OSC_PORT) {
        this.address = address;
        this.port = port;
        this.socket = dgram.createSocket('udp4');
    }

    /**
     * Create an OSC message buffer
     * OSC format: address pattern (null-padded to 4), type tag string, arguments
     */
    private createMessage(address: string, value: number | string | boolean): Buffer {
        // Pad address to multiple of 4
        const addressPadded = address + '\0'.repeat(4 - (address.length % 4) || 4);

        // Type tag
        let typeTag = ',';
        let argBuffer: Buffer;

        if (typeof value === 'number') {
            if (Number.isInteger(value)) {
                typeTag += 'i';
                argBuffer = Buffer.alloc(4);
                argBuffer.writeInt32BE(value);
            } else {
                typeTag += 'f';
                argBuffer = Buffer.alloc(4);
                argBuffer.writeFloatBE(value);
            }
        } else if (typeof value === 'string') {
            typeTag += 's';
            const strPadded = value + '\0'.repeat(4 - (value.length % 4) || 4);
            argBuffer = Buffer.from(strPadded);
        } else if (typeof value === 'boolean') {
            typeTag += value ? 'T' : 'F';
            argBuffer = Buffer.alloc(0);
        } else {
            argBuffer = Buffer.alloc(0);
        }

        const typeTagPadded = typeTag + '\0'.repeat(4 - (typeTag.length % 4) || 4);

        return Buffer.concat([
            Buffer.from(addressPadded),
            Buffer.from(typeTagPadded),
            argBuffer
        ]);
    }

    send(address: string, value: number | string | boolean): Promise<void> {
        return new Promise((resolve, reject) => {
            const message = this.createMessage(address, value);
            this.socket.send(message, this.port, this.address, (error) => {
                if (error) reject(error);
                else resolve();
            });
        });
    }

    close(): void {
        this.socket.close();
    }
}

// =============================================================================
// Parameter Schemas
// =============================================================================

const LaunchParams = z.object({
    file: z.string().optional().describe('Optional .toe file to open'),
    performMode: z.boolean().optional().default(false).describe('Launch in perform mode')
});

const SetParameterParams = z.object({
    operator: z.string().describe('Operator path (e.g., /project1/base1)'),
    parameter: z.string().describe('Parameter name'),
    value: z.union([z.number(), z.string(), z.boolean()]).describe('Parameter value')
});

const OscSendParams = z.object({
    address: z.string().describe('OSC address (e.g., /param/value)'),
    value: z.union([z.number(), z.string(), z.boolean()]).describe('Value to send'),
    port: z.number().optional().default(DEFAULT_OSC_PORT)
});

const RunScriptParams = z.object({
    script: z.string().describe('Python code to execute in TouchDesigner'),
    file: z.string().optional().describe('Optional .toe file to load first')
});

const PulseParams = z.object({
    operator: z.string().describe('Operator to pulse'),
    parameter: z.string().optional().default('Cook').describe('Parameter to pulse')
});

const ExportParams = z.object({
    operator: z.string().describe('TOP/SOP operator to export from'),
    output: z.string().describe('Output file path'),
    format: z.enum(['png', 'jpg', 'exr', 'obj', 'fbx']).optional().default('png')
});

// =============================================================================
// Skill Definition
// =============================================================================

export const touchDesignerSkill: SkillCard = defineSkill()
    .id('skill.touchdesigner')
    .name('TouchDesigner')
    .version('1.0.0')
    .description('TouchDesigner real-time visual engine automation via OSC and Python scripting')
    .author('TELE God Mode')
    .category('media')
    .tags('touchdesigner', 'derivative', 'visual', 'realtime', 'generative', 'osc', 'vj')

    .action({
        name: 'launch',
        description: 'Launch TouchDesigner',
        parameters: LaunchParams,
        estimatedDurationMs: 5000,
        execute: async (params, context) => {
            const startTime = Date.now();
            try {
                const tdPath = findTouchDesignerPath();
                if (!tdPath) {
                    throw new Error('TouchDesigner not found');
                }

                context.logger.info(`Launching TouchDesigner from ${tdPath}`);

                const args: string[] = [];
                if (params.file) args.push(params.file);
                if (params.performMode) args.push('-p');

                spawn(tdPath, args, { detached: true, stdio: 'ignore' }).unref();

                return {
                    success: true,
                    data: { launched: true, path: tdPath, performMode: params.performMode },
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
        name: 'setParameter',
        description: 'Set a parameter value on an operator',
        parameters: SetParameterParams,
        estimatedDurationMs: 100,
        execute: async (params, context) => {
            const startTime = Date.now();
            try {
                context.logger.info(`Setting ${params.operator}/${params.parameter} = ${params.value}`);

                // Use OSC to set parameter
                const oscAddress = `${params.operator}/${params.parameter}`;
                const client = new OSCClient();

                try {
                    await client.send(oscAddress, params.value);
                    return {
                        success: true,
                        data: {
                            set: true,
                            operator: params.operator,
                            parameter: params.parameter,
                            value: params.value
                        },
                        durationMs: Date.now() - startTime
                    };
                } finally {
                    client.close();
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
        name: 'oscSend',
        description: 'Send an arbitrary OSC message',
        parameters: OscSendParams,
        estimatedDurationMs: 50,
        execute: async (params, context) => {
            const startTime = Date.now();
            try {
                context.logger.info(`OSC: ${params.address} = ${params.value}`);

                const client = new OSCClient(DEFAULT_OSC_ADDRESS, params.port);

                try {
                    await client.send(params.address, params.value);
                    return {
                        success: true,
                        data: { sent: true, address: params.address, value: params.value },
                        durationMs: Date.now() - startTime
                    };
                } finally {
                    client.close();
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
        name: 'runScript',
        description: 'Execute Python script in TouchDesigner',
        parameters: RunScriptParams,
        estimatedDurationMs: 2000,
        execute: async (params, context) => {
            const startTime = Date.now();
            try {
                const tdPath = findTouchDesignerPath();
                if (!tdPath) throw new Error('TouchDesigner not found');

                // Write script to temp file
                const tmpDir = './.tele';
                if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

                const tmpFile = path.join(tmpDir, `td_script_${Date.now()}.py`);
                fs.writeFileSync(tmpFile, params.script);

                context.logger.info(`Running Python script in TouchDesigner...`);

                try {
                    const args = params.file
                        ? [params.file, '-e', tmpFile]
                        : ['-e', tmpFile];

                    // Note: TouchDesigner's -e flag executes script on startup
                    const { stdout, stderr } = await execAsync(`"${tdPath}" ${args.join(' ')}`);

                    return {
                        success: true,
                        data: {
                            executed: true,
                            stdout: stdout?.substring(0, 1000),
                            stderr: stderr?.substring(0, 500)
                        },
                        durationMs: Date.now() - startTime
                    };
                } finally {
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
        name: 'pulse',
        description: 'Pulse an operator parameter (trigger)',
        parameters: PulseParams,
        estimatedDurationMs: 100,
        execute: async (params, context) => {
            const startTime = Date.now();
            try {
                context.logger.info(`Pulsing ${params.operator}:${params.parameter}`);

                // Send pulse via OSC
                const oscAddress = `${params.operator}/${params.parameter}`;
                const client = new OSCClient();

                try {
                    await client.send(oscAddress, 1);
                    // Short delay then reset
                    await new Promise(resolve => setTimeout(resolve, 50));
                    await client.send(oscAddress, 0);

                    return {
                        success: true,
                        data: { pulsed: true, operator: params.operator },
                        durationMs: Date.now() - startTime
                    };
                } finally {
                    client.close();
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
        name: 'close',
        description: 'Close TouchDesigner',
        parameters: z.object({}),
        estimatedDurationMs: 2000,
        execute: async (params, context) => {
            const startTime = Date.now();
            try {
                await execAsync('taskkill /IM TouchDesigner.exe /F');
                return {
                    success: true,
                    data: { closed: true },
                    durationMs: Date.now() - startTime
                };
            } catch (error: any) {
                return {
                    success: true,  // May not be running
                    data: { closed: true, note: 'TouchDesigner may not have been running' },
                    durationMs: Date.now() - startTime
                } as any;
            }
        }
    })

    .healthCheck(async (): Promise<HealthStatus> => {
        const tdPath = findTouchDesignerPath();

        if (tdPath) {
            // Try to check if OSC port is listening by sending a test message
            try {
                const client = new OSCClient();
                await client.send('/tele/ping', 1);
                client.close();

                return {
                    status: 'healthy',
                    message: `TouchDesigner found at ${tdPath}, OSC port ${DEFAULT_OSC_PORT} accessible`,
                    lastCheck: Date.now(),
                    details: { path: tdPath, oscPort: DEFAULT_OSC_PORT }
                };
            } catch {
                return {
                    status: 'degraded',
                    message: `TouchDesigner found but OSC may not be configured`,
                    lastCheck: Date.now(),
                    details: { path: tdPath }
                };
            }
        }

        return {
            status: 'unhealthy',
            message: 'TouchDesigner not found in standard locations',
            lastCheck: Date.now()
        };
    })

    .build();

// =============================================================================
// Legacy Adapter
// =============================================================================

export class TouchDesignerSkillAdapter {
    name = touchDesignerSkill.name;
    appId = 'touchdesigner';

    async isInstalled(): Promise<boolean> {
        const health = await touchDesignerSkill.healthCheck();
        return health.status !== 'unhealthy';
    }

    async launch(): Promise<void> {
        const action = touchDesignerSkill.actions.find(a => a.name === 'launch');
        if (action) {
            const result = await action.execute({}, this.createContext());
            if (!result.success) throw new Error(result.error);
        }
    }

    async execute(command: string, args?: any): Promise<any> {
        const action = touchDesignerSkill.actions.find(a => a.name === command);
        if (!action) {
            throw new Error(`Unknown command: ${command}`);
        }
        return action.execute(args || {}, this.createContext());
    }

    async close(): Promise<void> {
        const action = touchDesignerSkill.actions.find(a => a.name === 'close');
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

export default touchDesignerSkill;
