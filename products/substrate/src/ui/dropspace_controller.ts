/**
 * DropSpace Controller - Drag-drop content routing
 * Part of God Mode System - Challenge 13
 * 
 * Features:
 * - Content type detection (image, PDF, audio, folder, URL)
 * - Automatic skill routing based on content type
 * - Custom routing rules
 * - Visual feedback events
 * - Drop zone management
 */

import { EventEmitter } from 'events';
import * as path from 'path';
import * as fs from 'fs';
import { globalSkillsRegistry } from '../skills/registry';
import { globalPlanner } from '../skills/planner';

// =============================================================================
// Types
// =============================================================================

export type ContentType =
    | 'image'
    | 'pdf'
    | 'document'
    | 'audio'
    | 'video'
    | 'folder'
    | 'url'
    | 'archive'
    | 'code'
    | 'unknown';

export interface DropItem {
    id: string;
    path?: string;
    url?: string;
    type: ContentType;
    mimeType?: string;
    name: string;
    size?: number;
    timestamp: number;
}

export interface RoutingRule {
    id: string;
    contentType: ContentType;
    skillId: string;
    actionName: string;
    params?: Record<string, any>;
    priority: number;
    condition?: (item: DropItem) => boolean;
}

export interface DropResult {
    item: DropItem;
    routed: boolean;
    skillId?: string;
    actionName?: string;
    result?: any;
    error?: string;
}

export interface DropZone {
    id: string;
    name: string;
    accepts: ContentType[];
    customHandler?: (item: DropItem) => Promise<void>;
}

// =============================================================================
// Content Detection
// =============================================================================

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg', '.ico', '.tiff'];
const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a', '.wma'];
const VIDEO_EXTENSIONS = ['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm'];
const DOCUMENT_EXTENSIONS = ['.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.rtf'];
const ARCHIVE_EXTENSIONS = ['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2'];
const CODE_EXTENSIONS = ['.js', '.ts', '.py', '.java', '.cpp', '.c', '.h', '.html', '.css', '.json', '.yaml', '.yml'];

function detectContentType(itemPath: string): ContentType {
    if (!itemPath) return 'unknown';

    // Check if it's a URL
    if (itemPath.startsWith('http://') || itemPath.startsWith('https://')) {
        return 'url';
    }

    // Check if it's a folder
    try {
        if (fs.existsSync(itemPath) && fs.statSync(itemPath).isDirectory()) {
            return 'folder';
        }
    } catch { }

    const ext = path.extname(itemPath).toLowerCase();

    if (ext === '.pdf') return 'pdf';
    if (IMAGE_EXTENSIONS.includes(ext)) return 'image';
    if (AUDIO_EXTENSIONS.includes(ext)) return 'audio';
    if (VIDEO_EXTENSIONS.includes(ext)) return 'video';
    if (DOCUMENT_EXTENSIONS.includes(ext)) return 'document';
    if (ARCHIVE_EXTENSIONS.includes(ext)) return 'archive';
    if (CODE_EXTENSIONS.includes(ext)) return 'code';

    return 'unknown';
}

function getMimeType(itemPath: string): string | undefined {
    const ext = path.extname(itemPath).toLowerCase();
    const mimeTypes: Record<string, string> = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.pdf': 'application/pdf',
        '.mp3': 'audio/mpeg',
        '.mp4': 'video/mp4',
        '.json': 'application/json',
        '.txt': 'text/plain',
        '.html': 'text/html',
    };
    return mimeTypes[ext];
}

// =============================================================================
// DropSpace Controller
// =============================================================================

export class DropSpaceController extends EventEmitter {
    private routingRules: RoutingRule[] = [];
    private dropZones: Map<string, DropZone> = new Map();
    private dropHistory: DropResult[] = [];
    private maxHistory = 100;

    constructor() {
        super();
        this.initializeDefaultRules();
    }

    // -------------------------------------------------------------------------
    // Default Routing Rules
    // -------------------------------------------------------------------------

    private initializeDefaultRules(): void {
        this.routingRules = [
            // Images → Illustrator or Photoshop
            {
                id: 'image-to-illustrator',
                contentType: 'image',
                skillId: 'skill.adobe.illustrator',
                actionName: 'openFile',
                priority: 10,
                condition: (item) => {
                    const ext = path.extname(item.path || '').toLowerCase();
                    return ['.svg', '.ai', '.eps'].includes(ext);
                }
            },
            {
                id: 'image-to-photoshop',
                contentType: 'image',
                skillId: 'skill.adobe.photoshop',
                actionName: 'openFile',
                priority: 5
            },

            // PDF → Word or default viewer
            {
                id: 'pdf-to-word',
                contentType: 'pdf',
                skillId: 'skill.office.word',
                actionName: 'openFile',
                priority: 5
            },

            // Audio → Transcription or Spotify
            {
                id: 'audio-to-player',
                contentType: 'audio',
                skillId: 'skill.spotify',
                actionName: 'playUri',
                priority: 5,
                params: { playLocal: true }
            },

            // Folders → Explorer
            {
                id: 'folder-to-explorer',
                contentType: 'folder',
                skillId: 'skill.explorer',
                actionName: 'navigate',
                priority: 10
            },

            // URLs → Browser
            {
                id: 'url-to-browser',
                contentType: 'url',
                skillId: 'skill.explorer',
                actionName: 'launch',
                priority: 10
            },

            // Video → Media player
            {
                id: 'video-to-player',
                contentType: 'video',
                skillId: 'skill.explorer',
                actionName: 'launch',
                priority: 5
            },

            // Documents → Office
            {
                id: 'doc-to-word',
                contentType: 'document',
                skillId: 'skill.office.word',
                actionName: 'openFile',
                priority: 5,
                condition: (item) => {
                    const ext = path.extname(item.path || '').toLowerCase();
                    return ['.doc', '.docx', '.txt', '.rtf'].includes(ext);
                }
            },
            {
                id: 'spreadsheet-to-excel',
                contentType: 'document',
                skillId: 'skill.office.excel',
                actionName: 'openFile',
                priority: 5,
                condition: (item) => {
                    const ext = path.extname(item.path || '').toLowerCase();
                    return ['.xls', '.xlsx', '.csv'].includes(ext);
                }
            },

            // Blender files
            {
                id: 'blend-to-blender',
                contentType: 'unknown',
                skillId: 'skill.blender',
                actionName: 'launch',
                priority: 10,
                condition: (item) => {
                    const ext = path.extname(item.path || '').toLowerCase();
                    return ext === '.blend';
                }
            }
        ];
    }

    // -------------------------------------------------------------------------
    // Drop Handling
    // -------------------------------------------------------------------------

    /**
     * Process a dropped item
     */
    async handleDrop(
        pathOrUrl: string,
        zoneId?: string
    ): Promise<DropResult> {
        const item: DropItem = {
            id: `drop_${Date.now()}`,
            path: pathOrUrl.startsWith('http') ? undefined : pathOrUrl,
            url: pathOrUrl.startsWith('http') ? pathOrUrl : undefined,
            type: detectContentType(pathOrUrl),
            mimeType: getMimeType(pathOrUrl),
            name: path.basename(pathOrUrl),
            timestamp: Date.now()
        };

        // Get file size if it's a file
        if (item.path && fs.existsSync(item.path)) {
            try {
                item.size = fs.statSync(item.path).size;
            } catch { }
        }

        this.emit('drop_start', item);
        console.log(`[DropSpace] Received: ${item.name} (${item.type})`);

        // Check for zone-specific handler
        if (zoneId) {
            const zone = this.dropZones.get(zoneId);
            if (zone?.customHandler) {
                try {
                    await zone.customHandler(item);
                    const result: DropResult = { item, routed: true };
                    this.addToHistory(result);
                    this.emit('drop_complete', result);
                    return result;
                } catch (error: any) {
                    const result: DropResult = {
                        item,
                        routed: false,
                        error: error.message
                    };
                    this.emit('drop_error', result);
                    return result;
                }
            }
        }

        // Find matching rule
        const rule = this.findMatchingRule(item);

        if (!rule) {
            const result: DropResult = {
                item,
                routed: false,
                error: `No routing rule for ${item.type}`
            };
            this.emit('drop_unrouted', result);
            this.addToHistory(result);
            return result;
        }

        // Execute the skill action
        try {
            const skill = globalSkillsRegistry.getSkillCard(rule.skillId);
            if (!skill) {
                throw new Error(`Skill not found: ${rule.skillId}`);
            }

            const action = skill.actions.find(a => a.name === rule.actionName);
            if (!action) {
                throw new Error(`Action not found: ${rule.actionName}`);
            }

            // Build params
            const params = {
                ...rule.params,
                path: item.path,
                url: item.url
            };

            // Create execution context
            const context = {
                sessionId: `dropspace_${Date.now()}`,
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

            const actionResult = await action.execute(params, context);

            const result: DropResult = {
                item,
                routed: true,
                skillId: rule.skillId,
                actionName: rule.actionName,
                result: actionResult
            };

            this.emit('drop_complete', result);
            this.addToHistory(result);
            console.log(`[DropSpace] Routed to ${rule.skillId}:${rule.actionName}`);

            return result;

        } catch (error: any) {
            const result: DropResult = {
                item,
                routed: false,
                skillId: rule.skillId,
                actionName: rule.actionName,
                error: error.message
            };

            this.emit('drop_error', result);
            this.addToHistory(result);

            return result;
        }
    }

    /**
     * Handle multiple drops
     */
    async handleMultipleDrop(paths: string[]): Promise<DropResult[]> {
        return Promise.all(paths.map(p => this.handleDrop(p)));
    }

    // -------------------------------------------------------------------------
    // Rule Management
    // -------------------------------------------------------------------------

    private findMatchingRule(item: DropItem): RoutingRule | undefined {
        // Filter rules by content type and condition
        const matching = this.routingRules
            .filter(rule => {
                if (rule.contentType !== item.type && rule.contentType !== 'unknown') {
                    return false;
                }
                if (rule.condition && !rule.condition(item)) {
                    return false;
                }
                // Check if skill exists
                if (!globalSkillsRegistry.getSkillCard(rule.skillId)) {
                    return false;
                }
                return true;
            })
            .sort((a, b) => b.priority - a.priority);

        return matching[0];
    }

    addRule(rule: RoutingRule): void {
        this.routingRules.push(rule);
        this.routingRules.sort((a, b) => b.priority - a.priority);
    }

    removeRule(ruleId: string): boolean {
        const idx = this.routingRules.findIndex(r => r.id === ruleId);
        if (idx >= 0) {
            this.routingRules.splice(idx, 1);
            return true;
        }
        return false;
    }

    getRules(): RoutingRule[] {
        return [...this.routingRules];
    }

    getRulesForType(type: ContentType): RoutingRule[] {
        return this.routingRules.filter(r => r.contentType === type);
    }

    // -------------------------------------------------------------------------
    // Drop Zone Management
    // -------------------------------------------------------------------------

    registerZone(zone: DropZone): void {
        this.dropZones.set(zone.id, zone);
        console.log(`[DropSpace] Zone registered: ${zone.name}`);
    }

    unregisterZone(zoneId: string): boolean {
        return this.dropZones.delete(zoneId);
    }

    getZones(): DropZone[] {
        return Array.from(this.dropZones.values());
    }

    // -------------------------------------------------------------------------
    // History
    // -------------------------------------------------------------------------

    private addToHistory(result: DropResult): void {
        this.dropHistory.unshift(result);
        if (this.dropHistory.length > this.maxHistory) {
            this.dropHistory.pop();
        }
    }

    getHistory(limit = 20): DropResult[] {
        return this.dropHistory.slice(0, limit);
    }

    clearHistory(): void {
        this.dropHistory = [];
    }

    // -------------------------------------------------------------------------
    // Content Type Detection API
    // -------------------------------------------------------------------------

    detectType(pathOrUrl: string): ContentType {
        return detectContentType(pathOrUrl);
    }

    getSupportedTypes(): ContentType[] {
        return ['image', 'pdf', 'document', 'audio', 'video', 'folder', 'url', 'archive', 'code'];
    }
}

// =============================================================================
// Singleton Export
// =============================================================================

export const globalDropSpace = new DropSpaceController();
