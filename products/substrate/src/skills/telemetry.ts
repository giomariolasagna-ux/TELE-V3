/**
 * Telemetry Collector - Performance monitoring and optimization
 * Part of God Mode System - Challenge 6
 * 
 * Features:
 * - Latency tracking per skill/action
 * - Success/failure rate monitoring
 * - Trend analysis
 * - Optimization suggestions
 * - Export to various formats
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';

// =============================================================================
// Types
// =============================================================================

export interface MetricDataPoint {
    timestamp: number;
    skillId: string;
    actionName: string;
    latencyMs: number;
    success: boolean;
    error?: string;
    metadata?: Record<string, any>;
}

export interface SkillMetrics {
    skillId: string;
    totalCalls: number;
    successfulCalls: number;
    failedCalls: number;
    avgLatencyMs: number;
    p50LatencyMs: number;
    p95LatencyMs: number;
    p99LatencyMs: number;
    maxLatencyMs: number;
    minLatencyMs: number;
    successRate: number;
    recentTrend: 'improving' | 'stable' | 'degrading';
    byAction: Record<string, ActionMetrics>;
}

export interface ActionMetrics {
    actionName: string;
    totalCalls: number;
    successfulCalls: number;
    failedCalls: number;
    avgLatencyMs: number;
    p95LatencyMs: number;
    successRate: number;
    commonErrors: { error: string; count: number }[];
}

export interface OptimizationSuggestion {
    type: 'performance' | 'reliability' | 'usage';
    severity: 'low' | 'medium' | 'high';
    skillId: string;
    actionName?: string;
    message: string;
    suggestion: string;
    data?: any;
}

export interface TelemetryReport {
    generatedAt: number;
    periodStart: number;
    periodEnd: number;
    totalCalls: number;
    overallSuccessRate: number;
    avgLatencyMs: number;
    skills: SkillMetrics[];
    suggestions: OptimizationSuggestion[];
    healthScore: number;
}

// =============================================================================
// Telemetry Collector
// =============================================================================

export class TelemetryCollector extends EventEmitter {
    private dataPoints: MetricDataPoint[] = [];
    private maxDataPoints: number;
    private persistPath: string | null;
    private flushInterval: NodeJS.Timeout | null = null;

    constructor(
        maxDataPoints = 100000,
        persistPath?: string,
        flushIntervalMs = 60000
    ) {
        super();
        this.maxDataPoints = maxDataPoints;
        this.persistPath = persistPath || null;

        if (this.persistPath) {
            this.loadFromDisk();
            this.flushInterval = setInterval(() => this.flushToDisk(), flushIntervalMs);
        }
    }

    // -------------------------------------------------------------------------
    // Data Collection
    // -------------------------------------------------------------------------

    record(
        skillId: string,
        actionName: string,
        latencyMs: number,
        success: boolean,
        error?: string,
        metadata?: Record<string, any>
    ): void {
        const dataPoint: MetricDataPoint = {
            timestamp: Date.now(),
            skillId,
            actionName,
            latencyMs,
            success,
            error,
            metadata
        };

        this.dataPoints.push(dataPoint);

        // Prune old data if over limit
        if (this.dataPoints.length > this.maxDataPoints) {
            this.dataPoints = this.dataPoints.slice(-this.maxDataPoints);
        }

        this.emit('metric', dataPoint);

        // Check for anomalies
        this.checkAnomalies(dataPoint);
    }

    recordLatency(skillId: string, actionName: string, latencyMs: number): void {
        this.record(skillId, actionName, latencyMs, true);
    }

    recordSuccess(skillId: string, actionName: string, latencyMs: number): void {
        this.record(skillId, actionName, latencyMs, true);
    }

    recordFailure(skillId: string, actionName: string, latencyMs: number, error: string): void {
        this.record(skillId, actionName, latencyMs, false, error);
    }

    // -------------------------------------------------------------------------
    // Analysis
    // -------------------------------------------------------------------------

    getSkillMetrics(skillId: string, periodMs?: number): SkillMetrics | null {
        const cutoff = periodMs ? Date.now() - periodMs : 0;
        const points = this.dataPoints.filter(
            p => p.skillId === skillId && p.timestamp >= cutoff
        );

        if (points.length === 0) return null;

        const latencies = points.map(p => p.latencyMs).sort((a, b) => a - b);
        const successful = points.filter(p => p.success);

        const byAction: Record<string, ActionMetrics> = {};

        // Group by action
        const actionGroups = new Map<string, MetricDataPoint[]>();
        for (const p of points) {
            if (!actionGroups.has(p.actionName)) {
                actionGroups.set(p.actionName, []);
            }
            actionGroups.get(p.actionName)!.push(p);
        }

        for (const [actionName, actionPoints] of actionGroups) {
            const actionLatencies = actionPoints.map(p => p.latencyMs).sort((a, b) => a - b);
            const actionSuccessful = actionPoints.filter(p => p.success);

            // Count common errors
            const errorCounts = new Map<string, number>();
            for (const p of actionPoints) {
                if (!p.success && p.error) {
                    errorCounts.set(p.error, (errorCounts.get(p.error) || 0) + 1);
                }
            }

            byAction[actionName] = {
                actionName,
                totalCalls: actionPoints.length,
                successfulCalls: actionSuccessful.length,
                failedCalls: actionPoints.length - actionSuccessful.length,
                avgLatencyMs: actionLatencies.reduce((a, b) => a + b, 0) / actionLatencies.length,
                p95LatencyMs: this.percentile(actionLatencies, 95),
                successRate: (actionSuccessful.length / actionPoints.length) * 100,
                commonErrors: Array.from(errorCounts.entries())
                    .map(([error, count]) => ({ error, count }))
                    .sort((a, b) => b.count - a.count)
                    .slice(0, 5)
            };
        }

        return {
            skillId,
            totalCalls: points.length,
            successfulCalls: successful.length,
            failedCalls: points.length - successful.length,
            avgLatencyMs: latencies.reduce((a, b) => a + b, 0) / latencies.length,
            p50LatencyMs: this.percentile(latencies, 50),
            p95LatencyMs: this.percentile(latencies, 95),
            p99LatencyMs: this.percentile(latencies, 99),
            maxLatencyMs: Math.max(...latencies),
            minLatencyMs: Math.min(...latencies),
            successRate: (successful.length / points.length) * 100,
            recentTrend: this.calculateTrend(points),
            byAction
        };
    }

    getAllMetrics(periodMs?: number): SkillMetrics[] {
        const skillIds = new Set(this.dataPoints.map(p => p.skillId));
        const metrics: SkillMetrics[] = [];

        for (const skillId of skillIds) {
            const m = this.getSkillMetrics(skillId, periodMs);
            if (m) metrics.push(m);
        }

        return metrics;
    }

    generateReport(periodMs = 24 * 60 * 60 * 1000): TelemetryReport {
        const periodStart = Date.now() - periodMs;
        const periodEnd = Date.now();

        const relevantPoints = this.dataPoints.filter(p => p.timestamp >= periodStart);
        const skills = this.getAllMetrics(periodMs);
        const suggestions = this.generateSuggestions(skills);

        const overallSuccess = relevantPoints.filter(p => p.success).length;
        const avgLatency = relevantPoints.length > 0
            ? relevantPoints.reduce((a, p) => a + p.latencyMs, 0) / relevantPoints.length
            : 0;

        // Calculate health score (0-100)
        const successRate = relevantPoints.length > 0 ? (overallSuccess / relevantPoints.length) * 100 : 100;
        const latencyScore = Math.max(0, 100 - (avgLatency / 100)); // Penalize high latency
        const suggestionPenalty = suggestions.filter(s => s.severity === 'high').length * 10;
        const healthScore = Math.max(0, Math.min(100,
            (successRate * 0.6 + latencyScore * 0.3 + (100 - suggestionPenalty) * 0.1)
        ));

        return {
            generatedAt: Date.now(),
            periodStart,
            periodEnd,
            totalCalls: relevantPoints.length,
            overallSuccessRate: successRate,
            avgLatencyMs: avgLatency,
            skills,
            suggestions,
            healthScore
        };
    }

    // -------------------------------------------------------------------------
    // Optimization Suggestions
    // -------------------------------------------------------------------------

    generateSuggestions(skills: SkillMetrics[]): OptimizationSuggestion[] {
        const suggestions: OptimizationSuggestion[] = [];

        for (const skill of skills) {
            // High failure rate
            if (skill.successRate < 80 && skill.totalCalls > 10) {
                suggestions.push({
                    type: 'reliability',
                    severity: skill.successRate < 50 ? 'high' : 'medium',
                    skillId: skill.skillId,
                    message: `${skill.skillId} has a ${skill.successRate.toFixed(1)}% success rate`,
                    suggestion: 'Review error logs and implement better error handling or retry logic',
                    data: { successRate: skill.successRate, failures: skill.failedCalls }
                });
            }

            // High latency
            if (skill.p95LatencyMs > 5000) {
                suggestions.push({
                    type: 'performance',
                    severity: skill.p95LatencyMs > 10000 ? 'high' : 'medium',
                    skillId: skill.skillId,
                    message: `${skill.skillId} P95 latency is ${skill.p95LatencyMs.toFixed(0)}ms`,
                    suggestion: 'Consider caching, parallelization, or async execution',
                    data: { p95LatencyMs: skill.p95LatencyMs, avgLatencyMs: skill.avgLatencyMs }
                });
            }

            // Degrading trend
            if (skill.recentTrend === 'degrading') {
                suggestions.push({
                    type: 'performance',
                    severity: 'medium',
                    skillId: skill.skillId,
                    message: `${skill.skillId} performance is degrading over time`,
                    suggestion: 'Investigate recent changes or resource exhaustion'
                });
            }

            // Per-action issues
            for (const [actionName, action] of Object.entries(skill.byAction)) {
                if (action.successRate < 70 && action.totalCalls > 5) {
                    suggestions.push({
                        type: 'reliability',
                        severity: 'high',
                        skillId: skill.skillId,
                        actionName,
                        message: `Action ${actionName} has ${action.successRate.toFixed(1)}% success rate`,
                        suggestion: action.commonErrors.length > 0
                            ? `Most common error: ${action.commonErrors[0].error}`
                            : 'Add better error handling',
                        data: { commonErrors: action.commonErrors }
                    });
                }
            }
        }

        return suggestions.sort((a, b) => {
            const severityOrder = { high: 0, medium: 1, low: 2 };
            return severityOrder[a.severity] - severityOrder[b.severity];
        });
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    private percentile(sorted: number[], p: number): number {
        if (sorted.length === 0) return 0;
        const idx = Math.ceil((p / 100) * sorted.length) - 1;
        return sorted[Math.min(idx, sorted.length - 1)];
    }

    private calculateTrend(points: MetricDataPoint[]): 'improving' | 'stable' | 'degrading' {
        if (points.length < 20) return 'stable';

        // Compare first half to second half
        const mid = Math.floor(points.length / 2);
        const firstHalf = points.slice(0, mid);
        const secondHalf = points.slice(mid);

        const firstAvg = firstHalf.reduce((a, p) => a + p.latencyMs, 0) / firstHalf.length;
        const secondAvg = secondHalf.reduce((a, p) => a + p.latencyMs, 0) / secondHalf.length;

        const firstSuccess = firstHalf.filter(p => p.success).length / firstHalf.length;
        const secondSuccess = secondHalf.filter(p => p.success).length / secondHalf.length;

        const latencyChange = (secondAvg - firstAvg) / firstAvg;
        const successChange = secondSuccess - firstSuccess;

        if (latencyChange < -0.1 && successChange >= 0) return 'improving';
        if (latencyChange > 0.1 || successChange < -0.05) return 'degrading';
        return 'stable';
    }

    private checkAnomalies(point: MetricDataPoint): void {
        // Get recent baseline for this skill+action
        const recentPoints = this.dataPoints
            .filter(p =>
                p.skillId === point.skillId &&
                p.actionName === point.actionName &&
                p.timestamp > Date.now() - 300000 // Last 5 minutes
            )
            .slice(-50);

        if (recentPoints.length < 10) return;

        const avgLatency = recentPoints.reduce((a, p) => a + p.latencyMs, 0) / recentPoints.length;

        // Alert on 3x latency spike
        if (point.latencyMs > avgLatency * 3) {
            this.emit('anomaly', {
                type: 'latency_spike',
                skillId: point.skillId,
                actionName: point.actionName,
                value: point.latencyMs,
                baseline: avgLatency,
                message: `Latency spike: ${point.latencyMs}ms vs ${avgLatency.toFixed(0)}ms avg`
            });
        }
    }

    // -------------------------------------------------------------------------
    // Persistence
    // -------------------------------------------------------------------------

    private loadFromDisk(): void {
        if (!this.persistPath) return;
        try {
            if (fs.existsSync(this.persistPath)) {
                const data = JSON.parse(fs.readFileSync(this.persistPath, 'utf8'));
                this.dataPoints = data.dataPoints || [];
                console.log(`[Telemetry] Loaded ${this.dataPoints.length} data points from disk`);
            }
        } catch (error) {
            console.warn('[Telemetry] Failed to load from disk:', error);
        }
    }

    private flushToDisk(): void {
        if (!this.persistPath) return;
        try {
            const dir = path.dirname(this.persistPath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(this.persistPath, JSON.stringify({ dataPoints: this.dataPoints }));
        } catch (error) {
            console.warn('[Telemetry] Failed to persist to disk:', error);
        }
    }

    // -------------------------------------------------------------------------
    // Cleanup
    // -------------------------------------------------------------------------

    destroy(): void {
        if (this.flushInterval) {
            clearInterval(this.flushInterval);
        }
        if (this.persistPath) {
            this.flushToDisk();
        }
    }

    clear(): void {
        this.dataPoints = [];
    }

    getDataPointCount(): number {
        return this.dataPoints.length;
    }
}

// =============================================================================
// Singleton Export
// =============================================================================

export const globalTelemetry = new TelemetryCollector(
    100000,
    path.join(process.cwd(), '.tele', 'telemetry.json')
);
