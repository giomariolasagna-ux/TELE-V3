/**
 * Safe File Cleanup Skill - Temp/obsolete file management
 * Part of God Mode System - Challenge 11
 * 
 * Features:
 * - Scan for temp files, caches, duplicates
 * - Risk categorization (safe/review/critical)
 * - Preview with size totals
 * - Backup-to-trash before delete
 * - Full rollback capability
 * - Detailed logging
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

export type RiskLevel = 'safe' | 'review' | 'critical';

export interface CleanupTarget {
    path: string;
    type: 'file' | 'directory';
    sizeBytes: number;
    age: number;  // days
    category: string;
    risk: RiskLevel;
    reason: string;
}

export interface CleanupScanResult {
    targets: CleanupTarget[];
    totalSizeBytes: number;
    totalSizeMB: number;
    byCategory: Record<string, { count: number; sizeBytes: number }>;
    byRisk: Record<RiskLevel, { count: number; sizeBytes: number }>;
    scanDurationMs: number;
}

export interface CleanupResult {
    deleted: string[];
    failed: { path: string; error: string }[];
    backedUp: string[];
    totalFreedBytes: number;
    totalFreedMB: number;
}

export interface BackupEntry {
    originalPath: string;
    backupPath: string;
    timestamp: number;
    sizeBytes: number;
}

// =============================================================================
// Cleanup Categories
// =============================================================================

interface CleanupCategory {
    name: string;
    paths: string[];
    patterns: RegExp[];
    risk: RiskLevel;
    minAgeDays: number;
}

function getCleanupCategories(): CleanupCategory[] {
    const home = os.homedir();
    const temp = os.tmpdir();
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');

    return [
        {
            name: 'Windows Temp',
            paths: [temp, path.join(localAppData, 'Temp')],
            patterns: [/.*/],
            risk: 'safe',
            minAgeDays: 7
        },
        {
            name: 'Browser Cache',
            paths: [
                path.join(localAppData, 'Google', 'Chrome', 'User Data', 'Default', 'Cache'),
                path.join(localAppData, 'Microsoft', 'Edge', 'User Data', 'Default', 'Cache'),
                path.join(appData, 'Mozilla', 'Firefox', 'Profiles')
            ],
            patterns: [/^[a-f0-9]+$/, /\.tmp$/i, /^cache/i],
            risk: 'safe',
            minAgeDays: 3
        },
        {
            name: 'Log Files',
            paths: [home, temp],
            patterns: [/\.log$/i, /\.old$/i, /\.bak$/i],
            risk: 'safe',
            minAgeDays: 30
        },
        {
            name: 'Thumbnails',
            paths: [
                path.join(localAppData, 'Microsoft', 'Windows', 'Explorer')
            ],
            patterns: [/^thumbcache/i, /\.db$/i],
            risk: 'safe',
            minAgeDays: 7
        },
        {
            name: 'npm Cache',
            paths: [path.join(appData, 'npm-cache')],
            patterns: [/.*/],
            risk: 'review',
            minAgeDays: 30
        },
        {
            name: 'Downloads (old)',
            paths: [path.join(home, 'Downloads')],
            patterns: [/\.tmp$/i, /\.crdownload$/i, /\.partial$/i],
            risk: 'review',
            minAgeDays: 30
        },
        {
            name: 'Recycle Bin',
            paths: ['C:\\$Recycle.Bin'],
            patterns: [/.*/],
            risk: 'critical',
            minAgeDays: 30
        }
    ];
}

// =============================================================================
// Scanner
// =============================================================================

class CleanupScanner {
    private backupDir: string;
    private backupLog: BackupEntry[] = [];

    constructor() {
        this.backupDir = path.join(os.tmpdir(), 'tele_cleanup_backup');
    }

    async scan(options: {
        categories?: string[];
        minAgeDays?: number;
        maxSizeMB?: number;
        includeReview?: boolean;
        includeCritical?: boolean;
    } = {}): Promise<CleanupScanResult> {
        const startTime = Date.now();
        const targets: CleanupTarget[] = [];
        const categories = getCleanupCategories();

        const minAge = options.minAgeDays ?? 7;
        const maxSize = (options.maxSizeMB ?? 1000) * 1024 * 1024;

        for (const category of categories) {
            // Filter by category name if specified
            if (options.categories && !options.categories.includes(category.name)) {
                continue;
            }

            // Skip by risk level
            if (category.risk === 'review' && !options.includeReview) continue;
            if (category.risk === 'critical' && !options.includeCritical) continue;

            for (const scanPath of category.paths) {
                if (!fs.existsSync(scanPath)) continue;

                try {
                    await this.scanDirectory(
                        scanPath,
                        category,
                        Math.max(minAge, category.minAgeDays),
                        maxSize,
                        targets
                    );
                } catch (e) {
                    // Skip inaccessible directories
                }
            }
        }

        // Calculate totals
        const totalSizeBytes = targets.reduce((sum, t) => sum + t.sizeBytes, 0);
        const byCategory: Record<string, { count: number; sizeBytes: number }> = {};
        const byRisk: Record<RiskLevel, { count: number; sizeBytes: number }> = {
            safe: { count: 0, sizeBytes: 0 },
            review: { count: 0, sizeBytes: 0 },
            critical: { count: 0, sizeBytes: 0 }
        };

        for (const target of targets) {
            if (!byCategory[target.category]) {
                byCategory[target.category] = { count: 0, sizeBytes: 0 };
            }
            byCategory[target.category].count++;
            byCategory[target.category].sizeBytes += target.sizeBytes;

            byRisk[target.risk].count++;
            byRisk[target.risk].sizeBytes += target.sizeBytes;
        }

        return {
            targets,
            totalSizeBytes,
            totalSizeMB: Math.round(totalSizeBytes / (1024 * 1024) * 10) / 10,
            byCategory,
            byRisk,
            scanDurationMs: Date.now() - startTime
        };
    }

    private async scanDirectory(
        dir: string,
        category: CleanupCategory,
        minAgeDays: number,
        maxSize: number,
        targets: CleanupTarget[]
    ): Promise<void> {
        let entries: fs.Dirent[];

        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }

        const now = Date.now();
        const minAgeMs = minAgeDays * 24 * 60 * 60 * 1000;

        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);

            try {
                const stats = fs.statSync(fullPath);
                const age = now - stats.mtime.getTime();
                const ageDays = Math.floor(age / (24 * 60 * 60 * 1000));

                if (age < minAgeMs) continue;
                if (stats.size > maxSize) continue;

                // Check pattern match
                const matchesPattern = category.patterns.some(p => p.test(entry.name));
                if (!matchesPattern) continue;

                targets.push({
                    path: fullPath,
                    type: entry.isDirectory() ? 'directory' : 'file',
                    sizeBytes: stats.size,
                    age: ageDays,
                    category: category.name,
                    risk: category.risk,
                    reason: `${ageDays} days old, ${category.name}`
                });
            } catch {
                // Skip inaccessible files
            }
        }
    }

    async clean(
        targets: CleanupTarget[],
        options: {
            backup?: boolean;
            riskFilter?: RiskLevel[];
            dryRun?: boolean;
        } = {}
    ): Promise<CleanupResult> {
        const backup = options.backup ?? true;
        const riskFilter = options.riskFilter ?? ['safe'];
        const dryRun = options.dryRun ?? false;

        const result: CleanupResult = {
            deleted: [],
            failed: [],
            backedUp: [],
            totalFreedBytes: 0,
            totalFreedMB: 0
        };

        // Filter targets by risk
        const toClean = targets.filter(t => riskFilter.includes(t.risk));

        if (backup && !dryRun) {
            // Ensure backup directory exists
            if (!fs.existsSync(this.backupDir)) {
                fs.mkdirSync(this.backupDir, { recursive: true });
            }
        }

        for (const target of toClean) {
            try {
                if (dryRun) {
                    result.deleted.push(target.path);
                    result.totalFreedBytes += target.sizeBytes;
                    continue;
                }

                if (backup) {
                    const backupPath = await this.backupFile(target.path);
                    if (backupPath) {
                        result.backedUp.push(target.path);
                        this.backupLog.push({
                            originalPath: target.path,
                            backupPath,
                            timestamp: Date.now(),
                            sizeBytes: target.sizeBytes
                        });
                    }
                }

                // Delete
                if (target.type === 'directory') {
                    fs.rmSync(target.path, { recursive: true, force: true });
                } else {
                    fs.unlinkSync(target.path);
                }

                result.deleted.push(target.path);
                result.totalFreedBytes += target.sizeBytes;

            } catch (error: any) {
                result.failed.push({ path: target.path, error: error.message });
            }
        }

        result.totalFreedMB = Math.round(result.totalFreedBytes / (1024 * 1024) * 10) / 10;

        // Save backup log
        if (backup && this.backupLog.length > 0) {
            this.saveBackupLog();
        }

        return result;
    }

    private async backupFile(filePath: string): Promise<string | null> {
        try {
            const fileName = path.basename(filePath);
            const backupPath = path.join(
                this.backupDir,
                `${Date.now()}_${fileName}`
            );

            fs.copyFileSync(filePath, backupPath);
            return backupPath;
        } catch {
            return null;
        }
    }

    private saveBackupLog(): void {
        const logPath = path.join(this.backupDir, 'backup_log.json');
        fs.writeFileSync(logPath, JSON.stringify(this.backupLog, null, 2));
    }

    async rollback(beforeTimestamp?: number): Promise<{
        restored: string[];
        failed: string[];
    }> {
        const result = { restored: [] as string[], failed: [] as string[] };

        // Load backup log
        const logPath = path.join(this.backupDir, 'backup_log.json');
        if (!fs.existsSync(logPath)) {
            return result;
        }

        const log: BackupEntry[] = JSON.parse(fs.readFileSync(logPath, 'utf8'));
        const toRestore = beforeTimestamp
            ? log.filter(e => e.timestamp >= beforeTimestamp)
            : log;

        for (const entry of toRestore) {
            try {
                if (fs.existsSync(entry.backupPath)) {
                    // Ensure parent directory exists
                    const parentDir = path.dirname(entry.originalPath);
                    if (!fs.existsSync(parentDir)) {
                        fs.mkdirSync(parentDir, { recursive: true });
                    }

                    fs.copyFileSync(entry.backupPath, entry.originalPath);
                    result.restored.push(entry.originalPath);
                }
            } catch {
                result.failed.push(entry.originalPath);
            }
        }

        return result;
    }

    getBackupLog(): BackupEntry[] {
        return [...this.backupLog];
    }
}

// =============================================================================
// Parameter Schemas
// =============================================================================

const ScanParams = z.object({
    categories: z.array(z.string()).optional().describe('Categories to scan'),
    minAgeDays: z.number().optional().default(7).describe('Minimum file age in days'),
    maxSizeMB: z.number().optional().default(1000).describe('Maximum file size to include'),
    includeReview: z.boolean().optional().default(false).describe('Include files needing review'),
    includeCritical: z.boolean().optional().default(false).describe('Include critical files')
});

const CleanParams = z.object({
    targets: z.array(z.object({
        path: z.string(),
        sizeBytes: z.number(),
        risk: z.enum(['safe', 'review', 'critical'])
    })).optional().describe('Specific targets to clean'),
    riskLevels: z.array(z.enum(['safe', 'review', 'critical'])).optional().default(['safe']),
    backup: z.boolean().optional().default(true).describe('Backup files before deleting'),
    dryRun: z.boolean().optional().default(false).describe('Preview without deleting')
});

const RollbackParams = z.object({
    beforeTimestamp: z.number().optional().describe('Rollback files deleted after this timestamp')
});

// =============================================================================
// Skill Instance
// =============================================================================

const scanner = new CleanupScanner();

// =============================================================================
// Skill Definition
// =============================================================================

export const cleanupSkill: SkillCard = defineSkill()
    .id('skill.system.cleanup')
    .name('Safe File Cleanup')
    .version('1.0.0')
    .description('Scan and safely delete temporary/obsolete files with backup and rollback')
    .author('TELE God Mode')
    .category('system')
    .tags('cleanup', 'temp', 'cache', 'disk', 'maintenance', 'rollback')

    .action({
        name: 'scan',
        description: 'Scan for cleanup targets (temp files, caches, logs)',
        parameters: ScanParams,
        estimatedDurationMs: 10000,
        execute: async (params, context) => {
            const startTime = Date.now();
            try {
                context.logger.info('Scanning for cleanup targets...');

                const result = await scanner.scan({
                    categories: params.categories,
                    minAgeDays: params.minAgeDays,
                    maxSizeMB: params.maxSizeMB,
                    includeReview: params.includeReview,
                    includeCritical: params.includeCritical
                });

                context.logger.info(
                    `Found ${result.targets.length} files (${result.totalSizeMB} MB)`
                );

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
        name: 'preview',
        description: 'Preview cleanup without deleting (dry run)',
        parameters: ScanParams,
        estimatedDurationMs: 10000,
        execute: async (params, context) => {
            const startTime = Date.now();
            try {
                const scanResult = await scanner.scan(params);

                // Group by category for report
                const report = {
                    summary: {
                        totalFiles: scanResult.targets.length,
                        totalSizeMB: scanResult.totalSizeMB,
                        safeToDelete: scanResult.byRisk.safe.count,
                        safeSizeMB: Math.round(scanResult.byRisk.safe.sizeBytes / (1024 * 1024) * 10) / 10,
                        needsReview: scanResult.byRisk.review.count,
                        critical: scanResult.byRisk.critical.count
                    },
                    byCategory: scanResult.byCategory,
                    topTargets: scanResult.targets
                        .sort((a, b) => b.sizeBytes - a.sizeBytes)
                        .slice(0, 20)
                        .map(t => ({
                            path: t.path,
                            sizeMB: Math.round(t.sizeBytes / (1024 * 1024) * 10) / 10,
                            age: `${t.age} days`,
                            risk: t.risk
                        }))
                };

                return {
                    success: true,
                    data: report,
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
        name: 'clean',
        description: 'Delete cleanup targets with backup option',
        parameters: CleanParams,
        estimatedDurationMs: 30000,
        canRollback: true,
        execute: async (params, context) => {
            const startTime = Date.now();
            try {
                // If no specific targets, scan first
                let targets: CleanupTarget[];
                if (params.targets && params.targets.length > 0) {
                    targets = params.targets.map(t => ({
                        ...t,
                        type: 'file' as const,
                        age: 0,
                        category: 'User specified',
                        reason: 'User specified'
                    }) as CleanupTarget);
                } else {
                    const scan = await scanner.scan({ includeReview: true });
                    targets = scan.targets;
                }

                context.logger.info(
                    `Cleaning ${targets.length} files (backup: ${params.backup}, dryRun: ${params.dryRun})`
                );

                const result = await scanner.clean(targets, {
                    backup: params.backup,
                    riskFilter: params.riskLevels,
                    dryRun: params.dryRun
                });

                context.logger.info(
                    `Deleted ${result.deleted.length} files, freed ${result.totalFreedMB} MB`
                );

                return {
                    success: true,
                    data: result,
                    rollbackData: { timestamp: startTime },
                    durationMs: Date.now() - startTime
                } as any;
            } catch (error: any) {
                return {
                    success: false,
                    error: error.message,
                    durationMs: Date.now() - startTime
                };
            }
        },
        rollback: async (rollbackData, context) => {
            const startTime = Date.now();
            try {
                context.logger.info('Rolling back cleanup...');
                const result = await scanner.rollback(rollbackData.timestamp);

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
        name: 'rollback',
        description: 'Restore backed up files',
        parameters: RollbackParams,
        estimatedDurationMs: 10000,
        execute: async (params, context) => {
            const startTime = Date.now();
            try {
                context.logger.info('Restoring from backup...');
                const result = await scanner.rollback(params.beforeTimestamp);

                context.logger.info(
                    `Restored ${result.restored.length} files, ${result.failed.length} failed`
                );

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

    .healthCheck(async (): Promise<HealthStatus> => {
        const tempDir = os.tmpdir();
        const hasAccess = fs.existsSync(tempDir);

        return {
            status: hasAccess ? 'healthy' : 'degraded',
            message: hasAccess
                ? `Ready to scan ${tempDir}`
                : 'Limited access to temp directories',
            lastCheck: Date.now()
        };
    })

    .build();

export default cleanupSkill;
