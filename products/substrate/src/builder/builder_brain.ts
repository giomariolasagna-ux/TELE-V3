// Builder Brain - Decides what to build and generates PatchRequests

import { PatchRequest, createPatchRequest } from './patch_request';
import { globalBuilderChannel } from './builder_channel';
import { globalEventBus, BusEventType } from '../event_bus';

export class BuilderBrain {
    private pendingRequests: Map<string, PatchRequest> = new Map();

    constructor() { }

    // Generate the auto P0 request on first boot
    async generateBootRequest(): Promise<PatchRequest> {
        const request = createPatchRequest(
            'Implement Boot Scan + Optimization Pipeline v1 wired to UI',
            'Create a fully functional boot scan that inventories the filesystem, detects temp/cache clusters, and produces an OptimizationReport artifact visible in the UI.',
            'P0',
            {
                acceptance_criteria: [
                    'Boot scan starts automatically on first run',
                    'Timeline shows SCAN_STARTED, SCAN_PROGRESS, SCAN_DONE events',
                    'OptimizationReport artifact appears in DropSpace',
                    'No UI freeze during scan',
                    'Report includes: total size, trash detected, hot paths'
                ],
                files_hint: {
                    likely_to_edit: [
                        'products/substrate/src/boot_pipeline.ts',
                        'products/substrate/src/session_kernel/scanner.ts',
                        'products/substrate_ui/renderer.js'
                    ],
                    must_not_touch: ['openclaw-main/**']
                },
                implementation_notes: [
                    'Use chokidar for filesystem scanning',
                    'Implement progress throttling to avoid event spam',
                    'Store report as ArtifactObject with preview text'
                ],
                verification_plan: [
                    'Delete ~/.tele/bootstamp.json',
                    'Run npm start',
                    'Observe timeline events in UI',
                    'Verify artifact card appears in DropSpace'
                ]
            }
        );

        this.pendingRequests.set(request.id, request);

        // Emit event
        globalEventBus.emitEvent(BusEventType.TIMELINE_EVENT, {
            description: `[Builder] Generated PatchRequest: ${request.title}`,
            metadata: { requestId: request.id, priority: request.priority }
        });

        // Send to channel
        await globalBuilderChannel.sendRequest(request);

        return request;
    }

    // Generate a skill learning request
    async generateSkillRequest(skillName: string, description: string): Promise<PatchRequest> {
        const request = createPatchRequest(
            `Learn Skill: ${skillName}`,
            description,
            'P1',
            {
                acceptance_criteria: [
                    `Skill "${skillName}" is registered in skills/registry.ts`,
                    'Skill has index.ts entrypoint',
                    'Skill appears as operator in DropSpace',
                    'Basic smoke test passes'
                ],
                files_hint: {
                    likely_to_edit: [
                        'products/substrate/src/skills/registry.ts',
                        `products/substrate/src/skills/${skillName}/index.ts`,
                        `products/substrate/src/skills/${skillName}/skill.json`
                    ],
                    must_not_touch: ['openclaw-main/**']
                },
                implementation_notes: [
                    'Create skill directory structure',
                    'Register in skills registry',
                    'Add UI hook for operator icon'
                ],
                verification_plan: [
                    'Import skill from registry',
                    'Call skill.initialize()',
                    'Verify UI shows new operator'
                ]
            }
        );

        this.pendingRequests.set(request.id, request);
        await globalBuilderChannel.sendRequest(request);

        return request;
    }

    // Generate a generic feature request
    async generateFeatureRequest(title: string, goal: string, files: string[]): Promise<PatchRequest> {
        const request = createPatchRequest(title, goal, 'P1', {
            files_hint: {
                likely_to_edit: files,
                must_not_touch: ['openclaw-main/**']
            },
            verification_plan: ['npm run build', 'Manual verification']
        });

        this.pendingRequests.set(request.id, request);
        await globalBuilderChannel.sendRequest(request);

        return request;
    }

    getPendingRequests(): PatchRequest[] {
        return Array.from(this.pendingRequests.values());
    }

    markCompleted(requestId: string) {
        this.pendingRequests.delete(requestId);
    }
}

export const globalBuilderBrain = new BuilderBrain();
