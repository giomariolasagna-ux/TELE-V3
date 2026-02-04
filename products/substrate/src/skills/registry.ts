/**
 * Skills Registry - Enhanced with SkillCard support
 * Phase 11 + God Mode Enhancements
 * 
 * Now supports:
 * - SkillCard registration with full typed metadata
 * - Autodiscovery hooks (for Challenge 2)
 * - Health check aggregation
 * - Dependency resolution
 */

import { SkillCard, HealthStatus } from './skill_card';

// =============================================================================
// Legacy Interface (maintained for compatibility)
// =============================================================================

export interface SkillMetadata {
    id: string;
    name: string;
    description: string;
    version: string;
    enabled: boolean;
    entrypoint: string;
    uiHook?: string;
}

// =============================================================================
// Enhanced Registry
// =============================================================================

interface RegistryEntry {
    skill: SkillCard;
    enabled: boolean;
    loadedAt: number;
    lastHealthCheck?: HealthStatus;
}

class EnhancedSkillsRegistry {
    private skills: Map<string, RegistryEntry> = new Map();
    private legacySkills: Map<string, SkillMetadata> = new Map();

    // -------------------------------------------------------------------------
    // SkillCard Registration
    // -------------------------------------------------------------------------

    /**
     * Register a SkillCard
     */
    registerSkillCard(skill: SkillCard, enabled = true): void {
        const entry: RegistryEntry = {
            skill,
            enabled,
            loadedAt: Date.now()
        };

        this.skills.set(skill.id, entry);
        console.log(`[SkillsRegistry] Registered SkillCard: ${skill.name} (${skill.id})`);
    }

    /**
     * Unregister a SkillCard
     */
    unregisterSkillCard(skillId: string): boolean {
        const existed = this.skills.has(skillId);
        this.skills.delete(skillId);
        return existed;
    }

    /**
     * Get a SkillCard by ID
     */
    getSkillCard(skillId: string): SkillCard | undefined {
        return this.skills.get(skillId)?.skill;
    }

    /**
     * Get all registered SkillCards
     */
    getAllSkillCards(): SkillCard[] {
        return Array.from(this.skills.values()).map(e => e.skill);
    }

    /**
     * Get enabled SkillCards
     */
    getEnabledSkillCards(): SkillCard[] {
        return Array.from(this.skills.values())
            .filter(e => e.enabled)
            .map(e => e.skill);
    }

    /**
     * Enable/disable a skill
     */
    setEnabled(skillId: string, enabled: boolean): boolean {
        const entry = this.skills.get(skillId);
        if (entry) {
            entry.enabled = enabled;
            return true;
        }
        return false;
    }

    /**
     * Check if a skill is enabled
     */
    isEnabled(skillId: string): boolean {
        return this.skills.get(skillId)?.enabled ?? false;
    }

    // -------------------------------------------------------------------------
    // Health Checks
    // -------------------------------------------------------------------------

    /**
     * Run health check for a single skill
     */
    async checkHealth(skillId: string): Promise<HealthStatus | undefined> {
        const entry = this.skills.get(skillId);
        if (!entry) return undefined;

        try {
            const status = await entry.skill.healthCheck();
            entry.lastHealthCheck = status;
            return status;
        } catch (error: any) {
            const status: HealthStatus = {
                status: 'unhealthy',
                message: error.message,
                lastCheck: Date.now()
            };
            entry.lastHealthCheck = status;
            return status;
        }
    }

    /**
     * Run health checks for all skills
     */
    async checkAllHealth(): Promise<Map<string, HealthStatus>> {
        const results = new Map<string, HealthStatus>();

        for (const [id, entry] of this.skills) {
            try {
                const status = await entry.skill.healthCheck();
                entry.lastHealthCheck = status;
                results.set(id, status);
            } catch (error: any) {
                const status: HealthStatus = {
                    status: 'unhealthy',
                    message: error.message,
                    lastCheck: Date.now()
                };
                entry.lastHealthCheck = status;
                results.set(id, status);
            }
        }

        return results;
    }

    /**
     * Get last health check result
     */
    getLastHealthCheck(skillId: string): HealthStatus | undefined {
        return this.skills.get(skillId)?.lastHealthCheck;
    }

    // -------------------------------------------------------------------------
    // Search & Discovery
    // -------------------------------------------------------------------------

    /**
     * Find skills by category
     */
    findByCategory(category: SkillCard['category']): SkillCard[] {
        return Array.from(this.skills.values())
            .filter(e => e.skill.category === category)
            .map(e => e.skill);
    }

    /**
     * Find skills by tag
     */
    findByTag(tag: string): SkillCard[] {
        const lowerTag = tag.toLowerCase();
        return Array.from(this.skills.values())
            .filter(e => e.skill.tags.some(t => t.toLowerCase().includes(lowerTag)))
            .map(e => e.skill);
    }

    /**
     * Search skills by name or description
     */
    search(query: string): SkillCard[] {
        const lowerQuery = query.toLowerCase();
        return Array.from(this.skills.values())
            .filter(e =>
                e.skill.name.toLowerCase().includes(lowerQuery) ||
                e.skill.description.toLowerCase().includes(lowerQuery) ||
                e.skill.tags.some(t => t.toLowerCase().includes(lowerQuery))
            )
            .map(e => e.skill);
    }

    /**
     * Find a skill that can perform a specific action
     */
    findByAction(actionName: string): SkillCard[] {
        return Array.from(this.skills.values())
            .filter(e => e.skill.actions.some(a => a.name === actionName))
            .map(e => e.skill);
    }

    // -------------------------------------------------------------------------
    // Dependency Resolution
    // -------------------------------------------------------------------------

    /**
     * Resolve dependencies for a skill
     */
    resolveDependencies(skillId: string): { resolved: SkillCard[]; missing: string[] } {
        const skill = this.getSkillCard(skillId);
        if (!skill) {
            return { resolved: [], missing: [skillId] };
        }

        const resolved: SkillCard[] = [];
        const missing: string[] = [];

        if (skill.dependencies) {
            for (const [depId, versionConstraint] of Object.entries(skill.dependencies)) {
                const dep = this.getSkillCard(depId);
                if (dep) {
                    // TODO: Version comparison
                    resolved.push(dep);
                } else {
                    missing.push(depId);
                }
            }
        }

        return { resolved, missing };
    }

    // -------------------------------------------------------------------------
    // Legacy API (backward compatibility)
    // -------------------------------------------------------------------------

    /**
     * @deprecated Use registerSkillCard instead
     */
    register(skill: SkillMetadata): void {
        this.legacySkills.set(skill.id, skill);
        console.log(`[SkillsRegistry] Registered (legacy): ${skill.name}`);
    }

    /**
     * @deprecated Use unregisterSkillCard instead
     */
    unregister(skillId: string): void {
        this.legacySkills.delete(skillId);
    }

    /**
     * @deprecated Use setEnabled instead
     */
    enable(skillId: string): void {
        const skill = this.legacySkills.get(skillId);
        if (skill) skill.enabled = true;
        this.setEnabled(skillId, true);
    }

    /**
     * @deprecated Use setEnabled instead
     */
    disable(skillId: string): void {
        const skill = this.legacySkills.get(skillId);
        if (skill) skill.enabled = false;
        this.setEnabled(skillId, false);
    }

    /**
     * @deprecated Use getEnabledSkillCards instead
     */
    getEnabled(): SkillMetadata[] {
        return Array.from(this.legacySkills.values()).filter(s => s.enabled);
    }

    /**
     * @deprecated Use getAllSkillCards instead
     */
    getAll(): SkillMetadata[] {
        return Array.from(this.legacySkills.values());
    }

    /**
     * @deprecated Use getSkillCard instead
     */
    get(skillId: string): SkillMetadata | undefined {
        return this.legacySkills.get(skillId);
    }

    // -------------------------------------------------------------------------
    // Statistics
    // -------------------------------------------------------------------------

    getStats(): {
        total: number;
        enabled: number;
        byCategory: Record<string, number>;
        healthy: number;
        unhealthy: number;
    } {
        const entries = Array.from(this.skills.values());
        const byCategory: Record<string, number> = {};

        for (const entry of entries) {
            const cat = entry.skill.category;
            byCategory[cat] = (byCategory[cat] || 0) + 1;
        }

        return {
            total: entries.length,
            enabled: entries.filter(e => e.enabled).length,
            byCategory,
            healthy: entries.filter(e => e.lastHealthCheck?.status === 'healthy').length,
            unhealthy: entries.filter(e => e.lastHealthCheck?.status === 'unhealthy').length
        };
    }
}

// =============================================================================
// Singleton Export
// =============================================================================

export const globalSkillsRegistry = new EnhancedSkillsRegistry();

// =============================================================================
// Register Built-in Skills
// =============================================================================

// Import and register all built-in skills
import { explorerSkill } from '../nodes/apps/explorer_skill';
import { photoshopSkill, illustratorSkill } from '../nodes/apps/adobe_skill';
import { blenderSkill } from '../nodes/apps/blender_skill';
import { spotifySkill } from '../nodes/apps/spotify_skill';
import { wordSkill, excelSkill, powerpointSkill } from '../nodes/apps/office_skill';

// Register all app skills
globalSkillsRegistry.registerSkillCard(explorerSkill);
globalSkillsRegistry.registerSkillCard(photoshopSkill);
globalSkillsRegistry.registerSkillCard(illustratorSkill);
globalSkillsRegistry.registerSkillCard(blenderSkill);
globalSkillsRegistry.registerSkillCard(spotifySkill);
globalSkillsRegistry.registerSkillCard(wordSkill);
globalSkillsRegistry.registerSkillCard(excelSkill);
globalSkillsRegistry.registerSkillCard(powerpointSkill);

// Legacy registrations for backward compatibility
globalSkillsRegistry.register({
    id: 'scan_temp',
    name: 'Scan Temp',
    description: 'Scans temporary directories for cleanup opportunities',
    version: '1.0.0',
    enabled: true,
    entrypoint: 'skills/scan_temp/index.ts'
});

globalSkillsRegistry.register({
    id: 'optimize_disk',
    name: 'Optimize Disk',
    description: 'Runs disk optimization and cleanup routines',
    version: '1.0.0',
    enabled: true,
    entrypoint: 'skills/optimize_disk/index.ts'
});

console.log(`[SkillsRegistry] Initialized with ${globalSkillsRegistry.getStats().total} skills`);
