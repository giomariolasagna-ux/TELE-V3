/**
 * Skill Scanner - Automatic skill discovery and registration
 * Part of God Mode System - Challenge 2
 * 
 * Features:
 * - Scans skills directory for YAML manifests
 * - File watching for live updates
 * - Caching with validation
 * - Dependency resolution
 * - Version compatibility checking
 */

import * as fs from 'fs';
import * as path from 'path';
import { SkillCard, HealthStatus } from './skill_card';
import { globalSkillsRegistry } from './registry';

// =============================================================================
// Types
// =============================================================================

export interface SkillManifest {
    id: string;
    name: string;
    version: string;
    description: string;
    author?: string;
    category: SkillCard['category'];
    tags: string[];
    dependencies?: Record<string, string>;  // skillId: versionConstraint
    entry: string;  // Relative path to the skill implementation
    config?: Record<string, any>;
}

export interface ScanResult {
    discovered: number;
    registered: number;
    errors: Array<{ path: string; error: string }>;
    timestamp: number;
}

export interface SkillCache {
    version: number;
    skills: Array<{
        id: string;
        manifestPath: string;
        entryPath: string;
        lastModified: number;
        checksum: string;
    }>;
    lastScan: number;
}

// =============================================================================
// Skill Scanner
// =============================================================================

export class SkillScanner {
    private skillsDir: string;
    private cacheFile: string;
    private cache: SkillCache | null = null;
    private watcher: fs.FSWatcher | null = null;
    private debounceTimer: NodeJS.Timeout | null = null;
    private onChangeCallback?: (skillId: string, action: 'added' | 'updated' | 'removed') => void;

    constructor(skillsDir: string, cacheDir?: string) {
        this.skillsDir = skillsDir;
        this.cacheFile = path.join(cacheDir || skillsDir, '.skill-cache.json');
        this.loadCache();
    }

    // -------------------------------------------------------------------------
    // Cache Management
    // -------------------------------------------------------------------------

    private loadCache(): void {
        try {
            if (fs.existsSync(this.cacheFile)) {
                const content = fs.readFileSync(this.cacheFile, 'utf8');
                this.cache = JSON.parse(content);
                console.log(`[SkillScanner] Loaded cache with ${this.cache?.skills.length || 0} entries`);
            }
        } catch (error) {
            console.warn('[SkillScanner] Failed to load cache, will rebuild');
            this.cache = null;
        }
    }

    private saveCache(): void {
        try {
            if (this.cache) {
                fs.writeFileSync(this.cacheFile, JSON.stringify(this.cache, null, 2));
            }
        } catch (error) {
            console.warn('[SkillScanner] Failed to save cache');
        }
    }

    private calculateChecksum(filePath: string): string {
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            // Simple hash for change detection
            let hash = 0;
            for (let i = 0; i < content.length; i++) {
                const char = content.charCodeAt(i);
                hash = ((hash << 5) - hash) + char;
                hash = hash & hash; // Convert to 32bit integer
            }
            return hash.toString(16);
        } catch {
            return '';
        }
    }

    private isCacheValid(manifestPath: string): boolean {
        if (!this.cache) return false;

        const cached = this.cache.skills.find(s => s.manifestPath === manifestPath);
        if (!cached) return false;

        try {
            const stats = fs.statSync(manifestPath);
            const currentChecksum = this.calculateChecksum(manifestPath);
            return cached.lastModified === stats.mtimeMs && cached.checksum === currentChecksum;
        } catch {
            return false;
        }
    }

    // -------------------------------------------------------------------------
    // Manifest Parsing
    // -------------------------------------------------------------------------

    parseManifest(manifestPath: string): SkillManifest | null {
        try {
            const content = fs.readFileSync(manifestPath, 'utf8');

            // Simple YAML-like parsing (key: value format)
            // For production, use a proper YAML library
            const manifest: Partial<SkillManifest> = {};
            const lines = content.split('\n');

            let currentKey = '';
            let inDependencies = false;
            let inTags = false;
            const dependencies: Record<string, string> = {};
            const tags: string[] = [];

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith('#')) continue;

                // Handle nested items
                if (line.startsWith('  - ')) {
                    const value = trimmed.substring(2).trim();
                    if (inTags) {
                        tags.push(value);
                    }
                    continue;
                }

                if (line.startsWith('  ') && inDependencies) {
                    const [depId, version] = trimmed.split(':').map(s => s.trim());
                    if (depId && version) {
                        dependencies[depId] = version.replace(/['"]/g, '');
                    }
                    continue;
                }

                // Handle key: value pairs
                const colonIdx = trimmed.indexOf(':');
                if (colonIdx > 0) {
                    currentKey = trimmed.substring(0, colonIdx).trim();
                    const value = trimmed.substring(colonIdx + 1).trim().replace(/['"]/g, '');

                    inDependencies = currentKey === 'dependencies';
                    inTags = currentKey === 'tags';

                    if (value && !inDependencies && !inTags) {
                        (manifest as any)[currentKey] = value;
                    }
                }
            }

            manifest.dependencies = Object.keys(dependencies).length > 0 ? dependencies : undefined;
            manifest.tags = tags.length > 0 ? tags : [];

            // Validate required fields
            if (!manifest.id || !manifest.name || !manifest.version || !manifest.entry) {
                console.warn(`[SkillScanner] Invalid manifest at ${manifestPath}: missing required fields`);
                return null;
            }

            // Set defaults
            manifest.category = manifest.category || 'automation';
            manifest.description = manifest.description || '';

            return manifest as SkillManifest;
        } catch (error: any) {
            console.error(`[SkillScanner] Failed to parse manifest ${manifestPath}:`, error.message);
            return null;
        }
    }

    // -------------------------------------------------------------------------
    // Skill Loading
    // -------------------------------------------------------------------------

    async loadSkillFromManifest(manifest: SkillManifest, manifestDir: string): Promise<SkillCard | null> {
        try {
            const entryPath = path.join(manifestDir, manifest.entry);

            if (!fs.existsSync(entryPath)) {
                console.error(`[SkillScanner] Entry file not found: ${entryPath}`);
                return null;
            }

            // Dynamic import
            const module = await import(entryPath);

            // Look for default export or named 'skill' export
            const skill: SkillCard = module.default || module.skill || module[`${manifest.id.split('.').pop()}Skill`];

            if (!skill || typeof skill.healthCheck !== 'function') {
                console.error(`[SkillScanner] Invalid skill export from ${entryPath}`);
                return null;
            }

            return skill;
        } catch (error: any) {
            console.error(`[SkillScanner] Failed to load skill ${manifest.id}:`, error.message);
            return null;
        }
    }

    // -------------------------------------------------------------------------
    // Scanning
    // -------------------------------------------------------------------------

    async scan(): Promise<ScanResult> {
        const result: ScanResult = {
            discovered: 0,
            registered: 0,
            errors: [],
            timestamp: Date.now()
        };

        if (!fs.existsSync(this.skillsDir)) {
            console.log(`[SkillScanner] Skills directory does not exist: ${this.skillsDir}`);
            fs.mkdirSync(this.skillsDir, { recursive: true });
            return result;
        }

        console.log(`[SkillScanner] Scanning: ${this.skillsDir}`);

        // Find all manifest files
        const manifestFiles = this.findManifestFiles(this.skillsDir);
        result.discovered = manifestFiles.length;

        // Initialize new cache
        const newCache: SkillCache = {
            version: 1,
            skills: [],
            lastScan: Date.now()
        };

        for (const manifestPath of manifestFiles) {
            try {
                // Check cache validity
                if (this.isCacheValid(manifestPath)) {
                    const cached = this.cache!.skills.find(s => s.manifestPath === manifestPath)!;
                    newCache.skills.push(cached);
                    console.log(`[SkillScanner] Using cached: ${cached.id}`);
                    continue;
                }

                // Parse manifest
                const manifest = this.parseManifest(manifestPath);
                if (!manifest) {
                    result.errors.push({ path: manifestPath, error: 'Invalid manifest' });
                    continue;
                }

                // Check dependencies
                if (manifest.dependencies) {
                    const { missing } = this.checkDependencies(manifest.dependencies);
                    if (missing.length > 0) {
                        result.errors.push({
                            path: manifestPath,
                            error: `Missing dependencies: ${missing.join(', ')}`
                        });
                        continue;
                    }
                }

                // Load and register skill
                const manifestDir = path.dirname(manifestPath);
                const skill = await this.loadSkillFromManifest(manifest, manifestDir);

                if (skill) {
                    globalSkillsRegistry.registerSkillCard(skill);
                    result.registered++;

                    // Update cache
                    const stats = fs.statSync(manifestPath);
                    newCache.skills.push({
                        id: skill.id,
                        manifestPath,
                        entryPath: path.join(manifestDir, manifest.entry),
                        lastModified: stats.mtimeMs,
                        checksum: this.calculateChecksum(manifestPath)
                    });

                    console.log(`[SkillScanner] Registered: ${skill.name} (${skill.id})`);
                }
            } catch (error: any) {
                result.errors.push({ path: manifestPath, error: error.message });
            }
        }

        // Save updated cache
        this.cache = newCache;
        this.saveCache();

        console.log(`[SkillScanner] Scan complete: ${result.registered}/${result.discovered} skills registered`);
        return result;
    }

    private findManifestFiles(dir: string, files: string[] = []): string[] {
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });

            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);

                if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
                    this.findManifestFiles(fullPath, files);
                } else if (entry.isFile()) {
                    // Look for skill.yaml, skill.yml, or *.skill.yaml
                    if (entry.name === 'skill.yaml' ||
                        entry.name === 'skill.yml' ||
                        entry.name.endsWith('.skill.yaml') ||
                        entry.name.endsWith('.skill.yml')) {
                        files.push(fullPath);
                    }
                }
            }
        } catch (error) {
            // Ignore permission errors
        }

        return files;
    }

    // -------------------------------------------------------------------------
    // Dependencies
    // -------------------------------------------------------------------------

    checkDependencies(dependencies: Record<string, string>): {
        satisfied: string[];
        missing: string[]
    } {
        const satisfied: string[] = [];
        const missing: string[] = [];

        for (const [depId, versionConstraint] of Object.entries(dependencies)) {
            const dep = globalSkillsRegistry.getSkillCard(depId);

            if (dep) {
                if (this.checkVersionCompatibility(versionConstraint, dep.version)) {
                    satisfied.push(depId);
                } else {
                    missing.push(`${depId}@${versionConstraint} (have ${dep.version})`);
                }
            } else {
                missing.push(depId);
            }
        }

        return { satisfied, missing };
    }

    checkVersionCompatibility(constraint: string, version: string): boolean {
        // Simple semver-like comparison
        // Supports: >=x.y.z, ^x.y.z, ~x.y.z, x.y.z

        const parseVersion = (v: string): number[] => {
            return v.replace(/[^0-9.]/g, '').split('.').map(n => parseInt(n) || 0);
        };

        const [major, minor, patch] = parseVersion(version);
        const constraintVersion = parseVersion(constraint);

        if (constraint.startsWith('>=')) {
            const [cMajor, cMinor = 0, cPatch = 0] = constraintVersion;
            return major > cMajor ||
                (major === cMajor && minor > cMinor) ||
                (major === cMajor && minor === cMinor && patch >= cPatch);
        }

        if (constraint.startsWith('^')) {
            // Compatible with same major version
            return major === constraintVersion[0];
        }

        if (constraint.startsWith('~')) {
            // Compatible with same minor version
            return major === constraintVersion[0] && minor === constraintVersion[1];
        }

        // Exact match
        return version === constraint;
    }

    // -------------------------------------------------------------------------
    // File Watching
    // -------------------------------------------------------------------------

    watch(onChange?: (skillId: string, action: 'added' | 'updated' | 'removed') => void): void {
        if (this.watcher) {
            console.log('[SkillScanner] Already watching');
            return;
        }

        this.onChangeCallback = onChange;

        try {
            this.watcher = fs.watch(this.skillsDir, { recursive: true }, (eventType, filename) => {
                if (!filename) return;

                // Only react to manifest file changes
                if (!filename.endsWith('.yaml') && !filename.endsWith('.yml')) return;

                // Debounce rapid changes
                if (this.debounceTimer) {
                    clearTimeout(this.debounceTimer);
                }

                this.debounceTimer = setTimeout(() => {
                    console.log(`[SkillScanner] Detected change: ${filename}`);
                    this.handleFileChange(filename, eventType);
                }, 500);
            });

            console.log(`[SkillScanner] Watching for changes: ${this.skillsDir}`);
        } catch (error: any) {
            console.error('[SkillScanner] Failed to start watcher:', error.message);
        }
    }

    private async handleFileChange(filename: string, eventType: string): Promise<void> {
        const fullPath = path.join(this.skillsDir, filename);

        if (!fs.existsSync(fullPath)) {
            // File was deleted
            const cached = this.cache?.skills.find(s => s.manifestPath === fullPath);
            if (cached) {
                globalSkillsRegistry.unregisterSkillCard(cached.id);
                this.cache!.skills = this.cache!.skills.filter(s => s.id !== cached.id);
                this.saveCache();
                this.onChangeCallback?.(cached.id, 'removed');
                console.log(`[SkillScanner] Unregistered removed skill: ${cached.id}`);
            }
            return;
        }

        // File was added or modified - rescan it
        const manifest = this.parseManifest(fullPath);
        if (!manifest) return;

        const manifestDir = path.dirname(fullPath);
        const skill = await this.loadSkillFromManifest(manifest, manifestDir);

        if (skill) {
            const isUpdate = this.cache?.skills.some(s => s.id === skill.id);
            globalSkillsRegistry.registerSkillCard(skill);

            // Update cache
            const stats = fs.statSync(fullPath);
            const newCacheEntry = {
                id: skill.id,
                manifestPath: fullPath,
                entryPath: path.join(manifestDir, manifest.entry),
                lastModified: stats.mtimeMs,
                checksum: this.calculateChecksum(fullPath)
            };

            if (this.cache) {
                this.cache.skills = this.cache.skills.filter(s => s.id !== skill.id);
                this.cache.skills.push(newCacheEntry);
                this.saveCache();
            }

            this.onChangeCallback?.(skill.id, isUpdate ? 'updated' : 'added');
            console.log(`[SkillScanner] ${isUpdate ? 'Updated' : 'Registered'}: ${skill.name}`);
        }
    }

    stopWatching(): void {
        if (this.watcher) {
            this.watcher.close();
            this.watcher = null;
            console.log('[SkillScanner] Stopped watching');
        }
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }
    }

    // -------------------------------------------------------------------------
    // Cleanup
    // -------------------------------------------------------------------------

    destroy(): void {
        this.stopWatching();
        this.cache = null;
    }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let globalScanner: SkillScanner | null = null;

export function getSkillScanner(skillsDir?: string): SkillScanner {
    if (!globalScanner) {
        const defaultDir = path.join(process.cwd(), 'skills');
        globalScanner = new SkillScanner(skillsDir || defaultDir);
    }
    return globalScanner;
}

export function initializeSkillScanner(skillsDir: string): SkillScanner {
    if (globalScanner) {
        globalScanner.destroy();
    }
    globalScanner = new SkillScanner(skillsDir);
    return globalScanner;
}
