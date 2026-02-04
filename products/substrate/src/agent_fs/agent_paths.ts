/**
 * Agent Filesystem Paths
 * Centralized path definitions for agent memory, logs, flows, and cache
 */

import * as path from 'path';
import * as fs from 'fs';

// Root directory for all agent data
const SUBSTRATE_ROOT = path.resolve(__dirname, '..', '..');
export const AGENT_ROOT = path.join(SUBSTRATE_ROOT, '.tele', 'agent');

// Subdirectories
export const MEMORY_DIR = path.join(AGENT_ROOT, 'memory');
export const LOGS_DIR = path.join(AGENT_ROOT, 'logs');
export const FLOWS_DIR = path.join(AGENT_ROOT, 'flows');
export const CACHE_DIR = path.join(AGENT_ROOT, 'cache');

// Specific files
export const APP_REGISTRY_CACHE = path.join(CACHE_DIR, 'app_registry.json');
export const SKILL_MEMORY_DB = path.join(MEMORY_DIR, 'skills.db');
export const FLOW_INDEX = path.join(FLOWS_DIR, 'index.json');

/**
 * Get a path relative to agent root
 */
export function getAgentPath(...segments: string[]): string {
    return path.join(AGENT_ROOT, ...segments);
}

/**
 * Ensure all agent directories exist
 */
export function ensureAgentDirs(): void {
    const dirs = [AGENT_ROOT, MEMORY_DIR, LOGS_DIR, FLOWS_DIR, CACHE_DIR];

    for (const dir of dirs) {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
            console.log(`[AgentFS] Created: ${dir}`);
        }
    }
}

/**
 * Get directory size in bytes
 */
export async function getDirSize(dirPath: string): Promise<number> {
    let size = 0;

    if (!fs.existsSync(dirPath)) return 0;

    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isFile()) {
            const stat = fs.statSync(fullPath);
            size += stat.size;
        } else if (entry.isDirectory()) {
            size += await getDirSize(fullPath);
        }
    }

    return size;
}

/**
 * Clean old files from a directory (for log rotation)
 */
export function cleanOldFiles(dirPath: string, maxFiles: number, maxSizeBytes?: number): void {
    if (!fs.existsSync(dirPath)) return;

    const files = fs.readdirSync(dirPath)
        .map(name => {
            const fullPath = path.join(dirPath, name);
            const stat = fs.statSync(fullPath);
            return { name, path: fullPath, mtime: stat.mtime, size: stat.size };
        })
        .filter(f => fs.statSync(f.path).isFile())
        .sort((a, b) => b.mtime.getTime() - a.mtime.getTime()); // Newest first

    // Remove excess files
    while (files.length > maxFiles) {
        const oldest = files.pop()!;
        fs.unlinkSync(oldest.path);
        console.log(`[AgentFS] Removed old file: ${oldest.name}`);
    }

    // Remove files if total size exceeds limit
    if (maxSizeBytes) {
        let totalSize = files.reduce((sum, f) => sum + f.size, 0);
        while (totalSize > maxSizeBytes && files.length > 1) {
            const oldest = files.pop()!;
            fs.unlinkSync(oldest.path);
            totalSize -= oldest.size;
            console.log(`[AgentFS] Removed file for size: ${oldest.name}`);
        }
    }
}

// Initialize on module load
ensureAgentDirs();
