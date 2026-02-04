import { globalPlanner } from './planner';
import { initializeSkillScanner } from './skill_scanner';

export * from './skill_card';
export * from './registry';
export * from './skill_scanner';
export * from './planner';
export * from './telemetry';
export * from './cleanup_skill';
export * from './agent_coordinator';
export * from './skill_generator';
export * from './voice_fallback';
export * from './environment_skill';
export * from './mentor_system';

// Re-export skills
export { explorerSkill } from '../nodes/apps/explorer_skill';
export { photoshopSkill, illustratorSkill } from '../nodes/apps/adobe_skill';
export { blenderSkill } from '../nodes/apps/blender_skill';
export { spotifySkill } from '../nodes/apps/spotify_skill';
export { wordSkill, excelSkill, powerpointSkill } from '../nodes/apps/office_skill';
export { touchDesignerSkill } from '../nodes/apps/touchdesigner_skill';

/**
 * Quick Start Initialization
 */
export async function initializeGodMode(skillsDir = './skills'): Promise<void> {
    console.log('[GodMode] Initializing...');
    const scanner = initializeSkillScanner(skillsDir);
    const result = await scanner.scan();
    console.log(`[GodMode] ${result.registered} skills ready`);
    scanner.watch();
}

/**
 * Helper to execute a command through the global planner
 */
export async function executeCommand(input: string): Promise<any> {
    const plan = globalPlanner.createPlanFromNL(input);
    return globalPlanner.executePlan(plan);
}
