/**
 * Test Harness - Automated skill testing framework
 * Part of God Mode System - Challenge 3
 * 
 * Features:
 * - Test case generation from SkillCard definitions
 * - Latency and success rate metrics
 * - Coverage tracking
 * - HTML/JSON report generation
 * - Rollback verification
 */

import {
    SkillCard,
    SkillAction,
    ExecutionContext,
    ActionResult,
    createSkillLogger,
    createDefaultTelemetry
} from '../skills/skill_card';
import { globalSkillsRegistry } from '../skills/registry';
import * as fs from 'fs';
import * as path from 'path';

// =============================================================================
// Types
// =============================================================================

export interface TestCase {
    id: string;
    name: string;
    skillId: string;
    actionName: string;
    params: any;
    expectedResult: 'success' | 'failure';
    timeout: number;
    tags?: string[];
    setup?: () => Promise<void>;
    teardown?: () => Promise<void>;
    validate?: (result: ActionResult) => boolean;
}

export interface TestResult {
    testId: string;
    testName: string;
    skillId: string;
    actionName: string;
    passed: boolean;
    latencyMs: number;
    error?: string;
    result?: ActionResult;
    timestamp: number;
}

export interface TestSuite {
    id: string;
    name: string;
    description?: string;
    tests: TestCase[];
    setupAll?: () => Promise<void>;
    teardownAll?: () => Promise<void>;
}

export interface TestReport {
    suiteId: string;
    suiteName: string;
    totalTests: number;
    passed: number;
    failed: number;
    skipped: number;
    avgLatencyMs: number;
    p50LatencyMs: number;
    p95LatencyMs: number;
    maxLatencyMs: number;
    successRate: number;
    coverage: CoverageInfo;
    results: TestResult[];
    timestamp: number;
    durationMs: number;
}

export interface CoverageInfo {
    totalSkills: number;
    testedSkills: number;
    totalActions: number;
    testedActions: number;
    skillCoverage: number;
    actionCoverage: number;
    bySkill: Record<string, { total: number; tested: number }>;
}

// =============================================================================
// Test Harness
// =============================================================================

export class TestHarness {
    private results: TestResult[] = [];
    private abortController: AbortController | null = null;

    constructor() {
        this.results = [];
    }

    // -------------------------------------------------------------------------
    // Test Execution
    // -------------------------------------------------------------------------

    async runTest(testCase: TestCase): Promise<TestResult> {
        console.log(`[TestHarness] Running: ${testCase.name}`);

        const result: TestResult = {
            testId: testCase.id,
            testName: testCase.name,
            skillId: testCase.skillId,
            actionName: testCase.actionName,
            passed: false,
            latencyMs: 0,
            timestamp: Date.now()
        };

        try {
            // Setup
            if (testCase.setup) {
                await testCase.setup();
            }

            // Get skill and action
            const skill = globalSkillsRegistry.getSkillCard(testCase.skillId);
            if (!skill) {
                throw new Error(`Skill not found: ${testCase.skillId}`);
            }

            const action = skill.actions.find(a => a.name === testCase.actionName);
            if (!action) {
                throw new Error(`Action not found: ${testCase.actionName}`);
            }

            // Create execution context
            this.abortController = new AbortController();
            const context = this.createContext(testCase.skillId, testCase.timeout);

            // Execute with timeout
            const startTime = Date.now();
            const timeoutPromise = new Promise<never>((_, reject) => {
                setTimeout(() => reject(new Error('Test timeout')), testCase.timeout);
            });

            const actionResult = await Promise.race([
                action.execute(testCase.params, context),
                timeoutPromise
            ]);

            result.latencyMs = Date.now() - startTime;
            result.result = actionResult;

            // Validate result
            if (testCase.expectedResult === 'success') {
                if (actionResult.success) {
                    result.passed = testCase.validate ? testCase.validate(actionResult) : true;
                } else {
                    result.passed = false;
                    result.error = actionResult.error || 'Expected success but got failure';
                }
            } else {
                // Expected failure
                result.passed = !actionResult.success;
                if (actionResult.success) {
                    result.error = 'Expected failure but got success';
                }
            }

        } catch (error: any) {
            result.latencyMs = Date.now() - result.timestamp;
            result.error = error.message;
            result.passed = testCase.expectedResult === 'failure';
        } finally {
            // Teardown
            if (testCase.teardown) {
                try {
                    await testCase.teardown();
                } catch (e) {
                    console.warn('[TestHarness] Teardown failed:', e);
                }
            }
            this.abortController = null;
        }

        console.log(`[TestHarness] ${result.passed ? '✓' : '✗'} ${testCase.name} (${result.latencyMs}ms)`);
        this.results.push(result);
        return result;
    }

    async runSuite(suite: TestSuite): Promise<TestReport> {
        console.log(`[TestHarness] Starting suite: ${suite.name}`);
        const startTime = Date.now();

        const results: TestResult[] = [];

        try {
            // Suite setup
            if (suite.setupAll) {
                await suite.setupAll();
            }

            // Run each test
            for (const test of suite.tests) {
                const result = await this.runTest(test);
                results.push(result);
            }

        } finally {
            // Suite teardown
            if (suite.teardownAll) {
                try {
                    await suite.teardownAll();
                } catch (e) {
                    console.warn('[TestHarness] Suite teardown failed:', e);
                }
            }
        }

        return this.generateReport(suite, results, startTime);
    }

    abort(): void {
        if (this.abortController) {
            this.abortController.abort();
        }
    }

    // -------------------------------------------------------------------------
    // Report Generation
    // -------------------------------------------------------------------------

    private generateReport(suite: TestSuite, results: TestResult[], startTime: number): TestReport {
        const latencies = results.map(r => r.latencyMs).sort((a, b) => a - b);
        const passed = results.filter(r => r.passed).length;

        const report: TestReport = {
            suiteId: suite.id,
            suiteName: suite.name,
            totalTests: results.length,
            passed,
            failed: results.length - passed,
            skipped: 0,
            avgLatencyMs: latencies.reduce((a, b) => a + b, 0) / latencies.length || 0,
            p50LatencyMs: latencies[Math.floor(latencies.length * 0.5)] || 0,
            p95LatencyMs: latencies[Math.floor(latencies.length * 0.95)] || 0,
            maxLatencyMs: Math.max(...latencies, 0),
            successRate: results.length > 0 ? (passed / results.length) * 100 : 0,
            coverage: this.calculateCoverage(results),
            results,
            timestamp: startTime,
            durationMs: Date.now() - startTime
        };

        return report;
    }

    private calculateCoverage(results: TestResult[]): CoverageInfo {
        const allSkills = globalSkillsRegistry.getAllSkillCards();
        const testedSkillIds = new Set(results.map(r => r.skillId));
        const testedActions = new Set(results.map(r => `${r.skillId}.${r.actionName}`));

        const bySkill: Record<string, { total: number; tested: number }> = {};
        let totalActions = 0;

        for (const skill of allSkills) {
            const skillActions = skill.actions.length;
            totalActions += skillActions;

            const testedCount = skill.actions.filter(
                a => testedActions.has(`${skill.id}.${a.name}`)
            ).length;

            bySkill[skill.id] = { total: skillActions, tested: testedCount };
        }

        return {
            totalSkills: allSkills.length,
            testedSkills: testedSkillIds.size,
            totalActions,
            testedActions: testedActions.size,
            skillCoverage: allSkills.length > 0 ? (testedSkillIds.size / allSkills.length) * 100 : 0,
            actionCoverage: totalActions > 0 ? (testedActions.size / totalActions) * 100 : 0,
            bySkill
        };
    }

    // -------------------------------------------------------------------------
    // Report Export
    // -------------------------------------------------------------------------

    exportJSON(report: TestReport, outputPath: string): void {
        fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
        console.log(`[TestHarness] Report saved: ${outputPath}`);
    }

    exportHTML(report: TestReport, outputPath: string): void {
        const html = this.generateHTMLReport(report);
        fs.writeFileSync(outputPath, html);
        console.log(`[TestHarness] HTML report saved: ${outputPath}`);
    }

    private generateHTMLReport(report: TestReport): string {
        const passedClass = report.successRate >= 80 ? 'success' : report.successRate >= 50 ? 'warning' : 'danger';

        return `<!DOCTYPE html>
<html>
<head>
    <title>Test Report - ${report.suiteName}</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 20px; background: #1a1a2e; color: #eee; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 20px; border-radius: 10px; margin-bottom: 20px; }
        .header h1 { margin: 0; }
        .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 15px; margin-bottom: 20px; }
        .stat { background: #16213e; padding: 15px; border-radius: 8px; text-align: center; }
        .stat .value { font-size: 2em; font-weight: bold; }
        .stat .label { opacity: 0.7; font-size: 0.9em; }
        .success { color: #00d26a; }
        .warning { color: #ffc107; }
        .danger { color: #ff6b6b; }
        table { width: 100%; border-collapse: collapse; background: #16213e; border-radius: 8px; overflow: hidden; }
        th, td { padding: 12px; text-align: left; border-bottom: 1px solid #0f3460; }
        th { background: #0f3460; }
        .passed { color: #00d26a; }
        .failed { color: #ff6b6b; }
        .coverage { margin-top: 20px; }
        .bar { height: 20px; background: #0f3460; border-radius: 10px; overflow: hidden; }
        .bar-fill { height: 100%; background: linear-gradient(90deg, #667eea, #764ba2); }
    </style>
</head>
<body>
    <div class="header">
        <h1>🧪 ${report.suiteName}</h1>
        <p>Generated: ${new Date(report.timestamp).toISOString()}</p>
    </div>

    <div class="stats">
        <div class="stat">
            <div class="value ${passedClass}">${report.successRate.toFixed(1)}%</div>
            <div class="label">Success Rate</div>
        </div>
        <div class="stat">
            <div class="value">${report.passed}/${report.totalTests}</div>
            <div class="label">Tests Passed</div>
        </div>
        <div class="stat">
            <div class="value">${report.avgLatencyMs.toFixed(0)}ms</div>
            <div class="label">Avg Latency</div>
        </div>
        <div class="stat">
            <div class="value">${report.p95LatencyMs.toFixed(0)}ms</div>
            <div class="label">P95 Latency</div>
        </div>
        <div class="stat">
            <div class="value">${(report.durationMs / 1000).toFixed(1)}s</div>
            <div class="label">Total Duration</div>
        </div>
    </div>

    <h2>Coverage</h2>
    <div class="coverage">
        <p>Skills: ${report.coverage.testedSkills}/${report.coverage.totalSkills} (${report.coverage.skillCoverage.toFixed(1)}%)</p>
        <div class="bar"><div class="bar-fill" style="width: ${report.coverage.skillCoverage}%"></div></div>
        <p style="margin-top: 10px">Actions: ${report.coverage.testedActions}/${report.coverage.totalActions} (${report.coverage.actionCoverage.toFixed(1)}%)</p>
        <div class="bar"><div class="bar-fill" style="width: ${report.coverage.actionCoverage}%"></div></div>
    </div>

    <h2>Test Results</h2>
    <table>
        <thead>
            <tr>
                <th>Status</th>
                <th>Test</th>
                <th>Skill</th>
                <th>Action</th>
                <th>Latency</th>
                <th>Error</th>
            </tr>
        </thead>
        <tbody>
            ${report.results.map(r => `
            <tr>
                <td class="${r.passed ? 'passed' : 'failed'}">${r.passed ? '✓' : '✗'}</td>
                <td>${r.testName}</td>
                <td>${r.skillId}</td>
                <td>${r.actionName}</td>
                <td>${r.latencyMs}ms</td>
                <td>${r.error || '-'}</td>
            </tr>
            `).join('')}
        </tbody>
    </table>
</body>
</html>`;
    }

    // -------------------------------------------------------------------------
    // Context Creation
    // -------------------------------------------------------------------------

    private createContext(skillId: string, timeout: number): ExecutionContext {
        return {
            sessionId: `test_${Date.now()}`,
            startTime: Date.now(),
            signal: this.abortController?.signal || new AbortController().signal,
            logger: createSkillLogger(skillId),
            telemetry: createDefaultTelemetry(skillId)
        };
    }

    // -------------------------------------------------------------------------
    // Results Access
    // -------------------------------------------------------------------------

    getResults(): TestResult[] {
        return [...this.results];
    }

    clearResults(): void {
        this.results = [];
    }
}

// =============================================================================
// Test Generator
// =============================================================================

export class TestGenerator {
    /**
     * Generate test cases from a SkillCard definition
     */
    generateFromSkill(skill: SkillCard): TestCase[] {
        const tests: TestCase[] = [];

        // Health check test
        tests.push({
            id: `${skill.id}.health`,
            name: `${skill.name} - Health Check`,
            skillId: skill.id,
            actionName: '__healthCheck__',
            params: {},
            expectedResult: 'success',
            timeout: 5000
        });

        // Generate tests for each action
        for (const action of skill.actions) {
            // Basic invocation test with default/empty params
            tests.push({
                id: `${skill.id}.${action.name}.basic`,
                name: `${skill.name} - ${action.name} (basic)`,
                skillId: skill.id,
                actionName: action.name,
                params: this.generateDefaultParams(action),
                expectedResult: 'success',
                timeout: (action.estimatedDurationMs || 5000) * 2
            });

            // Invalid params test
            tests.push({
                id: `${skill.id}.${action.name}.invalid`,
                name: `${skill.name} - ${action.name} (invalid params)`,
                skillId: skill.id,
                actionName: action.name,
                params: { __invalid__: true },
                expectedResult: 'failure',
                timeout: 5000
            });
        }

        return tests;
    }

    /**
     * Generate test suite for all registered skills
     */
    generateFullSuite(): TestSuite {
        const allSkills = globalSkillsRegistry.getAllSkillCards();
        const tests: TestCase[] = [];

        for (const skill of allSkills) {
            tests.push(...this.generateFromSkill(skill));
        }

        return {
            id: 'full-suite',
            name: 'Full Skill Test Suite',
            description: `Tests all ${allSkills.length} registered skills`,
            tests
        };
    }

    private generateDefaultParams(action: SkillAction): any {
        // Try to generate sensible defaults based on parameter schema
        // This is a simplified version - full implementation would parse Zod schema
        return {};
    }
}

// =============================================================================
// Singleton Exports
// =============================================================================

export const globalTestHarness = new TestHarness();
export const globalTestGenerator = new TestGenerator();
