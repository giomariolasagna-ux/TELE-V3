/**
 * Spotify Skill - Music playback control
 * Refactored from SpotifyDriver to SkillCard format
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

const PlayUriParams = z.object({
    uri: z.string().describe('Spotify URI (e.g., spotify:track:xxx, spotify:album:xxx, spotify:playlist:xxx)')
});

const SearchParams = z.object({
    query: z.string().describe('Search query'),
    type: z.enum(['track', 'album', 'artist', 'playlist']).optional().default('track')
});

const VolumeParams = z.object({
    level: z.number().min(0).max(100).describe('Volume level (0-100)')
});

// =============================================================================
// Media Key Simulation (PowerShell/SendKeys approach)
// =============================================================================

async function sendMediaKey(key: 'play_pause' | 'next' | 'previous' | 'stop' | 'volume_up' | 'volume_down'): Promise<void> {
    // Using nircmd for reliable media key simulation
    // Fallback to Add-Type if nircmd not available
    const keyMap: Record<string, string> = {
        play_pause: '0xB3',  // VK_MEDIA_PLAY_PAUSE
        next: '0xB0',        // VK_MEDIA_NEXT_TRACK
        previous: '0xB1',    // VK_MEDIA_PREV_TRACK
        stop: '0xB2',        // VK_MEDIA_STOP
        volume_up: '0xAF',   // VK_VOLUME_UP
        volume_down: '0xAE'  // VK_VOLUME_DOWN
    };

    const keyCode = keyMap[key];

    // Use Add-Type to call keybd_event
    const script = `
    Add-Type -TypeDefinition @'
    using System;
    using System.Runtime.InteropServices;
    public class KeyboardHelper {
        [DllImport("user32.dll")]
        public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
        public static void SendMediaKey(int keyCode) {
            keybd_event((byte)keyCode, 0, 0, UIntPtr.Zero);
            keybd_event((byte)keyCode, 0, 2, UIntPtr.Zero); // KEYEVENTF_KEYUP
        }
    }
'@
    [KeyboardHelper]::SendMediaKey(${keyCode})
    `;

    await execAsync(`powershell -NoProfile -Command "${script.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`);
}

// =============================================================================
// Skill Definition
// =============================================================================

export const spotifySkill: SkillCard = defineSkill()
    .id('skill.spotify')
    .name('Spotify')
    .version('1.0.0')
    .description('Spotify music playback control via URI schemes and media keys')
    .author('TELE God Mode')
    .category('media')
    .tags('spotify', 'music', 'audio', 'playback', 'media')

    .action({
        name: 'launch',
        description: 'Launch Spotify',
        parameters: z.object({}),
        estimatedDurationMs: 2000,
        execute: async (params, context) => {
            const startTime = Date.now();
            try {
                context.logger.info('Launching Spotify...');

                // Use protocol handler - works for both installed and store version
                const open = (await import('open')).default;
                await open('spotify:');

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
        name: 'playUri',
        description: 'Play a Spotify URI (track, album, playlist, artist)',
        parameters: PlayUriParams,
        estimatedDurationMs: 1500,
        execute: async (params, context) => {
            const startTime = Date.now();
            try {
                context.logger.info(`Playing: ${params.uri}`);

                const open = (await import('open')).default;
                await open(params.uri);

                return {
                    success: true,
                    data: { playing: true, uri: params.uri },
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
        name: 'search',
        description: 'Open Spotify search with query',
        parameters: SearchParams,
        estimatedDurationMs: 1500,
        execute: async (params, context) => {
            const startTime = Date.now();
            try {
                context.logger.info(`Searching: ${params.query}`);

                const searchUri = `spotify:search:${encodeURIComponent(params.query)}`;
                const open = (await import('open')).default;
                await open(searchUri);

                return {
                    success: true,
                    data: { searching: true, query: params.query },
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
        name: 'playPause',
        description: 'Toggle play/pause',
        parameters: z.object({}),
        estimatedDurationMs: 500,
        execute: async (params, context) => {
            const startTime = Date.now();
            try {
                context.logger.info('Toggling play/pause...');
                await sendMediaKey('play_pause');

                return {
                    success: true,
                    data: { toggled: true },
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
        name: 'nextTrack',
        description: 'Skip to next track',
        parameters: z.object({}),
        estimatedDurationMs: 500,
        execute: async (params, context) => {
            const startTime = Date.now();
            try {
                context.logger.info('Skipping to next track...');
                await sendMediaKey('next');

                return {
                    success: true,
                    data: { skipped: true, direction: 'next' },
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
        name: 'previousTrack',
        description: 'Go to previous track',
        parameters: z.object({}),
        estimatedDurationMs: 500,
        execute: async (params, context) => {
            const startTime = Date.now();
            try {
                context.logger.info('Going to previous track...');
                await sendMediaKey('previous');

                return {
                    success: true,
                    data: { skipped: true, direction: 'previous' },
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
        name: 'volumeUp',
        description: 'Increase volume',
        parameters: z.object({}),
        estimatedDurationMs: 300,
        execute: async (params, context) => {
            const startTime = Date.now();
            try {
                await sendMediaKey('volume_up');
                return {
                    success: true,
                    data: { volumeChanged: true, direction: 'up' },
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
        name: 'volumeDown',
        description: 'Decrease volume',
        parameters: z.object({}),
        estimatedDurationMs: 300,
        execute: async (params, context) => {
            const startTime = Date.now();
            try {
                await sendMediaKey('volume_down');
                return {
                    success: true,
                    data: { volumeChanged: true, direction: 'down' },
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
        description: 'Close Spotify',
        parameters: z.object({}),
        estimatedDurationMs: 1000,
        execute: async (params, context) => {
            const startTime = Date.now();
            try {
                await execAsync('taskkill /IM Spotify.exe /F');
                return {
                    success: true,
                    data: { closed: true },
                    durationMs: Date.now() - startTime
                };
            } catch (error: any) {
                // Spotify might not be running
                return {
                    success: true,
                    data: { closed: true, note: 'Spotify may not have been running' },
                    durationMs: Date.now() - startTime
                } as any;
            }
        }
    })

    .healthCheck(async (): Promise<HealthStatus> => {
        try {
            // Check if Spotify URI scheme is registered
            const { stdout } = await execAsync(
                'powershell -NoProfile -Command "(Get-ItemProperty \'HKCU:\\Software\\Classes\\spotify\' -ErrorAction SilentlyContinue).\'(default)\'"'
            );

            if (stdout.includes('URL:spotify')) {
                return {
                    status: 'healthy',
                    message: 'Spotify URI scheme registered',
                    lastCheck: Date.now()
                };
            }

            return {
                status: 'degraded',
                message: 'Spotify may not be installed - URI scheme not found',
                lastCheck: Date.now()
            };
        } catch (error: any) {
            return {
                status: 'degraded',
                message: 'Could not verify Spotify installation',
                lastCheck: Date.now()
            };
        }
    })

    .build();

// =============================================================================
// Legacy Adapter
// =============================================================================

export class SpotifySkillAdapter {
    name = spotifySkill.name;
    appId = 'spotify';

    async isInstalled(): Promise<boolean> {
        const health = await spotifySkill.healthCheck();
        return health.status !== 'unhealthy';
    }

    async launch(): Promise<void> {
        const action = spotifySkill.actions.find(a => a.name === 'launch');
        if (action) {
            const result = await action.execute({}, this.createContext());
            if (!result.success) throw new Error(result.error);
        }
    }

    async execute(command: string, args?: any): Promise<any> {
        // Map legacy commands to new action names
        const commandMap: Record<string, string> = {
            'play_uri': 'playUri',
            'next_track': 'nextTrack',
            'play_pause': 'playPause',
            'previous_track': 'previousTrack'
        };

        const actionName = commandMap[command] || command;
        const action = spotifySkill.actions.find(a => a.name === actionName);

        if (!action) {
            throw new Error(`Unknown command: ${command}`);
        }

        return action.execute(args || {}, this.createContext());
    }

    async close(): Promise<void> {
        const action = spotifySkill.actions.find(a => a.name === 'close');
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

export default spotifySkill;
