// PatchRequest Schema - Phase 11

export type Priority = 'P0' | 'P1' | 'P2';

export interface PatchRequest {
    id: string;
    title: string;
    priority: Priority;
    createdAt: number;
    context: {
        repo_root: string;
        constraints: string[];
        current_state_summary: string;
    };
    goal: string;
    acceptance_criteria: string[];
    files_hint: {
        likely_to_edit: string[];
        must_not_touch: string[];
    };
    implementation_notes: string[];
    verification_plan: string[];
}

export interface PatchResult {
    id: string;
    requestId: string;
    applied: boolean;
    timestamp: number;
    diff_summary: string;
    touched_files: string[];
    errors: string[];
    instructions: string;
}

export function createPatchRequest(
    title: string,
    goal: string,
    priority: Priority = 'P1',
    options: Partial<PatchRequest> = {}
): PatchRequest {
    return {
        id: require('uuid').v4(),
        title,
        priority,
        createdAt: Date.now(),
        context: {
            repo_root: 'C:\\Users\\Administrator\\Desktop\\TELE',
            constraints: ['FREE_MODE', 'keep design tokens', 'no placeholders'],
            current_state_summary: options.context?.current_state_summary || ''
        },
        goal,
        acceptance_criteria: options.acceptance_criteria || [],
        files_hint: {
            likely_to_edit: options.files_hint?.likely_to_edit || [],
            must_not_touch: ['openclaw-main/**', 'node_modules/**']
        },
        implementation_notes: options.implementation_notes || [],
        verification_plan: options.verification_plan || ['npm run build']
    };
}
