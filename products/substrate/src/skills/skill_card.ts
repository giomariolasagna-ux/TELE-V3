/**
 * SkillCard - Core interface for standardized skill definitions
 * Part of God Mode System - Challenge 1
 * 
 * Provides type-safe, self-documenting skill definitions with:
 * - Zod-based parameter validation
 * - Built-in health checks
 * - Rollback support for destructive operations
 * - Telemetry hooks
 */

import { z } from 'zod';

// =============================================================================
// Core Types
// =============================================================================

export type SkillCategory = 'app' | 'system' | 'integration' | 'automation' | 'media';

export interface HealthStatus {
    status: 'healthy' | 'degraded' | 'unhealthy';
    message?: string;
    lastCheck: number;
    details?: Record<string, any>;
}

export interface ExecutionContext {
    sessionId: string;
    userId?: string;
    startTime: number;
    signal: AbortSignal;
    logger: SkillLogger;
    telemetry: TelemetryHook;
}

export interface SkillLogger {
    debug(message: string, data?: any): void;
    info(message: string, data?: any): void;
    warn(message: string, data?: any): void;
    error(message: string, data?: any): void;
}

export interface TelemetryHook {
    recordLatency(actionName: string, durationMs: number): void;
    recordSuccess(actionName: string): void;
    recordFailure(actionName: string, error: Error): void;
    recordMetric(name: string, value: number, tags?: Record<string, string>): void;
}

export interface ActionResult<T = any> {
    success: boolean;
    data?: T;
    error?: string;
    durationMs: number;
    rollbackData?: any;  // Data needed for rollback
}

export interface RollbackContext {
    originalParams: any;
    resultData: any;
    sessionId: string;
    logger: SkillLogger;
}

// =============================================================================
// SkillAction Interface
// =============================================================================

export interface SkillAction<TParams = any, TResult = any> {
    /** Unique action identifier within the skill */
    name: string;

    /** Human-readable description */
    description: string;

    /** Zod schema for parameter validation */
    parameters: z.ZodSchema<TParams>;

    /** Execute the action */
    execute(params: TParams, context: ExecutionContext): Promise<ActionResult<TResult>>;

    /** Estimated duration in milliseconds (for planning) */
    estimatedDurationMs?: number;

    /** Whether this action requires elevated privileges */
    requiresElevation?: boolean;

    /** Whether this action can be rolled back */
    canRollback?: boolean;

    /** Rollback implementation (if canRollback is true) */
    rollback?(rollbackData: any, context: RollbackContext): Promise<ActionResult>;
}

// =============================================================================
// SkillCard Interface
// =============================================================================

export interface SkillCard<TConfig = any> {
    // -------------------------------------------------------------------------
    // Identity
    // -------------------------------------------------------------------------

    /** Unique skill identifier (e.g., 'skill.adobe.photoshop') */
    id: string;

    /** Human-readable name */
    name: string;

    /** Semantic version (e.g., '1.2.0') */
    version: string;

    /** Detailed description */
    description: string;

    /** Author/maintainer */
    author?: string;

    // -------------------------------------------------------------------------
    // Categorization
    // -------------------------------------------------------------------------

    /** Primary category */
    category: SkillCategory;

    /** Searchable tags */
    tags: string[];

    /** Skill dependencies (skill IDs with version constraints) */
    dependencies?: Record<string, string>;

    // -------------------------------------------------------------------------
    // Configuration
    // -------------------------------------------------------------------------

    /** Zod schema for skill-level configuration */
    configSchema?: z.ZodSchema<TConfig>;

    /** Current configuration */
    config?: TConfig;

    // -------------------------------------------------------------------------
    // Actions
    // -------------------------------------------------------------------------

    /** Available actions */
    actions: SkillAction[];

    // -------------------------------------------------------------------------
    // Lifecycle
    // -------------------------------------------------------------------------

    /** Called once when skill is loaded */
    setup?(config?: TConfig): Promise<void>;

    /** Called when skill is unloaded */
    teardown?(): Promise<void>;

    // -------------------------------------------------------------------------
    // Health & Verification
    // -------------------------------------------------------------------------

    /** Check if skill is operational */
    healthCheck(): Promise<HealthStatus>;

    /** Whether any actions support rollback */
    canRollback: boolean;
}

// =============================================================================
// Skill Builder Helper
// =============================================================================

export class SkillBuilder<TConfig = any> {
    private skill: Partial<SkillCard<TConfig>> = {
        actions: [],
        tags: [],
        canRollback: false
    };

    id(id: string): this {
        this.skill.id = id;
        return this;
    }

    name(name: string): this {
        this.skill.name = name;
        return this;
    }

    version(version: string): this {
        this.skill.version = version;
        return this;
    }

    description(description: string): this {
        this.skill.description = description;
        return this;
    }

    author(author: string): this {
        this.skill.author = author;
        return this;
    }

    category(category: SkillCategory): this {
        this.skill.category = category;
        return this;
    }

    tags(...tags: string[]): this {
        this.skill.tags = [...(this.skill.tags || []), ...tags];
        return this;
    }

    dependencies(deps: Record<string, string>): this {
        this.skill.dependencies = deps;
        return this;
    }

    configSchema(schema: z.ZodSchema<TConfig>): this {
        this.skill.configSchema = schema;
        return this;
    }

    action<TParams, TResult>(action: SkillAction<TParams, TResult>): this {
        this.skill.actions!.push(action as SkillAction);
        if (action.canRollback) {
            this.skill.canRollback = true;
        }
        return this;
    }

    setup(fn: (config?: TConfig) => Promise<void>): this {
        this.skill.setup = fn;
        return this;
    }

    teardown(fn: () => Promise<void>): this {
        this.skill.teardown = fn;
        return this;
    }

    healthCheck(fn: () => Promise<HealthStatus>): this {
        this.skill.healthCheck = fn;
        return this;
    }

    build(): SkillCard<TConfig> {
        // Validate required fields
        if (!this.skill.id) throw new Error('Skill id is required');
        if (!this.skill.name) throw new Error('Skill name is required');
        if (!this.skill.version) throw new Error('Skill version is required');
        if (!this.skill.description) throw new Error('Skill description is required');
        if (!this.skill.category) throw new Error('Skill category is required');
        if (!this.skill.healthCheck) throw new Error('Skill healthCheck is required');

        return this.skill as SkillCard<TConfig>;
    }
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Create a new skill using the builder pattern
 */
export function defineSkill<TConfig = any>(): SkillBuilder<TConfig> {
    return new SkillBuilder<TConfig>();
}

/**
 * Create a simple action with minimal boilerplate
 */
export function defineAction<TParams, TResult>(
    name: string,
    description: string,
    parameters: z.ZodSchema<TParams>,
    execute: (params: TParams, context: ExecutionContext) => Promise<TResult>,
    options?: {
        estimatedDurationMs?: number;
        requiresElevation?: boolean;
        canRollback?: boolean;
        rollback?: (data: any, context: RollbackContext) => Promise<ActionResult>;
    }
): SkillAction<TParams, TResult> {
    return {
        name,
        description,
        parameters,
        estimatedDurationMs: options?.estimatedDurationMs,
        requiresElevation: options?.requiresElevation,
        canRollback: options?.canRollback,
        rollback: options?.rollback,
        execute: async (params, context) => {
            const startTime = Date.now();
            try {
                const result = await execute(params, context);
                const durationMs = Date.now() - startTime;
                context.telemetry.recordSuccess(name);
                context.telemetry.recordLatency(name, durationMs);
                return {
                    success: true,
                    data: result,
                    durationMs
                };
            } catch (error: any) {
                const durationMs = Date.now() - startTime;
                context.telemetry.recordFailure(name, error);
                return {
                    success: false,
                    error: error.message,
                    durationMs
                };
            }
        }
    };
}

/**
 * Create a default logger for skill execution
 */
export function createSkillLogger(skillId: string): SkillLogger {
    const prefix = `[${skillId}]`;
    return {
        debug: (msg, data) => console.debug(`${prefix} ${msg}`, data ?? ''),
        info: (msg, data) => console.log(`${prefix} ${msg}`, data ?? ''),
        warn: (msg, data) => console.warn(`${prefix} ${msg}`, data ?? ''),
        error: (msg, data) => console.error(`${prefix} ${msg}`, data ?? '')
    };
}

/**
 * Create a default telemetry hook (logs to console)
 */
export function createDefaultTelemetry(skillId: string): TelemetryHook {
    return {
        recordLatency: (action, ms) =>
            console.log(`[Telemetry] ${skillId}.${action} latency: ${ms}ms`),
        recordSuccess: (action) =>
            console.log(`[Telemetry] ${skillId}.${action} succeeded`),
        recordFailure: (action, error) =>
            console.error(`[Telemetry] ${skillId}.${action} failed:`, error.message),
        recordMetric: (name, value, tags) =>
            console.log(`[Telemetry] ${skillId} metric ${name}=${value}`, tags ?? '')
    };
}

/**
 * Create an execution context
 */
export function createExecutionContext(
    skillId: string,
    signal?: AbortSignal
): ExecutionContext {
    return {
        sessionId: `session_${Date.now()}`,
        startTime: Date.now(),
        signal: signal || new AbortController().signal,
        logger: createSkillLogger(skillId),
        telemetry: createDefaultTelemetry(skillId)
    };
}
