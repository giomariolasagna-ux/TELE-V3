/**
 * App Registry - Dynamic Application Discovery
 * Replaces hardcoded paths with registry scanning and memory-cached lookups
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { APP_REGISTRY_CACHE, CACHE_DIR } from '../agent_fs/agent_paths';
import { agentMemory } from '../agent_fs/agent_memory';

export interface AppInfo {
    id: string;                    // e.g., 'adobe.photoshop'
    name: string;                  // e.g., 'Adobe Photoshop 2025'
    executablePath: string | null; // Full path to exe
    version?: string;
    publisher?: string;
    installLocation?: string;
    source: 'registry' | 'startmenu' | 'memory' | 'manual';
    confidence: number;            // 0-1, how confident we are this is correct
    lastVerified: number;
}

interface RegistryCache {
    version: number;
    lastScan: number;
    apps: AppInfo[];
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export class AppRegistry {
    private cache: RegistryCache;
    private scanning: Promise<void> | null = null;

    constructor() {
        this.cache = this.loadCache();
    }

    private loadCache(): RegistryCache {
        try {
            if (fs.existsSync(APP_REGISTRY_CACHE)) {
                const raw = fs.readFileSync(APP_REGISTRY_CACHE, 'utf8');
                return JSON.parse(raw);
            }
        } catch (error) {
            console.error('[AppRegistry] Failed to load cache:', error);
        }
        return { version: 1, lastScan: 0, apps: [] };
    }

    private saveCache(): void {
        try {
            if (!fs.existsSync(CACHE_DIR)) {
                fs.mkdirSync(CACHE_DIR, { recursive: true });
            }
            fs.writeFileSync(APP_REGISTRY_CACHE, JSON.stringify(this.cache, null, 2));
        } catch (error) {
            console.error('[AppRegistry] Failed to save cache:', error);
        }
    }

    /**
     * Resolve an app by ID or name
     * Priority: Memory > Cache > Fresh Scan
     */
    async resolve(appQuery: string): Promise<AppInfo | null> {
        const query = appQuery.toLowerCase();

        // 1. Check agent memory first (learned paths)
        const memoryResult = agentMemory.recall('app_path', query);
        if (memoryResult) {
            const appInfo = memoryResult.content as AppInfo;
            // Verify path still exists
            if (appInfo.executablePath && fs.existsSync(appInfo.executablePath)) {
                console.log(`[AppRegistry] Found in memory: ${appInfo.name}`);
                return appInfo;
            } else {
                // Path no longer valid, forget it
                agentMemory.forget(memoryResult.id);
            }
        }

        // 2. Check cache
        if (this.isCacheValid()) {
            const cached = this.findInCache(query);
            if (cached) {
                console.log(`[AppRegistry] Found in cache: ${cached.name}`);
                return cached;
            }
        }

        // 3. Fresh scan
        await this.scan();
        return this.findInCache(query);
    }

    private isCacheValid(): boolean {
        return (Date.now() - this.cache.lastScan) < CACHE_TTL_MS;
    }

    private findInCache(query: string): AppInfo | null {
        const q = query.toLowerCase();

        // Exact ID match
        let app = this.cache.apps.find(a => a.id.toLowerCase() === q);
        if (app) return app;

        // Exact name match
        app = this.cache.apps.find(a => a.name.toLowerCase() === q);
        if (app) return app;

        // ID starts with query
        app = this.cache.apps.find(a => a.id.toLowerCase().startsWith(q));
        if (app) return app;

        // Name contains query
        app = this.cache.apps.find(a => a.name.toLowerCase().includes(q));
        if (app) return app;

        return null;
    }

    /**
     * Scan system for installed applications
     */
    async scan(): Promise<AppInfo[]> {
        if (this.scanning) {
            await this.scanning;
            return this.cache.apps;
        }

        console.log('[AppRegistry] Scanning system for applications...');
        this.scanning = this.performScan();
        await this.scanning;
        this.scanning = null;

        return this.cache.apps;
    }

    private async performScan(): Promise<void> {
        const apps: AppInfo[] = [];

        // 1. Registry scan
        const registryApps = await this.scanRegistry();
        apps.push(...registryApps);

        // 2. Start Menu scan
        const startMenuApps = await this.scanStartMenu();
        apps.push(...startMenuApps);

        // 3. Common paths fallback
        const commonApps = this.scanCommonPaths();
        apps.push(...commonApps);

        // Deduplicate by executable path
        const seen = new Set<string>();
        const unique: AppInfo[] = [];
        for (const app of apps) {
            const key = app.executablePath?.toLowerCase() || app.id;
            if (!seen.has(key)) {
                seen.add(key);
                unique.push(app);
            }
        }

        this.cache.apps = unique;
        this.cache.lastScan = Date.now();
        this.saveCache();

        console.log(`[AppRegistry] Scan complete. Found ${unique.length} applications.`);
    }

    private async scanRegistry(): Promise<AppInfo[]> {
        const apps: AppInfo[] = [];

        const psScript = `
            $regPaths = @(
                'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
                'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
                'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
            )
            $results = @()
            foreach ($path in $regPaths) {
                $items = Get-ItemProperty $path -ErrorAction SilentlyContinue | 
                    Where-Object { $_.DisplayName -and ($_.InstallLocation -or $_.DisplayIcon) } |
                    Select-Object DisplayName, Publisher, DisplayVersion, InstallLocation, DisplayIcon
                $results += $items
            }
            $results | ConvertTo-Json -Depth 3
        `;

        try {
            const output = await this.runPowerShell(psScript);
            const items = JSON.parse(output);
            const itemArray = Array.isArray(items) ? items : [items];

            for (const item of itemArray) {
                if (!item || !item.DisplayName) continue;

                let exePath: string | null = null;

                // Try InstallLocation first
                if (item.InstallLocation) {
                    const possibleExe = this.findExeInDir(item.InstallLocation);
                    if (possibleExe) exePath = possibleExe;
                }

                // Try DisplayIcon (often contains exe path)
                if (!exePath && item.DisplayIcon) {
                    const iconPath = item.DisplayIcon.split(',')[0].replace(/"/g, '');
                    if (iconPath.endsWith('.exe') && fs.existsSync(iconPath)) {
                        exePath = iconPath;
                    }
                }

                if (exePath) {
                    apps.push({
                        id: this.generateAppId(item.DisplayName),
                        name: item.DisplayName,
                        executablePath: exePath,
                        version: item.DisplayVersion,
                        publisher: item.Publisher,
                        installLocation: item.InstallLocation,
                        source: 'registry',
                        confidence: 0.9,
                        lastVerified: Date.now()
                    });
                }
            }
        } catch (error) {
            console.error('[AppRegistry] Registry scan failed:', error);
        }

        return apps;
    }

    private async scanStartMenu(): Promise<AppInfo[]> {
        const apps: AppInfo[] = [];
        const startMenuPaths = [
            path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
            path.join(process.env.PROGRAMDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs')
        ];

        for (const menuPath of startMenuPaths) {
            if (!fs.existsSync(menuPath)) continue;

            try {
                const shortcuts = this.findShortcuts(menuPath);
                for (const shortcut of shortcuts) {
                    const target = await this.resolveShortcut(shortcut);
                    if (target && target.endsWith('.exe') && fs.existsSync(target)) {
                        const name = path.basename(shortcut, '.lnk');
                        apps.push({
                            id: this.generateAppId(name),
                            name: name,
                            executablePath: target,
                            source: 'startmenu',
                            confidence: 0.8,
                            lastVerified: Date.now()
                        });
                    }
                }
            } catch (error) {
                // Ignore errors for individual paths
            }
        }

        return apps;
    }

    private scanCommonPaths(): AppInfo[] {
        const apps: AppInfo[] = [];
        const programFiles = [
            process.env['ProgramFiles'] || 'C:\\Program Files',
            process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
        ];

        // Known app patterns
        const knownApps: Array<{ pattern: string; name: string; id: string }> = [
            { pattern: 'Adobe\\*Photoshop*\\Photoshop.exe', name: 'Adobe Photoshop', id: 'adobe.photoshop' },
            { pattern: 'Adobe\\*Illustrator*\\*\\Illustrator.exe', name: 'Adobe Illustrator', id: 'adobe.illustrator' },
            { pattern: 'Blender Foundation\\Blender*\\blender.exe', name: 'Blender', id: 'blender' },
            { pattern: 'Microsoft Office\\*\\WINWORD.EXE', name: 'Microsoft Word', id: 'microsoft.word' },
            { pattern: 'Microsoft Office\\*\\EXCEL.EXE', name: 'Microsoft Excel', id: 'microsoft.excel' },
            { pattern: 'Microsoft Office\\*\\POWERPNT.EXE', name: 'Microsoft PowerPoint', id: 'microsoft.powerpoint' },
            { pattern: 'Google\\Chrome\\Application\\chrome.exe', name: 'Google Chrome', id: 'google.chrome' },
            { pattern: 'Mozilla Firefox\\firefox.exe', name: 'Mozilla Firefox', id: 'mozilla.firefox' },
            { pattern: 'VideoLAN\\VLC\\vlc.exe', name: 'VLC Media Player', id: 'vlc' },
            { pattern: 'Notepad++\\notepad++.exe', name: 'Notepad++', id: 'notepadpp' }
        ];

        for (const pf of programFiles) {
            for (const app of knownApps) {
                const found = this.globSearch(pf, app.pattern);
                if (found) {
                    apps.push({
                        id: app.id,
                        name: app.name,
                        executablePath: found,
                        source: 'manual',
                        confidence: 0.7,
                        lastVerified: Date.now()
                    });
                }
            }
        }

        return apps;
    }

    private globSearch(basePath: string, pattern: string): string | null {
        const parts = pattern.split('\\');
        let currentPaths = [basePath];

        for (const part of parts) {
            const nextPaths: string[] = [];
            for (const p of currentPaths) {
                if (!fs.existsSync(p)) continue;

                if (part.includes('*')) {
                    const regex = new RegExp('^' + part.replace(/\*/g, '.*') + '$', 'i');
                    try {
                        const entries = fs.readdirSync(p);
                        for (const entry of entries) {
                            if (regex.test(entry)) {
                                nextPaths.push(path.join(p, entry));
                            }
                        }
                    } catch {
                        // Permission denied
                    }
                } else {
                    nextPaths.push(path.join(p, part));
                }
            }
            currentPaths = nextPaths;
        }

        for (const p of currentPaths) {
            if (fs.existsSync(p)) return p;
        }
        return null;
    }

    private findShortcuts(dir: string, depth: number = 3): string[] {
        const shortcuts: string[] = [];
        if (depth <= 0) return shortcuts;

        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    shortcuts.push(...this.findShortcuts(fullPath, depth - 1));
                } else if (entry.name.endsWith('.lnk')) {
                    shortcuts.push(fullPath);
                }
            }
        } catch {
            // Permission denied
        }

        return shortcuts;
    }

    private async resolveShortcut(lnkPath: string): Promise<string | null> {
        const psScript = `
            $sh = New-Object -ComObject WScript.Shell
            $shortcut = $sh.CreateShortcut("${lnkPath.replace(/\\/g, '\\\\')}")
            $shortcut.TargetPath
        `;

        try {
            const output = await this.runPowerShell(psScript);
            return output.trim();
        } catch {
            return null;
        }
    }

    private findExeInDir(dir: string): string | null {
        if (!fs.existsSync(dir)) return null;

        try {
            const entries = fs.readdirSync(dir);
            // Prefer exe files that match directory name
            const dirName = path.basename(dir).toLowerCase();

            for (const entry of entries) {
                if (entry.toLowerCase().endsWith('.exe')) {
                    if (entry.toLowerCase().includes(dirName)) {
                        return path.join(dir, entry);
                    }
                }
            }

            // Just return first exe found
            for (const entry of entries) {
                if (entry.toLowerCase().endsWith('.exe')) {
                    return path.join(dir, entry);
                }
            }
        } catch {
            // Permission denied
        }

        return null;
    }

    private generateAppId(name: string): string {
        return name.toLowerCase()
            .replace(/[^a-z0-9]+/g, '.')
            .replace(/^\.+|\.+$/g, '');
    }

    private runPowerShell(script: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const ps = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', script]);

            let stdout = '';
            let stderr = '';

            ps.stdout.on('data', d => stdout += d);
            ps.stderr.on('data', d => stderr += d);

            ps.on('close', (code) => {
                if (code !== 0 && stderr) {
                    reject(new Error(stderr));
                } else {
                    resolve(stdout.trim());
                }
            });

            ps.on('error', reject);
        });
    }

    /**
     * Remember a successful app path
     */
    rememberSuccess(appId: string, appInfo: AppInfo): void {
        agentMemory.remember({
            type: 'app_path',
            key: appId,
            content: appInfo,
            source: 'app_launch_success',
            confidence: 1.0,
            tags: ['app', appInfo.source]
        });
    }

    /**
     * Record a launch failure
     */
    recordFailure(appId: string, error: string): void {
        // Lower confidence of cached entry if exists
        const entry = this.findInCache(appId);
        if (entry) {
            entry.confidence = Math.max(0.1, entry.confidence - 0.2);
            this.saveCache();
        }
    }

    /**
     * Get all cached apps
     */
    getAll(): AppInfo[] {
        return this.cache.apps;
    }

    /**
     * Force refresh cache
     */
    async refresh(): Promise<AppInfo[]> {
        this.cache.lastScan = 0;
        return this.scan();
    }
}

// Singleton export
export const appRegistry = new AppRegistry();
