/**
 * Skill Log - Knowledge Distillation Memory
 * Records successful task completions from Kimi (Smart) for Llama (Fast) to learn
 */

import * as fs from 'fs';
import * as path from 'path';

export interface Skill {
    id: string;
    input: string;              // Original user request
    normalizedInput: string;    // Lowercase, trimmed version for matching
    output: any;                // The action object generated
    model: string;              // Which model generated this (e.g., 'kimi-k2.5')
    success: boolean;           // Whether execution succeeded
    timestamp: number;
    usageCount: number;         // How many times this skill was reused
}

export interface SkillLogData {
    version: number;
    skills: Skill[];
}

export class SkillLog {
    private logPath: string;
    private data: SkillLogData;
    private similarityThreshold: number = 0.8;  // For fuzzy matching

    constructor(logPath?: string) {
        const substrateRoot = path.resolve(__dirname, '..', '..');
        this.logPath = logPath || path.join(substrateRoot, '.tele', 'skill_log.json');
        this.data = this.load();
    }

    /**
     * Load skill log from disk
     */
    private load(): SkillLogData {
        try {
            if (fs.existsSync(this.logPath)) {
                const raw = fs.readFileSync(this.logPath, 'utf8');
                return JSON.parse(raw);
            }
        } catch (error) {
            console.error('[SkillLog] Failed to load:', error);
        }
        return { version: 1, skills: [] };
    }

    /**
     * Save skill log to disk
     */
    private save(): void {
        try {
            const dir = path.dirname(this.logPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(this.logPath, JSON.stringify(this.data, null, 2));
        } catch (error) {
            console.error('[SkillLog] Failed to save:', error);
        }
    }

    /**
     * Normalize input for comparison
     */
    private normalize(input: string): string {
        return input.toLowerCase().trim().replace(/\s+/g, ' ');
    }

    /**
     * Simple similarity score (Jaccard on words)
     */
    private similarity(a: string, b: string): number {
        const setA = new Set(a.split(' '));
        const setB = new Set(b.split(' '));
        const intersection = new Set([...setA].filter(x => setB.has(x)));
        const union = new Set([...setA, ...setB]);
        return intersection.size / union.size;
    }

    /**
     * Find a matching skill for the given input
     * Returns the skill if found, null otherwise
     */
    find(input: string): Skill | null {
        const normalized = this.normalize(input);

        // First: exact match
        const exact = this.data.skills.find(s =>
            s.normalizedInput === normalized && s.success
        );
        if (exact) {
            console.log(`[SkillLog] Exact match found: "${exact.input.substring(0, 30)}..."`);
            return exact;
        }

        // Second: fuzzy match
        let bestMatch: Skill | null = null;
        let bestScore = 0;

        for (const skill of this.data.skills) {
            if (!skill.success) continue;

            const score = this.similarity(normalized, skill.normalizedInput);
            if (score > this.similarityThreshold && score > bestScore) {
                bestScore = score;
                bestMatch = skill;
            }
        }

        if (bestMatch) {
            console.log(`[SkillLog] Fuzzy match found (${(bestScore * 100).toFixed(0)}%): "${bestMatch.input.substring(0, 30)}..."`);
        }

        return bestMatch;
    }

    /**
     * Record a new skill (or update existing)
     */
    record(input: string, output: any, model: string, success: boolean): void {
        const normalized = this.normalize(input);
        const existing = this.data.skills.find(s => s.normalizedInput === normalized);

        if (existing) {
            // Update existing
            existing.output = output;
            existing.model = model;
            existing.success = success;
            existing.timestamp = Date.now();
            existing.usageCount++;
            console.log(`[SkillLog] Updated skill: "${input.substring(0, 30)}..." (uses: ${existing.usageCount})`);
        } else {
            // Add new
            const skill: Skill = {
                id: `skill_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                input,
                normalizedInput: normalized,
                output,
                model,
                success,
                timestamp: Date.now(),
                usageCount: 1
            };
            this.data.skills.push(skill);
            console.log(`[SkillLog] New skill recorded: "${input.substring(0, 30)}..."`);
        }

        this.save();
    }

    /**
     * Mark a skill as used (increment usage count)
     */
    markUsed(skillId: string): void {
        const skill = this.data.skills.find(s => s.id === skillId);
        if (skill) {
            skill.usageCount++;
            skill.timestamp = Date.now();
            this.save();
        }
    }

    /**
     * Get all skills sorted by usage count
     */
    getTopSkills(limit: number = 10): Skill[] {
        return [...this.data.skills]
            .filter(s => s.success)
            .sort((a, b) => b.usageCount - a.usageCount)
            .slice(0, limit);
    }

    /**
     * Get statistics
     */
    getStats(): { total: number; successful: number; topSkill: string | null } {
        const successful = this.data.skills.filter(s => s.success);
        const top = this.getTopSkills(1)[0];
        return {
            total: this.data.skills.length,
            successful: successful.length,
            topSkill: top ? top.input : null
        };
    }

    /**
     * Clear all skills (for testing)
     */
    clear(): void {
        this.data.skills = [];
        this.save();
    }
}

// Export singleton
export const skillLog = new SkillLog();
