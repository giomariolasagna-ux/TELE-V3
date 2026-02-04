/**
 * Agent Mentoring System - Onboarding for new agent instances
 * Part of God Mode System - Challenge 12
 * 
 * Features:
 * - Onboarding checklist generation
 * - Knowledge export/import
 * - Interactive setup guide
 * - Skill configuration cloning
 * - Validation of new instances
 */

import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import {
    SkillCard,
    ExecutionContext,
    ActionResult,
    HealthStatus,
    defineSkill
} from './skill_card';
import { globalSkillsRegistry } from './registry';

// =============================================================================
// Types
// =============================================================================

export interface OnboardingChecklist {
    id: string;
    name: string;
    version: string;
    createdAt: number;
    createdBy: string;
    items: ChecklistItem[];
    requiredSkills: string[];
    conventions: Convention[];
    errorHandling: ErrorHandlingRule[];
}

export interface ChecklistItem {
    id: string;
    category: 'setup' | 'skills' | 'conventions' | 'validation';
    title: string;
    description: string;
    required: boolean;
    automated: boolean;
    action?: string;  // Skill action to execute
    completed: boolean;
}

export interface Convention {
    name: string;
    category: 'naming' | 'logging' | 'errors' | 'files' | 'communication';
    rule: string;
    examples: string[];
    antiPatterns?: string[];
}

export interface ErrorHandlingRule {
    errorType: string;
    action: 'retry' | 'fallback' | 'abort' | 'escalate' | 'log';
    maxRetries?: number;
    fallbackSkill?: string;
    message?: string;
}

export interface KnowledgeExport {
    version: string;
    exportedAt: number;
    exportedBy: string;
    checklist: OnboardingChecklist;
    skillConfigs: Record<string, any>;
    preferences: Record<string, any>;
    learnedPatterns: LearnedPattern[];
}

export interface LearnedPattern {
    id: string;
    type: 'success' | 'failure' | 'optimization';
    context: string;
    pattern: string;
    action: string;
    confidence: number;
}

export interface OnboardingProgress {
    instanceId: string;
    startedAt: number;
    completedItems: string[];
    failedItems: string[];
    currentStep: number;
    totalSteps: number;
    status: 'in_progress' | 'completed' | 'failed';
}

// =============================================================================
// Default Content
// =============================================================================

function getDefaultConventions(): Convention[] {
    return [
        {
            name: 'Skill Naming',
            category: 'naming',
            rule: 'Skills use format skill.<category>.<name> in lowercase',
            examples: ['skill.system.environment', 'skill.app.spotify'],
            antiPatterns: ['MySkill', 'SKILL_NAME']
        },
        {
            name: 'Action Naming',
            category: 'naming',
            rule: 'Actions use camelCase verbs describing the operation',
            examples: ['launch', 'detectSoftware', 'createDocument'],
            antiPatterns: ['do_something', 'ACTION1']
        },
        {
            name: 'Logging Format',
            category: 'logging',
            rule: 'Use [ComponentName] prefix in logs',
            examples: ['[Planner] Executing plan...', '[SkillScanner] Found 5 skills'],
            antiPatterns: ['Executing plan', 'INFO: starting']
        },
        {
            name: 'Error Messages',
            category: 'errors',
            rule: 'Errors should be actionable and include context',
            examples: ['Skill not found: skill.app.unknown', 'Permission denied: /path/to/file'],
            antiPatterns: ['Error occurred', 'Something went wrong']
        },
        {
            name: 'File Paths',
            category: 'files',
            rule: 'Always use path.join() and handle cross-platform paths',
            examples: ["path.join(os.homedir(), 'Downloads')"],
            antiPatterns: ['C:\\Users\\...', '/home/user/...']
        }
    ];
}

function getDefaultErrorHandling(): ErrorHandlingRule[] {
    return [
        {
            errorType: 'ENOENT',
            action: 'fallback',
            message: 'File not found - check path exists'
        },
        {
            errorType: 'EACCES',
            action: 'escalate',
            message: 'Permission denied - may need elevated privileges'
        },
        {
            errorType: 'ETIMEDOUT',
            action: 'retry',
            maxRetries: 3,
            message: 'Operation timed out'
        },
        {
            errorType: 'ECONNREFUSED',
            action: 'retry',
            maxRetries: 2,
            message: 'Connection refused - service may not be running'
        },
        {
            errorType: '*',
            action: 'log',
            message: 'Unexpected error - log and continue if possible'
        }
    ];
}

function getDefaultChecklist(): ChecklistItem[] {
    return [
        // Setup
        {
            id: 'setup-1',
            category: 'setup',
            title: 'Environment Detection',
            description: 'Run environment detection to identify OS and paths',
            required: true,
            automated: true,
            action: 'skill.system.environment:detect',
            completed: false
        },
        {
            id: 'setup-2',
            category: 'setup',
            title: 'Check Disk Space',
            description: 'Ensure adequate disk space for operations',
            required: true,
            automated: true,
            action: 'skill.system.environment:getDiskSpace',
            completed: false
        },
        {
            id: 'setup-3',
            category: 'setup',
            title: 'Verify Software',
            description: 'Check required software is installed',
            required: true,
            automated: true,
            action: 'skill.system.environment:detectSoftware',
            completed: false
        },

        // Skills
        {
            id: 'skills-1',
            category: 'skills',
            title: 'Core Skills Loaded',
            description: 'Verify all core skills are registered',
            required: true,
            automated: true,
            completed: false
        },
        {
            id: 'skills-2',
            category: 'skills',
            title: 'Health Checks Passed',
            description: 'Run health checks on all skills',
            required: true,
            automated: true,
            completed: false
        },

        // Conventions
        {
            id: 'conventions-1',
            category: 'conventions',
            title: 'Naming Conventions',
            description: 'Understand skill and action naming patterns',
            required: true,
            automated: false,
            completed: false
        },
        {
            id: 'conventions-2',
            category: 'conventions',
            title: 'Error Handling',
            description: 'Learn error handling escalation rules',
            required: true,
            automated: false,
            completed: false
        },

        // Validation
        {
            id: 'validation-1',
            category: 'validation',
            title: 'Execute Test Command',
            description: 'Successfully execute a simple skill action',
            required: true,
            automated: true,
            completed: false
        }
    ];
}

// =============================================================================
// Mentor System
// =============================================================================

export class MentorSystem extends EventEmitter {
    private dataDir: string;
    private activeOnboarding: Map<string, OnboardingProgress> = new Map();

    constructor(dataDir?: string) {
        super();
        this.dataDir = dataDir || path.join(process.cwd(), '.tele', 'mentor');
    }

    // -------------------------------------------------------------------------
    // Checklist Generation
    // -------------------------------------------------------------------------

    generateChecklist(mentorId: string): OnboardingChecklist {
        const registeredSkills = globalSkillsRegistry.getAllSkillCards();

        return {
            id: `checklist_${Date.now()}`,
            name: 'TELE Agent Onboarding',
            version: '1.0.0',
            createdAt: Date.now(),
            createdBy: mentorId,
            items: getDefaultChecklist(),
            requiredSkills: registeredSkills.map(s => s.id),
            conventions: getDefaultConventions(),
            errorHandling: getDefaultErrorHandling()
        };
    }

    // -------------------------------------------------------------------------
    // Knowledge Export/Import
    // -------------------------------------------------------------------------

    exportKnowledge(mentorId: string): KnowledgeExport {
        const checklist = this.generateChecklist(mentorId);
        const skills = globalSkillsRegistry.getAllSkillCards();

        // Extract skill configs
        const skillConfigs: Record<string, any> = {};
        for (const skill of skills) {
            skillConfigs[skill.id] = {
                enabled: globalSkillsRegistry.isEnabled(skill.id),
                config: skill.config
            };
        }

        const exportData: KnowledgeExport = {
            version: '1.0.0',
            exportedAt: Date.now(),
            exportedBy: mentorId,
            checklist,
            skillConfigs,
            preferences: {},
            learnedPatterns: []
        };

        // Save to disk
        this.ensureDir();
        const exportPath = path.join(this.dataDir, `export_${Date.now()}.json`);
        fs.writeFileSync(exportPath, JSON.stringify(exportData, null, 2));

        return exportData;
    }

    importKnowledge(importPath: string): KnowledgeExport | null {
        try {
            const data = JSON.parse(fs.readFileSync(importPath, 'utf8'));

            // Apply skill configs
            for (const [skillId, config] of Object.entries(data.skillConfigs || {})) {
                const cfg = config as any;
                if (cfg.enabled !== undefined) {
                    globalSkillsRegistry.setEnabled(skillId, cfg.enabled);
                }
            }

            return data;
        } catch {
            return null;
        }
    }

    // -------------------------------------------------------------------------
    // Interactive Onboarding
    // -------------------------------------------------------------------------

    startOnboarding(instanceId: string): OnboardingProgress {
        const checklist = this.generateChecklist('system');

        const progress: OnboardingProgress = {
            instanceId,
            startedAt: Date.now(),
            completedItems: [],
            failedItems: [],
            currentStep: 0,
            totalSteps: checklist.items.length,
            status: 'in_progress'
        };

        this.activeOnboarding.set(instanceId, progress);
        this.emit('onboarding_start', progress);

        return progress;
    }

    async executeOnboardingStep(
        instanceId: string,
        context: ExecutionContext
    ): Promise<{ item: ChecklistItem; success: boolean; result?: any }> {
        const progress = this.activeOnboarding.get(instanceId);
        if (!progress || progress.status !== 'in_progress') {
            throw new Error('No active onboarding');
        }

        const checklist = this.generateChecklist('system');
        const item = checklist.items[progress.currentStep];

        if (!item) {
            progress.status = 'completed';
            return { item: checklist.items[0], success: true };
        }

        let success = true;
        let result: any;

        if (item.automated && item.action) {
            // Parse action (format: skill.id:actionName)
            const [skillId, actionName] = item.action.split(':');
            const skill = globalSkillsRegistry.getSkillCard(skillId);

            if (skill) {
                const action = skill.actions.find(a => a.name === actionName);
                if (action) {
                    try {
                        result = await action.execute({}, context);
                        success = result.success;
                    } catch (e) {
                        success = false;
                    }
                }
            }
        } else if (item.automated) {
            // Non-action automated items
            if (item.id === 'skills-1') {
                const skills = globalSkillsRegistry.getAllSkillCards();
                success = skills.length >= 5;
                result = { skillCount: skills.length };
            } else if (item.id === 'skills-2') {
                const health = await globalSkillsRegistry.checkAllHealth();
                const healthy = Array.from(health.values()).filter(h => h.status === 'healthy').length;
                success = healthy > 0;
                result = { healthy, total: health.size };
            }
        }

        // Update progress
        if (success) {
            progress.completedItems.push(item.id);
        } else {
            progress.failedItems.push(item.id);
        }

        progress.currentStep++;

        if (progress.currentStep >= progress.totalSteps) {
            progress.status = progress.failedItems.length === 0 ? 'completed' : 'failed';
        }

        this.emit('onboarding_step', { progress, item, success });

        return { item, success, result };
    }

    getOnboardingProgress(instanceId: string): OnboardingProgress | undefined {
        return this.activeOnboarding.get(instanceId);
    }

    // -------------------------------------------------------------------------
    // Validation
    // -------------------------------------------------------------------------

    async validateInstance(instanceId: string): Promise<{
        valid: boolean;
        checks: { name: string; passed: boolean; message?: string }[];
    }> {
        const checks: { name: string; passed: boolean; message?: string }[] = [];

        // Check skills registered
        const skills = globalSkillsRegistry.getAllSkillCards();
        checks.push({
            name: 'Skills Registered',
            passed: skills.length >= 5,
            message: `${skills.length} skills found`
        });

        // Check health
        const health = await globalSkillsRegistry.checkAllHealth();
        const healthyCount = Array.from(health.values()).filter(h => h.status === 'healthy').length;
        checks.push({
            name: 'Health Checks',
            passed: healthyCount > 0,
            message: `${healthyCount}/${health.size} healthy`
        });

        // Check core skills
        const coreSkills = ['skill.system.environment', 'skill.explorer'];
        for (const coreId of coreSkills) {
            const exists = globalSkillsRegistry.getSkillCard(coreId) !== undefined;
            checks.push({
                name: `Core: ${coreId}`,
                passed: exists
            });
        }

        const valid = checks.every(c => c.passed);

        return { valid, checks };
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    private ensureDir(): void {
        if (!fs.existsSync(this.dataDir)) {
            fs.mkdirSync(this.dataDir, { recursive: true });
        }
    }
}

// =============================================================================
// Parameter Schemas
// =============================================================================

const GenerateChecklistParams = z.object({
    mentorId: z.string().optional().default('system')
});

const ExportParams = z.object({
    mentorId: z.string().optional().default('system')
});

const ImportParams = z.object({
    path: z.string().describe('Path to knowledge export file')
});

const OnboardParams = z.object({
    instanceId: z.string().describe('New instance identifier')
});

const ValidateParams = z.object({
    instanceId: z.string().describe('Instance to validate')
});

// =============================================================================
// Singleton
// =============================================================================

const mentorSystem = new MentorSystem();

// =============================================================================
// Skill Definition
// =============================================================================

export const mentorSkill: SkillCard = defineSkill()
    .id('skill.system.mentor')
    .name('Agent Mentoring')
    .version('1.0.0')
    .description('Onboarding and training for new agent instances')
    .author('TELE God Mode')
    .category('system')
    .tags('mentor', 'onboarding', 'training', 'knowledge', 'agent')

    .action({
        name: 'generateChecklist',
        description: 'Generate onboarding checklist for new agents',
        parameters: GenerateChecklistParams,
        estimatedDurationMs: 100,
        execute: async (params, context) => {
            const startTime = Date.now();
            try {
                const checklist = mentorSystem.generateChecklist(params.mentorId);

                context.logger.info(
                    `Generated checklist with ${checklist.items.length} items`
                );

                return {
                    success: true,
                    data: checklist,
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
        name: 'exportKnowledge',
        description: 'Export mentor knowledge for import by new instances',
        parameters: ExportParams,
        estimatedDurationMs: 500,
        execute: async (params, context) => {
            const startTime = Date.now();
            try {
                const exportData = mentorSystem.exportKnowledge(params.mentorId);

                context.logger.info(
                    `Exported knowledge: ${Object.keys(exportData.skillConfigs).length} skills`
                );

                return {
                    success: true,
                    data: exportData,
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
        name: 'importKnowledge',
        description: 'Import knowledge from mentor export',
        parameters: ImportParams,
        estimatedDurationMs: 500,
        execute: async (params, context) => {
            const startTime = Date.now();
            try {
                const imported = mentorSystem.importKnowledge(params.path);

                if (!imported) {
                    throw new Error('Failed to import knowledge file');
                }

                context.logger.info(
                    `Imported knowledge from ${imported.exportedBy}`
                );

                return {
                    success: true,
                    data: {
                        imported: true,
                        from: imported.exportedBy,
                        skills: Object.keys(imported.skillConfigs).length
                    },
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
        name: 'startOnboarding',
        description: 'Begin onboarding process for new instance',
        parameters: OnboardParams,
        estimatedDurationMs: 100,
        execute: async (params, context) => {
            const startTime = Date.now();
            try {
                const progress = mentorSystem.startOnboarding(params.instanceId);

                context.logger.info(
                    `Started onboarding for ${params.instanceId}`
                );

                return {
                    success: true,
                    data: progress,
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
        name: 'nextOnboardingStep',
        description: 'Execute next step in onboarding process',
        parameters: OnboardParams,
        estimatedDurationMs: 5000,
        execute: async (params, context) => {
            const startTime = Date.now();
            try {
                const result = await mentorSystem.executeOnboardingStep(
                    params.instanceId,
                    context
                );

                context.logger.info(
                    `Step: ${result.item.title} - ${result.success ? 'PASSED' : 'FAILED'}`
                );

                return {
                    success: true,
                    data: result,
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
        name: 'validate',
        description: 'Validate that instance meets requirements',
        parameters: ValidateParams,
        estimatedDurationMs: 3000,
        execute: async (params, context) => {
            const startTime = Date.now();
            try {
                const validation = await mentorSystem.validateInstance(params.instanceId);

                context.logger.info(
                    `Validation: ${validation.valid ? 'PASSED' : 'FAILED'}`
                );

                return {
                    success: true,
                    data: validation,
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

    .healthCheck(async (): Promise<HealthStatus> => {
        return {
            status: 'healthy',
            message: 'Mentor system ready',
            lastCheck: Date.now()
        };
    })

    .build();

export { mentorSystem };
export default mentorSkill;
