/**
 * Explorer Skill - Windows File Explorer automation
 * Refactored from ExplorerDriver to SkillCard format
 * Part of God Mode System - Challenge 1
 */

import { z } from 'zod';
import { exec } from 'child_process';
import { promisify } from 'util';
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
// Parameter Schemas
// =============================================================================

const OpenPathParams = z.object({
    path: z.string().describe('Path to open in Explorer'),
    select: z.boolean().optional().describe('If true, selects the item instead of opening it')
});

const NavigateParams = z.object({
    path: z.string().describe('Path to navigate to')
});

const CreateFolderParams = z.object({
    path: z.string().describe('Full path of the folder to create')
});

const CopyItemParams = z.object({
    source: z.string().describe('Source path'),
    destination: z.string().describe('Destination path'),
    overwrite: z.boolean().optional().default(false)
});

const DeleteItemParams = z.object({
    path: z.string().describe('Path to delete'),
    permanent: z.boolean().optional().default(false).describe('If true, bypasses recycle bin')
});

// =============================================================================
// Action Implementations
// =============================================================================

async function openPath(
    params: z.infer<typeof OpenPathParams>,
    context: ExecutionContext
): Promise<{ opened: boolean; path: string }> {
    context.logger.info(`Opening path: ${params.path}`);

    if (context.signal.aborted) {
        throw new Error('Operation aborted');
    }

    const command = params.select
        ? `explorer.exe /select,"${params.path}"`
        : `start explorer "${params.path}"`;

    await execAsync(command);

    return { opened: true, path: params.path };
}

async function navigate(
    params: z.infer<typeof NavigateParams>,
    context: ExecutionContext
): Promise<{ navigated: boolean }> {
    context.logger.info(`Navigating to: ${params.path}`);

    // Open a new Explorer window at the specified path
    await execAsync(`start explorer "${params.path}"`);

    return { navigated: true };
}

async function createFolder(
    params: z.infer<typeof CreateFolderParams>,
    context: ExecutionContext
): Promise<{ created: boolean; path: string }> {
    context.logger.info(`Creating folder: ${params.path}`);

    await execAsync(`powershell -NoProfile -Command "New-Item -ItemType Directory -Path '${params.path}' -Force"`);

    return { created: true, path: params.path };
}

async function copyItem(
    params: z.infer<typeof CopyItemParams>,
    context: ExecutionContext
): Promise<{ copied: boolean; source: string; destination: string }> {
    context.logger.info(`Copying: ${params.source} -> ${params.destination}`);

    const forceFlag = params.overwrite ? '-Force' : '';
    await execAsync(
        `powershell -NoProfile -Command "Copy-Item -Path '${params.source}' -Destination '${params.destination}' -Recurse ${forceFlag}"`
    );

    return { copied: true, source: params.source, destination: params.destination };
}

async function deleteItem(
    params: z.infer<typeof DeleteItemParams>,
    context: ExecutionContext
): Promise<{ deleted: boolean; path: string; wasRecycled: boolean }> {
    context.logger.info(`Deleting: ${params.path} (permanent: ${params.permanent})`);

    if (params.permanent) {
        await execAsync(
            `powershell -NoProfile -Command "Remove-Item -Path '${params.path}' -Recurse -Force"`
        );
        return { deleted: true, path: params.path, wasRecycled: false };
    } else {
        // Move to recycle bin using Shell.Application
        await execAsync(
            `powershell -NoProfile -Command "$shell = New-Object -ComObject Shell.Application; $item = $shell.Namespace(0).ParseName('${params.path}'); $item.InvokeVerb('delete')"`
        );
        return { deleted: true, path: params.path, wasRecycled: true };
    }
}

// =============================================================================
// Rollback Implementations
// =============================================================================

async function rollbackDelete(
    rollbackData: { path: string; wasRecycled: boolean },
    context: { logger: { info: (msg: string) => void } }
): Promise<ActionResult> {
    if (rollbackData.wasRecycled) {
        context.logger.info(`Rollback: Cannot automatically restore from recycle bin. Path: ${rollbackData.path}`);
        return {
            success: false,
            error: 'Manual restoration from recycle bin required',
            durationMs: 0
        };
    }
    return {
        success: false,
        error: 'Permanent deletion cannot be rolled back',
        durationMs: 0
    };
}

// =============================================================================
// Health Check
// =============================================================================

async function healthCheck(): Promise<HealthStatus> {
    try {
        // Check if explorer.exe is accessible
        await execAsync('where explorer.exe');
        return {
            status: 'healthy',
            message: 'Windows Explorer is available',
            lastCheck: Date.now()
        };
    } catch (error: any) {
        return {
            status: 'unhealthy',
            message: error.message,
            lastCheck: Date.now()
        };
    }
}

// =============================================================================
// Skill Definition
// =============================================================================

export const explorerSkill: SkillCard = defineSkill()
    .id('skill.windows.explorer')
    .name('Windows Explorer')
    .version('1.0.0')
    .description('Windows File Explorer automation - open folders, navigate, manage files')
    .author('TELE God Mode')
    .category('app')
    .tags('files', 'explorer', 'windows', 'filesystem', 'navigation')

    .action({
        name: 'open',
        description: 'Open a path in Windows Explorer',
        parameters: OpenPathParams,
        estimatedDurationMs: 500,
        requiresElevation: false,
        execute: async (params, context) => {
            const startTime = Date.now();
            try {
                const result = await openPath(params, context);
                return {
                    success: true,
                    data: result,
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
        name: 'navigate',
        description: 'Open a new Explorer window at the specified path',
        parameters: NavigateParams,
        estimatedDurationMs: 500,
        execute: async (params, context) => {
            const startTime = Date.now();
            try {
                const result = await navigate(params, context);
                return {
                    success: true,
                    data: result,
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
        name: 'createFolder',
        description: 'Create a new folder at the specified path',
        parameters: CreateFolderParams,
        estimatedDurationMs: 200,
        canRollback: true,
        execute: async (params, context) => {
            const startTime = Date.now();
            try {
                const result = await createFolder(params, context);
                return {
                    success: true,
                    data: result,
                    durationMs: Date.now() - startTime,
                    rollbackData: { path: params.path }
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
                await execAsync(`powershell -NoProfile -Command "Remove-Item -Path '${data.path}' -Force"`);
                return { success: true, durationMs: Date.now() - startTime };
            } catch (error: any) {
                return { success: false, error: error.message, durationMs: Date.now() - startTime };
            }
        }
    })

    .action({
        name: 'copy',
        description: 'Copy a file or folder to a new location',
        parameters: CopyItemParams,
        estimatedDurationMs: 1000,
        canRollback: true,
        execute: async (params, context) => {
            const startTime = Date.now();
            try {
                const result = await copyItem({
                    ...params,
                    overwrite: params.overwrite ?? false
                }, context);
                return {
                    success: true,
                    data: result,
                    durationMs: Date.now() - startTime,
                    rollbackData: { destination: params.destination }
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
                await execAsync(`powershell -NoProfile -Command "Remove-Item -Path '${data.destination}' -Recurse -Force"`);
                return { success: true, durationMs: Date.now() - startTime };
            } catch (error: any) {
                return { success: false, error: error.message, durationMs: Date.now() - startTime };
            }
        }
    })

    .action({
        name: 'delete',
        description: 'Delete a file or folder (to recycle bin by default)',
        parameters: DeleteItemParams,
        estimatedDurationMs: 500,
        canRollback: true,
        execute: async (params, context) => {
            const startTime = Date.now();
            try {
                const result = await deleteItem({
                    ...params,
                    permanent: params.permanent ?? false
                }, context);
                return {
                    success: true,
                    data: result,
                    durationMs: Date.now() - startTime,
                    rollbackData: { path: params.path, wasRecycled: result.wasRecycled }
                };
            } catch (error: any) {
                return {
                    success: false,
                    error: error.message,
                    durationMs: Date.now() - startTime
                };
            }
        },
        rollback: rollbackDelete
    })

    .healthCheck(healthCheck)
    .build();

// =============================================================================
// Legacy Compatibility - Adapter for old AppDriver interface
// =============================================================================

export class ExplorerSkillAdapter {
    name = explorerSkill.name;
    appId = 'explorer';

    async isInstalled(): Promise<boolean> {
        const health = await explorerSkill.healthCheck();
        return health.status === 'healthy';
    }

    async launch(): Promise<void> {
        const action = explorerSkill.actions.find(a => a.name === 'open');
        if (action) {
            const context = {
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
            await action.execute({ path: '' }, context);
        }
    }

    async execute(command: string, args?: any): Promise<any> {
        // Map legacy commands to new actions
        const action = explorerSkill.actions.find(a => a.name === command);
        if (!action) {
            throw new Error(`Unknown command: ${command}`);
        }

        const context = {
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

        return action.execute(args, context);
    }

    async close(): Promise<void> {
        // Explorer doesn't need explicit closing
    }
}

export default explorerSkill;
