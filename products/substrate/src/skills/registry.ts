// Skills Registry - Phase 11

export interface SkillMetadata {
    id: string;
    name: string;
    description: string;
    version: string;
    enabled: boolean;
    entrypoint: string;
    uiHook?: string;
}

class SkillsRegistry {
    private skills: Map<string, SkillMetadata> = new Map();

    register(skill: SkillMetadata) {
        this.skills.set(skill.id, skill);
        console.log(`[SkillsRegistry] Registered: ${skill.name}`);
    }

    unregister(skillId: string) {
        this.skills.delete(skillId);
    }

    enable(skillId: string) {
        const skill = this.skills.get(skillId);
        if (skill) {
            skill.enabled = true;
        }
    }

    disable(skillId: string) {
        const skill = this.skills.get(skillId);
        if (skill) {
            skill.enabled = false;
        }
    }

    getEnabled(): SkillMetadata[] {
        return Array.from(this.skills.values()).filter(s => s.enabled);
    }

    getAll(): SkillMetadata[] {
        return Array.from(this.skills.values());
    }

    get(skillId: string): SkillMetadata | undefined {
        return this.skills.get(skillId);
    }
}

export const globalSkillsRegistry = new SkillsRegistry();

// Register built-in skills
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
