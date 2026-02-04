/**
 * Natural Language Skill Generator - Create skills from descriptions
 * Part of God Mode System - Challenge 7
 * 
 * Features:
 * - Parse natural language skill descriptions
 * - Generate SkillCard skeletons
 * - Infer parameters and types
 * - Create action stubs
 */

import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { SkillCard, SkillAction, SkillCategory } from './skill_card';

// =============================================================================
// Types
// =============================================================================

export interface SkillDescription {
    name: string;
    description: string;
    category?: string;
    actions: ActionDescription[];
}

export interface ActionDescription {
    name: string;
    description: string;
    parameters?: ParameterDescription[];
    returns?: string;
}

export interface ParameterDescription {
    name: string;
    type: 'string' | 'number' | 'boolean' | 'array' | 'object';
    description?: string;
    required?: boolean;
    default?: any;
}

export interface GeneratedSkill {
    code: string;
    manifest: string;
    path: string;
}

// =============================================================================
// NL Parser
// =============================================================================

export class NLSkillParser {
    /**
     * Parse a natural language description into a structured skill description
     */
    parse(input: string): SkillDescription {
        const lines = input.split('\n').map(l => l.trim()).filter(l => l);

        // Extract skill name and description
        const firstLine = lines[0];
        let name = 'NewSkill';
        let description = '';

        // Pattern: "Create a skill that..." or "A skill for..."
        const nameMatch = firstLine.match(/(?:create\s+)?(?:a\s+)?skill\s+(?:called|named|for)\s+['"]?([^'"]+)['"]?/i);
        if (nameMatch) {
            name = this.toPascalCase(nameMatch[1]);
        } else {
            // Use first noun phrase as name
            const nounMatch = firstLine.match(/(?:a|an|the)\s+(\w+(?:\s+\w+)?)\s+skill/i);
            if (nounMatch) {
                name = this.toPascalCase(nounMatch[1]);
            }
        }

        description = firstLine;

        // Parse actions
        const actions: ActionDescription[] = [];
        let currentAction: ActionDescription | null = null;

        for (let i = 1; i < lines.length; i++) {
            const line = lines[i];

            // Action patterns
            const actionMatch = line.match(/^-?\s*(?:it\s+)?(?:should|can|will|must)?\s*(\w+)\s*(.*)$/i) ||
                line.match(/^-?\s*action:\s*(\w+)\s*-?\s*(.*)$/i) ||
                line.match(/^-?\s*(\w+):\s*(.*)$/i);

            if (actionMatch) {
                const actionName = this.toCamelCase(actionMatch[1]);
                const actionDesc = actionMatch[2] || actionMatch[1];

                // Skip common non-action words
                if (['the', 'it', 'with', 'and', 'or', 'be'].includes(actionName)) continue;

                currentAction = {
                    name: actionName,
                    description: actionDesc,
                    parameters: this.inferParameters(actionDesc)
                };
                actions.push(currentAction);
            }
            // Parameter patterns (indented or prefixed)
            else if (currentAction && (line.startsWith('  ') || line.startsWith('- param'))) {
                const paramMatch = line.match(/(?:param(?:eter)?:?\s*)?(\w+)\s*(?:\((\w+)\))?\s*[-:]?\s*(.*)/i);
                if (paramMatch) {
                    const paramName = paramMatch[1];
                    const paramType = paramMatch[2] || 'string';
                    const paramDesc = paramMatch[3];

                    if (!currentAction.parameters) currentAction.parameters = [];
                    currentAction.parameters.push({
                        name: this.toCamelCase(paramName),
                        type: this.normalizeType(paramType),
                        description: paramDesc,
                        required: !line.includes('optional')
                    });
                }
            }
        }

        // If no actions found, create a default 'execute' action
        if (actions.length === 0) {
            actions.push({
                name: 'execute',
                description: description,
                parameters: this.inferParameters(description)
            });
        }

        // Infer category
        const category = this.inferCategory(name, description);

        return {
            name,
            description,
            category,
            actions
        };
    }

    private inferParameters(text: string): ParameterDescription[] {
        const params: ParameterDescription[] = [];

        // Common parameter patterns
        const patterns: [RegExp, ParameterDescription][] = [
            [/(?:file|path)\s*(?:to|of)?/i, { name: 'path', type: 'string', description: 'File or directory path' }],
            [/(?:url|link|address)/i, { name: 'url', type: 'string', description: 'URL address' }],
            [/(?:text|message|content)/i, { name: 'text', type: 'string', description: 'Text content' }],
            [/(?:number|count|amount)/i, { name: 'value', type: 'number', description: 'Numeric value' }],
            [/(?:name|title|label)/i, { name: 'name', type: 'string', description: 'Name or title' }],
            [/(?:enable|disable|toggle)/i, { name: 'enabled', type: 'boolean', description: 'Enable state' }],
        ];

        for (const [pattern, param] of patterns) {
            if (pattern.test(text) && !params.some(p => p.name === param.name)) {
                params.push({ ...param });
            }
        }

        return params;
    }

    private inferCategory(name: string, description: string): string {
        const text = `${name} ${description}`.toLowerCase();

        if (/file|folder|directory|disk|storage/.test(text)) return 'system';
        if (/audio|video|music|media|stream/.test(text)) return 'media';
        if (/network|http|api|request|server/.test(text)) return 'integration';
        if (/process|memory|cpu|performance/.test(text)) return 'system';
        if (/app|application|program|software/.test(text)) return 'app';
        if (/automat|script|task|workflow/.test(text)) return 'automation';

        return 'automation';
    }

    private toPascalCase(str: string): string {
        return str
            .replace(/[^a-zA-Z0-9]+/g, ' ')
            .split(' ')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
            .join('');
    }

    private toCamelCase(str: string): string {
        const pascal = this.toPascalCase(str);
        return pascal.charAt(0).toLowerCase() + pascal.slice(1);
    }

    private normalizeType(type: string): ParameterDescription['type'] {
        const t = type.toLowerCase();
        if (['int', 'integer', 'float', 'double', 'number', 'num'].includes(t)) return 'number';
        if (['bool', 'boolean', 'flag'].includes(t)) return 'boolean';
        if (['array', 'list', 'items'].includes(t)) return 'array';
        if (['object', 'dict', 'map', 'json'].includes(t)) return 'object';
        return 'string';
    }
}

// =============================================================================
// Code Generator
// =============================================================================

export class SkillCodeGenerator {
    private outputDir: string;

    constructor(outputDir: string) {
        this.outputDir = outputDir;
    }

    generate(skillDesc: SkillDescription): GeneratedSkill {
        const skillId = `skill.custom.${skillDesc.name.toLowerCase()}`;
        const filename = `${skillDesc.name.toLowerCase()}_skill.ts`;
        const filepath = path.join(this.outputDir, filename);

        // Generate TypeScript code
        const code = this.generateTypeScript(skillDesc, skillId);

        // Generate YAML manifest
        const manifest = this.generateManifest(skillDesc, skillId, filename);

        return { code, manifest, path: filepath };
    }

    generateAndWrite(skillDesc: SkillDescription): GeneratedSkill {
        const result = this.generate(skillDesc);

        // Ensure output directory exists
        if (!fs.existsSync(this.outputDir)) {
            fs.mkdirSync(this.outputDir, { recursive: true });
        }

        // Write skill file
        fs.writeFileSync(result.path, result.code);

        // Write manifest
        const manifestPath = path.join(this.outputDir, 'skill.yaml');
        fs.writeFileSync(manifestPath, result.manifest);

        console.log(`[SkillGenerator] Generated skill at ${result.path}`);
        return result;
    }

    private generateTypeScript(skillDesc: SkillDescription, skillId: string): string {
        const actions = skillDesc.actions.map(a => this.generateAction(a)).join('\n\n');
        const actionDefs = skillDesc.actions.map(a => this.generateActionDef(a)).join('\n    \n');

        return `/**
 * ${skillDesc.name} Skill - Auto-generated
 * ${skillDesc.description}
 * 
 * Generated by TELE God Mode NL Skill Generator
 */

import { z } from 'zod';
import {
    SkillCard,
    ExecutionContext,
    ActionResult,
    HealthStatus,
    defineSkill
} from '../skills/skill_card';

// =============================================================================
// Parameter Schemas
// =============================================================================

${skillDesc.actions.map(a => this.generateParamSchema(a)).join('\n\n')}

// =============================================================================
// Action Implementations
// =============================================================================

${actions}

// =============================================================================
// Skill Definition
// =============================================================================

export const ${this.toCamelCase(skillDesc.name)}Skill: SkillCard = defineSkill()
    .id('${skillId}')
    .name('${skillDesc.name}')
    .version('1.0.0')
    .description('${skillDesc.description.replace(/'/g, "\\'")}')
    .author('TELE God Mode Generator')
    .category('${skillDesc.category || 'automation'}')
    .tags('auto-generated', 'custom')
    
    ${actionDefs}
    
    .healthCheck(async (): Promise<HealthStatus> => {
        return {
            status: 'healthy',
            message: '${skillDesc.name} skill is available',
            lastCheck: Date.now()
        };
    })
    
    .build();

export default ${this.toCamelCase(skillDesc.name)}Skill;
`;
    }

    private generateParamSchema(action: ActionDescription): string {
        if (!action.parameters || action.parameters.length === 0) {
            return `const ${this.toPascalCase(action.name)}Params = z.object({});`;
        }

        const fields = action.parameters.map(p => {
            let zodType = 'z.string()';
            switch (p.type) {
                case 'number': zodType = 'z.number()'; break;
                case 'boolean': zodType = 'z.boolean()'; break;
                case 'array': zodType = 'z.array(z.any())'; break;
                case 'object': zodType = 'z.record(z.any())'; break;
            }

            if (!p.required) zodType += '.optional()';
            if (p.default !== undefined) zodType += `.default(${JSON.stringify(p.default)})`;
            if (p.description) zodType += `.describe('${p.description.replace(/'/g, "\\'")}')`;

            return `    ${p.name}: ${zodType}`;
        });

        return `const ${this.toPascalCase(action.name)}Params = z.object({\n${fields.join(',\n')}\n});`;
    }

    private generateAction(action: ActionDescription): string {
        const paramType = `z.infer<typeof ${this.toPascalCase(action.name)}Params>`;

        return `async function ${action.name}(
    params: ${paramType},
    context: ExecutionContext
): Promise<{ success: boolean }> {
    context.logger.info('Executing ${action.name}...');
    
    // TODO: Implement ${action.name} logic
    // ${action.description}
    
    return { success: true };
}`;
    }

    private generateActionDef(action: ActionDescription): string {
        return `.action({
        name: '${action.name}',
        description: '${action.description.replace(/'/g, "\\'")}',
        parameters: ${this.toPascalCase(action.name)}Params,
        estimatedDurationMs: 1000,
        execute: async (params, context) => {
            const startTime = Date.now();
            try {
                const result = await ${action.name}(params, context);
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
    })`;
    }

    private generateManifest(skillDesc: SkillDescription, skillId: string, entry: string): string {
        return `# TELE Skill Manifest - Auto-generated
id: ${skillId}
name: ${skillDesc.name}
version: 1.0.0
description: ${skillDesc.description}
category: ${skillDesc.category || 'automation'}
entry: ${entry}
tags:
  - auto-generated
  - custom
`;
    }

    private toPascalCase(str: string): string {
        return str
            .replace(/[^a-zA-Z0-9]+/g, ' ')
            .split(' ')
            .filter(w => w)
            .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
            .join('');
    }

    private toCamelCase(str: string): string {
        const pascal = this.toPascalCase(str);
        return pascal.charAt(0).toLowerCase() + pascal.slice(1);
    }
}

// =============================================================================
// Skill Creator (High-level API)
// =============================================================================

export class SkillCreator {
    private parser: NLSkillParser;
    private generator: SkillCodeGenerator;

    constructor(outputDir?: string) {
        this.parser = new NLSkillParser();
        this.generator = new SkillCodeGenerator(
            outputDir || path.join(process.cwd(), 'skills', 'generated')
        );
    }

    /**
     * Create a skill from a natural language description
     */
    createFromDescription(description: string): GeneratedSkill {
        console.log('[SkillCreator] Parsing description...');
        const skillDesc = this.parser.parse(description);

        console.log(`[SkillCreator] Creating skill: ${skillDesc.name}`);
        console.log(`[SkillCreator] Actions: ${skillDesc.actions.map(a => a.name).join(', ')}`);

        return this.generator.generateAndWrite(skillDesc);
    }

    /**
     * Preview what would be generated without writing files
     */
    preview(description: string): { skillDesc: SkillDescription; code: string } {
        const skillDesc = this.parser.parse(description);
        const { code } = this.generator.generate(skillDesc);
        return { skillDesc, code };
    }
}

// =============================================================================
// Singleton Export
// =============================================================================

export const globalSkillCreator = new SkillCreator();
