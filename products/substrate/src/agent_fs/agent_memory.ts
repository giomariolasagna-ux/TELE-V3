/**
 * Agent Memory - Vector-based Knowledge Store
 * Stores learned patterns, skills, and preferences with semantic search
 * Inspired by openclaw memory manager
 */

import * as fs from 'fs';
import * as path from 'path';
import { MEMORY_DIR, SKILL_MEMORY_DB } from './agent_paths';

export interface MemoryEntry {
    id: string;
    type: 'skill' | 'pattern' | 'preference' | 'app_path' | 'flow';
    key: string;           // Normalized key for exact matching
    content: any;          // The actual stored data
    metadata: {
        source: string;    // Where this memory came from
        confidence: number; // 0-1, how confident we are in this memory
        usageCount: number;
        lastUsed: number;
        createdAt: number;
    };
    tags: string[];
}

interface MemoryStore {
    version: number;
    entries: MemoryEntry[];
}

export class AgentMemory {
    private storePath: string;
    private data: MemoryStore;

    constructor(storePath?: string) {
        this.storePath = storePath || path.join(MEMORY_DIR, 'agent_memory.json');
        this.data = this.load();
    }

    private load(): MemoryStore {
        try {
            if (fs.existsSync(this.storePath)) {
                const raw = fs.readFileSync(this.storePath, 'utf8');
                return JSON.parse(raw);
            }
        } catch (error) {
            console.error('[AgentMemory] Failed to load:', error);
        }
        return { version: 1, entries: [] };
    }

    private save(): void {
        try {
            const dir = path.dirname(this.storePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(this.storePath, JSON.stringify(this.data, null, 2));
        } catch (error) {
            console.error('[AgentMemory] Failed to save:', error);
        }
    }

    private normalize(key: string): string {
        return key.toLowerCase().trim().replace(/\s+/g, ' ');
    }

    private generateId(): string {
        return `mem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Remember something - store in memory
     */
    remember(params: {
        type: MemoryEntry['type'];
        key: string;
        content: any;
        source: string;
        confidence?: number;
        tags?: string[];
    }): MemoryEntry {
        const normalizedKey = this.normalize(params.key);

        // Check if exists
        const existing = this.data.entries.find(e =>
            e.type === params.type && e.key === normalizedKey
        );

        if (existing) {
            // Update existing
            existing.content = params.content;
            existing.metadata.confidence = params.confidence ?? existing.metadata.confidence;
            existing.metadata.usageCount++;
            existing.metadata.lastUsed = Date.now();
            if (params.tags) {
                existing.tags = [...new Set([...existing.tags, ...params.tags])];
            }
            console.log(`[AgentMemory] Updated: ${params.type}/${normalizedKey}`);
            this.save();
            return existing;
        }

        // Create new
        const entry: MemoryEntry = {
            id: this.generateId(),
            type: params.type,
            key: normalizedKey,
            content: params.content,
            metadata: {
                source: params.source,
                confidence: params.confidence ?? 0.8,
                usageCount: 1,
                lastUsed: Date.now(),
                createdAt: Date.now()
            },
            tags: params.tags || []
        };

        this.data.entries.push(entry);
        console.log(`[AgentMemory] Remembered: ${params.type}/${normalizedKey}`);
        this.save();
        return entry;
    }

    /**
     * Recall - exact match lookup
     */
    recall(type: MemoryEntry['type'], key: string): MemoryEntry | null {
        const normalizedKey = this.normalize(key);
        const entry = this.data.entries.find(e =>
            e.type === type && e.key === normalizedKey
        );

        if (entry) {
            entry.metadata.usageCount++;
            entry.metadata.lastUsed = Date.now();
            this.save();
            console.log(`[AgentMemory] Recalled: ${type}/${normalizedKey}`);
        }

        return entry || null;
    }

    /**
     * Search - fuzzy search with scoring
     */
    search(params: {
        query: string;
        type?: MemoryEntry['type'];
        tags?: string[];
        limit?: number;
    }): Array<MemoryEntry & { score: number }> {
        const query = this.normalize(params.query);
        const queryWords = new Set(query.split(' '));
        const limit = params.limit ?? 10;

        let candidates = this.data.entries;

        // Filter by type
        if (params.type) {
            candidates = candidates.filter(e => e.type === params.type);
        }

        // Filter by tags
        if (params.tags && params.tags.length > 0) {
            candidates = candidates.filter(e =>
                params.tags!.some(tag => e.tags.includes(tag))
            );
        }

        // Score and sort
        const scored = candidates.map(entry => {
            const entryWords = new Set(entry.key.split(' '));
            const intersection = new Set([...queryWords].filter(w => entryWords.has(w)));
            const union = new Set([...queryWords, ...entryWords]);
            const jaccardScore = intersection.size / union.size;

            // Boost by confidence and recency
            const recencyBoost = Math.min(1, 1 / (1 + (Date.now() - entry.metadata.lastUsed) / (7 * 24 * 60 * 60 * 1000)));
            const score = jaccardScore * 0.6 + entry.metadata.confidence * 0.2 + recencyBoost * 0.2;

            return { ...entry, score };
        });

        return scored
            .filter(e => e.score > 0.1)
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);
    }

    /**
     * Forget - remove from memory
     */
    forget(id: string): boolean {
        const idx = this.data.entries.findIndex(e => e.id === id);
        if (idx >= 0) {
            const removed = this.data.entries.splice(idx, 1)[0];
            console.log(`[AgentMemory] Forgot: ${removed.type}/${removed.key}`);
            this.save();
            return true;
        }
        return false;
    }

    /**
     * Get entries by type
     */
    getByType(type: MemoryEntry['type']): MemoryEntry[] {
        return this.data.entries.filter(e => e.type === type);
    }

    /**
     * Get most used entries
     */
    getMostUsed(limit: number = 10): MemoryEntry[] {
        return [...this.data.entries]
            .sort((a, b) => b.metadata.usageCount - a.metadata.usageCount)
            .slice(0, limit);
    }

    /**
     * Get statistics
     */
    getStats(): {
        total: number;
        byType: Record<string, number>;
        avgConfidence: number;
    } {
        const byType: Record<string, number> = {};
        let totalConfidence = 0;

        for (const entry of this.data.entries) {
            byType[entry.type] = (byType[entry.type] || 0) + 1;
            totalConfidence += entry.metadata.confidence;
        }

        return {
            total: this.data.entries.length,
            byType,
            avgConfidence: this.data.entries.length > 0
                ? totalConfidence / this.data.entries.length
                : 0
        };
    }

    /**
     * Clear all entries of a type (for testing/reset)
     */
    clearType(type: MemoryEntry['type']): number {
        const before = this.data.entries.length;
        this.data.entries = this.data.entries.filter(e => e.type !== type);
        this.save();
        return before - this.data.entries.length;
    }
}

// Singleton export
export const agentMemory = new AgentMemory();
