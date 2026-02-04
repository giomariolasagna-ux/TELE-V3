// Skills Runtime - Load and execute skills

import { globalSkillsRegistry, SkillMetadata } from './registry';
import { globalEventBus, BusEventType } from '../event_bus';

export interface SkillInstance {
    metadata: SkillMetadata;
    execute(params?: any): Promise<any>;
}

class SkillsRuntime {
    private loadedSkills: Map<string, SkillInstance> = new Map();

    async loadSkill(skillId: string): Promise<SkillInstance | undefined> {
        const metadata = globalSkillsRegistry.get(skillId);
        if (!metadata) {
            console.error(`[SkillsRuntime] Skill not found: ${skillId}`);
            return undefined;
        }

        // For now, create a stub instance
        const instance: SkillInstance = {
            metadata,
            execute: async (params?: any) => {
                globalEventBus.emitEvent(BusEventType.TIMELINE_EVENT, {
                    description: `Executing skill: ${metadata.name}`,
                    metadata: { skillId, params }
                });

                // Skill execution logic would go here
                console.log(`[SkillsRuntime] Executing: ${metadata.name}`);

                return { success: true, skillId };
            }
        };

        this.loadedSkills.set(skillId, instance);
        return instance;
    }

    async executeSkill(skillId: string, params?: any): Promise<any> {
        let instance = this.loadedSkills.get(skillId);

        if (!instance) {
            instance = await this.loadSkill(skillId);
        }

        if (!instance) {
            throw new Error(`Could not load skill: ${skillId}`);
        }

        return instance.execute(params);
    }

    getLoadedSkills(): string[] {
        return Array.from(this.loadedSkills.keys());
    }
}

export const globalSkillsRuntime = new SkillsRuntime();
