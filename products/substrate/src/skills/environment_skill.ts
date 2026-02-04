/**
 * Environment Awareness Skill - System introspection
 * Part of God Mode System - Challenge 10
 * 
 * Features:
 * - OS detection (Windows/macOS/Linux)
 * - User paths (home, temp, downloads, app data)
 * - Permission checking (write access, admin status)
 * - Software version detection
 * - System resources (disk, memory, CPU)
 * - Session Kernel integration
 */

import { z } from 'zod';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import {
    SkillCard,
    ExecutionContext,
    ActionResult,
    HealthStatus,
    defineSkill
} from './skill_card';

const execAsync = promisify(exec);

// =============================================================================
// Types
// =============================================================================

export interface EnvironmentInfo {
    os: {
        type: 'windows' | 'macos' | 'linux';
        platform: string;
        release: string;
        arch: string;
        hostname: string;
    };
    paths: {
        home: string;
        temp: string;
        downloads: string;
        documents: string;
        desktop: string;
        appData: string;
        programFiles: string | null;
    };
    user: {
        name: string;
        isAdmin: boolean;
        shell: string | null;
    };
    resources: {
        cpuCores: number;
        cpuModel: string;
        totalMemoryMB: number;
        freeMemoryMB: number;
        memoryUsagePercent: number;
        uptime: number;
    };
}

export interface DiskInfo {
    drive: string;
    totalGB: number;
    freeGB: number;
    usedGB: number;
    usagePercent: number;
}

export interface SoftwareInfo {
    name: string;
    version: string | null;
    path: string | null;
}

export interface PermissionCheck {
    path: string;
    readable: boolean;
    writable: boolean;
    executable: boolean;
}

// =============================================================================
// Helper Functions
// =============================================================================

function getOSType(): 'windows' | 'macos' | 'linux' {
    const platform = os.platform();
    if (platform === 'win32') return 'windows';
    if (platform === 'darwin') return 'macos';
    return 'linux';
}

function getDownloadsPath(): string {
    const home = os.homedir();
    return path.join(home, 'Downloads');
}

function getDocumentsPath(): string {
    const home = os.homedir();
    return path.join(home, 'Documents');
}

function getDesktopPath(): string {
    const home = os.homedir();
    return path.join(home, 'Desktop');
}

function getAppDataPath(): string {
    const osType = getOSType();
    if (osType === 'windows') {
        return process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    } else if (osType === 'macos') {
        return path.join(os.homedir(), 'Library', 'Application Support');
    }
    return path.join(os.homedir(), '.config');
}

async function checkIsAdmin(): Promise<boolean> {
    const osType = getOSType();

    if (osType === 'windows') {
        try {
            await execAsync('net session', { windowsHide: true });
            return true;
        } catch {
            return false;
        }
    } else {
        return process.getuid?.() === 0 || false;
    }
}

async function getDiskInfo(): Promise<DiskInfo[]> {
    const osType = getOSType();
    const disks: DiskInfo[] = [];

    if (osType === 'windows') {
        try {
            const { stdout } = await execAsync(
                'wmic logicaldisk get size,freespace,caption',
                { windowsHide: true }
            );

            const lines = stdout.trim().split('\n').slice(1);
            for (const line of lines) {
                const parts = line.trim().split(/\s+/);
                if (parts.length >= 3) {
                    const drive = parts[0];
                    const freeSpace = parseInt(parts[1]) || 0;
                    const totalSize = parseInt(parts[2]) || 0;

                    if (totalSize > 0) {
                        const freeGB = freeSpace / (1024 ** 3);
                        const totalGB = totalSize / (1024 ** 3);
                        disks.push({
                            drive,
                            totalGB: Math.round(totalGB * 10) / 10,
                            freeGB: Math.round(freeGB * 10) / 10,
                            usedGB: Math.round((totalGB - freeGB) * 10) / 10,
                            usagePercent: Math.round(((totalGB - freeGB) / totalGB) * 100)
                        });
                    }
                }
            }
        } catch (e) {
            // Fallback for C: drive
            try {
                const stats = fs.statfsSync('C:\\');
                const totalGB = (stats.bsize * stats.blocks) / (1024 ** 3);
                const freeGB = (stats.bsize * stats.bfree) / (1024 ** 3);
                disks.push({
                    drive: 'C:',
                    totalGB: Math.round(totalGB * 10) / 10,
                    freeGB: Math.round(freeGB * 10) / 10,
                    usedGB: Math.round((totalGB - freeGB) * 10) / 10,
                    usagePercent: Math.round(((totalGB - freeGB) / totalGB) * 100)
                });
            } catch { }
        }
    } else {
        try {
            const { stdout } = await execAsync('df -h /');
            const lines = stdout.trim().split('\n').slice(1);
            if (lines[0]) {
                const parts = lines[0].split(/\s+/);
                disks.push({
                    drive: '/',
                    totalGB: parseFloat(parts[1]) || 0,
                    freeGB: parseFloat(parts[3]) || 0,
                    usedGB: parseFloat(parts[2]) || 0,
                    usagePercent: parseInt(parts[4]) || 0
                });
            }
        } catch { }
    }

    return disks;
}

async function detectSoftware(name: string): Promise<SoftwareInfo> {
    const osType = getOSType();
    const commands: Record<string, string> = {
        node: 'node --version',
        npm: 'npm --version',
        python: osType === 'windows' ? 'python --version' : 'python3 --version',
        git: 'git --version',
        docker: 'docker --version',
        code: 'code --version',
    };

    const cmd = commands[name.toLowerCase()];
    if (!cmd) {
        return { name, version: null, path: null };
    }

    try {
        const { stdout } = await execAsync(cmd, { windowsHide: true });
        const version = stdout.trim().replace(/^[a-zA-Z\s]+/, '').split('\n')[0];

        // Try to find path
        let softwarePath: string | null = null;
        try {
            const whereCmd = osType === 'windows' ? `where ${name}` : `which ${name}`;
            const { stdout: pathOutput } = await execAsync(whereCmd, { windowsHide: true });
            softwarePath = pathOutput.trim().split('\n')[0];
        } catch { }

        return { name, version, path: softwarePath };
    } catch {
        return { name, version: null, path: null };
    }
}

function checkPermissions(targetPath: string): PermissionCheck {
    const result: PermissionCheck = {
        path: targetPath,
        readable: false,
        writable: false,
        executable: false
    };

    try {
        fs.accessSync(targetPath, fs.constants.R_OK);
        result.readable = true;
    } catch { }

    try {
        fs.accessSync(targetPath, fs.constants.W_OK);
        result.writable = true;
    } catch { }

    try {
        fs.accessSync(targetPath, fs.constants.X_OK);
        result.executable = true;
    } catch { }

    return result;
}

// =============================================================================
// Parameter Schemas
// =============================================================================

const DetectParams = z.object({
    includeResources: z.boolean().optional().default(true),
    includeSoftware: z.array(z.string()).optional().default(['node', 'npm', 'python', 'git'])
});

const DiskParams = z.object({
    drives: z.array(z.string()).optional().describe('Specific drives to check')
});

const SoftwareParams = z.object({
    names: z.array(z.string()).describe('Software names to detect')
});

const PermissionParams = z.object({
    paths: z.array(z.string()).describe('Paths to check permissions for')
});

// =============================================================================
// Session Kernel Integration
// =============================================================================

let cachedEnvironment: EnvironmentInfo | null = null;

export function getEnvironmentCache(): EnvironmentInfo | null {
    return cachedEnvironment;
}

export function updateSessionKernel(env: EnvironmentInfo): void {
    cachedEnvironment = env;
    console.log(`[Environment] Session Kernel updated: ${env.os.type} ${env.os.arch}`);
}

// =============================================================================
// Skill Definition
// =============================================================================

export const environmentSkill: SkillCard = defineSkill()
    .id('skill.system.environment')
    .name('Environment Awareness')
    .version('1.0.0')
    .description('System introspection - detects OS, paths, permissions, software, resources')
    .author('TELE God Mode')
    .category('system')
    .tags('environment', 'os', 'system', 'detection', 'introspection', 'permissions')

    .action({
        name: 'detect',
        description: 'Full environment detection - OS, paths, user, resources',
        parameters: DetectParams,
        estimatedDurationMs: 3000,
        execute: async (params, context) => {
            const startTime = Date.now();
            try {
                context.logger.info('Detecting environment...');

                const isAdmin = await checkIsAdmin();
                const cpus = os.cpus();

                const env: EnvironmentInfo = {
                    os: {
                        type: getOSType(),
                        platform: os.platform(),
                        release: os.release(),
                        arch: os.arch(),
                        hostname: os.hostname()
                    },
                    paths: {
                        home: os.homedir(),
                        temp: os.tmpdir(),
                        downloads: getDownloadsPath(),
                        documents: getDocumentsPath(),
                        desktop: getDesktopPath(),
                        appData: getAppDataPath(),
                        programFiles: process.env['ProgramFiles'] || null
                    },
                    user: {
                        name: os.userInfo().username,
                        isAdmin,
                        shell: os.userInfo().shell
                    },
                    resources: {
                        cpuCores: cpus.length,
                        cpuModel: cpus[0]?.model || 'Unknown',
                        totalMemoryMB: Math.round(os.totalmem() / (1024 ** 2)),
                        freeMemoryMB: Math.round(os.freemem() / (1024 ** 2)),
                        memoryUsagePercent: Math.round((1 - os.freemem() / os.totalmem()) * 100),
                        uptime: os.uptime()
                    }
                };

                // Update Session Kernel
                updateSessionKernel(env);

                // Detect software if requested
                let software: SoftwareInfo[] = [];
                if (params.includeSoftware && params.includeSoftware.length > 0) {
                    software = await Promise.all(
                        params.includeSoftware.map(name => detectSoftware(name))
                    );
                }

                context.logger.info(`Environment: ${env.os.type} ${env.os.release} (${env.os.arch})`);

                return {
                    success: true,
                    data: { environment: env, software },
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
        name: 'getDiskSpace',
        description: 'Get disk space information',
        parameters: DiskParams,
        estimatedDurationMs: 2000,
        execute: async (params, context) => {
            const startTime = Date.now();
            try {
                context.logger.info('Checking disk space...');
                const disks = await getDiskInfo();

                return {
                    success: true,
                    data: { disks },
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
        name: 'detectSoftware',
        description: 'Detect installed software versions',
        parameters: SoftwareParams,
        estimatedDurationMs: 5000,
        execute: async (params, context) => {
            const startTime = Date.now();
            try {
                context.logger.info(`Detecting software: ${params.names.join(', ')}`);

                const results = await Promise.all(
                    params.names.map(name => detectSoftware(name))
                );

                const installed = results.filter(s => s.version !== null);
                const missing = results.filter(s => s.version === null);

                return {
                    success: true,
                    data: {
                        software: results,
                        installed: installed.map(s => s.name),
                        missing: missing.map(s => s.name)
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
        name: 'checkPermissions',
        description: 'Check file/folder permissions',
        parameters: PermissionParams,
        estimatedDurationMs: 500,
        execute: async (params, context) => {
            const startTime = Date.now();
            try {
                context.logger.info(`Checking permissions for ${params.paths.length} paths`);

                const results = params.paths.map(p => checkPermissions(p));

                return {
                    success: true,
                    data: { permissions: results },
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
        name: 'getResourceUsage',
        description: 'Get current CPU and memory usage',
        parameters: z.object({}),
        estimatedDurationMs: 100,
        execute: async (params, context) => {
            const startTime = Date.now();
            try {
                const cpus = os.cpus();
                const loadAvg = os.loadavg();

                const usage = {
                    memory: {
                        totalMB: Math.round(os.totalmem() / (1024 ** 2)),
                        freeMB: Math.round(os.freemem() / (1024 ** 2)),
                        usedMB: Math.round((os.totalmem() - os.freemem()) / (1024 ** 2)),
                        usagePercent: Math.round((1 - os.freemem() / os.totalmem()) * 100)
                    },
                    cpu: {
                        cores: cpus.length,
                        loadAverage: loadAvg,
                        model: cpus[0]?.model || 'Unknown'
                    },
                    uptime: {
                        seconds: os.uptime(),
                        formatted: formatUptime(os.uptime())
                    }
                };

                return {
                    success: true,
                    data: usage,
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
        return {
            status: 'healthy',
            message: `Running on ${getOSType()} ${os.arch()}`,
            lastCheck: Date.now(),
            details: {
                os: getOSType(),
                arch: os.arch(),
                uptime: os.uptime()
            }
        };
    })

    .build();

// =============================================================================
// Helpers
// =============================================================================

function formatUptime(seconds: number): string {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const mins = Math.floor((seconds % 3600) / 60);

    if (days > 0) return `${days}d ${hours}h ${mins}m`;
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
}

export default environmentSkill;
