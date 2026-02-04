// System Scanner
// Discovers installed applications and capabilities using dynamic registry

import { AppDriver } from './app_driver';
import { appRegistry, AppInfo } from './app_registry';
import { agentMemory } from '../agent_fs/agent_memory';

// Driver factory - creates driver for known app types
type DriverFactory = (appInfo: AppInfo) => AppDriver | null;

/**
 * Generic App Driver - wrapper around AppInfo for basic launch/execute
 */
class GenericAppDriver implements AppDriver {
    name: string;
    appId: string;
    private appInfo: AppInfo;

    constructor(appInfo: AppInfo) {
        this.name = appInfo.name;
        this.appId = appInfo.id;
        this.appInfo = appInfo;
    }

    async isInstalled(): Promise<boolean> {
        return this.appInfo.executablePath !== null &&
            require('fs').existsSync(this.appInfo.executablePath);
    }

    async launch(): Promise<void> {
        if (!this.appInfo.executablePath) {
            throw new Error(`No executable path for ${this.name}`);
        }
        const { spawn } = require('child_process');
        spawn(this.appInfo.executablePath, [], { detached: true, stdio: 'ignore' }).unref();
    }

    async execute(command: string, args?: any): Promise<any> {
        // Generic apps only support launch
        if (command === 'launch') {
            await this.launch();
            return { success: true };
        }
        throw new Error(`Command '${command}' not supported for generic app ${this.name}`);
    }

    async close(): Promise<void> {
        const { exec } = require('child_process');
        const exeName = require('path').basename(this.appInfo.executablePath || '');
        if (exeName) {
            exec(`taskkill /IM "${exeName}" /F`);
        }
    }
}

export class SystemScanner {
    private driverFactories: Map<string, DriverFactory> = new Map();

    constructor() {
        this.registerDefaultFactories();
    }

    /**
     * Register specialized driver factories for known app types
     */
    private registerDefaultFactories(): void {
        // Adobe apps - use specialized driver for COM automation
        this.driverFactories.set('adobe.photoshop', (info) => {
            const { AdobeDriver } = require('./apps/adobe_driver');
            return new AdobeDriver('photoshop', info);
        });

        this.driverFactories.set('adobe.illustrator', (info) => {
            const { AdobeDriver } = require('./apps/adobe_driver');
            return new AdobeDriver('illustrator', info);
        });

        // Blender - specialized for Python scripting
        this.driverFactories.set('blender', (info) => {
            const { BlenderDriver } = require('./apps/blender_driver');
            return new BlenderDriver(info);
        });

        // Office apps - specialized for COM
        this.driverFactories.set('microsoft.word', (info) => {
            const { LinkWordDriver } = require('./apps/office_driver');
            return new LinkWordDriver(info);
        });

        // Spotify - uses URI protocol
        this.driverFactories.set('spotify', (info) => {
            const { SpotifyDriver } = require('./apps/spotify_driver');
            return new SpotifyDriver();
        });
    }

    /**
     * Scan for installed applications
     * Returns drivers for all found apps
     */
    async scan(): Promise<AppDriver[]> {
        const drivers: AppDriver[] = [];
        console.log('[SystemScanner] Starting dynamic scan...');

        // Trigger registry scan
        const apps = await appRegistry.scan();

        for (const appInfo of apps) {
            try {
                // Check if we have a specialized factory
                const factory = this.driverFactories.get(appInfo.id);

                let driver: AppDriver;
                if (factory) {
                    const specialized = factory(appInfo);
                    if (specialized) {
                        driver = specialized;
                    } else {
                        driver = new GenericAppDriver(appInfo);
                    }
                } else {
                    driver = new GenericAppDriver(appInfo);
                }

                // Verify installation
                if (await driver.isInstalled()) {
                    drivers.push(driver);
                    console.log(`[SystemScanner] Found: ${driver.name}`);
                }
            } catch (e) {
                console.error(`[SystemScanner] Error creating driver for ${appInfo.name}:`, e);
            }
        }

        console.log(`[SystemScanner] Scan complete. Found ${drivers.length} apps.`);
        return drivers;
    }

    /**
     * Find a specific app by name or ID
     */
    async findApp(query: string): Promise<AppDriver | null> {
        const appInfo = await appRegistry.resolve(query);
        if (!appInfo) return null;

        const factory = this.driverFactories.get(appInfo.id);
        if (factory) {
            const driver = factory(appInfo);
            if (driver) return driver;
        }

        return new GenericAppDriver(appInfo);
    }

    /**
     * Register a custom driver factory
     */
    registerFactory(appId: string, factory: DriverFactory): void {
        this.driverFactories.set(appId, factory);
    }
}

