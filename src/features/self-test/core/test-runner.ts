/**
 * features/self-test/core/test-runner.ts
 *
 * 核心测试运行器与套件注册管理器 (In-Memory Self-Test Engine)
 */

export interface TestCase {
    name: string;
    fn: () => void | Promise<void>;
}

export interface TestResult {
    name: string;
    status: "pass" | "fail" | "skip";
    durationMs: number;
    error?: string;
    errorStack?: string;
}

export interface TestSuite {
    name: string;
    category: "unit" | "integration" | "pipeline";
    tests: TestCase[];
}

export interface SuiteResult {
    name: string;
    category: string;
    results: TestResult[];
    passedCount: number;
    failedCount: number;
    totalDurationMs: number;
}

export interface TestReport {
    suites: SuiteResult[];
    totalTests: number;
    totalPassed: number;
    totalFailed: number;
    totalDurationMs: number;
    timestamp: number;
}

class TestRegistry {
    private suites: Map<string, TestSuite> = new Map();
    private currentSuiteName: string | null = null;

    public describe(name: string, category: "unit" | "integration" | "pipeline", fn: () => void) {
        // 每次 describe 注册或重新加载时重置当前套件用例，保证幂等性
        this.suites.set(name, {
            name,
            category,
            tests: []
        });
        this.currentSuiteName = name;
        try {
            fn();
        } finally {
            this.currentSuiteName = null;
        }
    }

    public test(name: string, fn: () => void | Promise<void>) {
        if (!this.currentSuiteName) {
            throw new Error(`[TestRunner] test("${name}") 必须在 describe() 块内调用`);
        }
        const suite = this.suites.get(this.currentSuiteName);
        if (suite) {
            suite.tests.push({ name, fn });
        }
    }

    public getSuites(): TestSuite[] {
        return Array.from(this.suites.values());
    }

    public clear() {
        this.suites.clear();
    }
}

export const testRegistry = new TestRegistry();

export function describe(name: string, fn: () => void, category: "unit" | "integration" | "pipeline" = "unit") {
    testRegistry.describe(name, category, fn);
}

export function test(name: string, fn: () => void | Promise<void>) {
    testRegistry.test(name, fn);
}

export const it = test;

/**
 * 运行全量已注册的测试套件
 */
export async function runAllTests(onProgress?: (suiteName: string, testName: string, current: number, total: number) => void): Promise<TestReport> {
    const suites = testRegistry.getSuites();
    const startTime = performance.now();
    const suiteResults: SuiteResult[] = [];

    let totalTests = 0;
    for (const s of suites) {
        totalTests += s.tests.length;
    }

    let progressCounter = 0;

    for (const suite of suites) {
        const suiteStartTime = performance.now();
        const results: TestResult[] = [];
        let passedCount = 0;
        let failedCount = 0;

        for (const t of suite.tests) {
            progressCounter++;
            if (onProgress) {
                onProgress(suite.name, t.name, progressCounter, totalTests);
            }

            const tStart = performance.now();
            try {
                await t.fn();
                const duration = Math.round((performance.now() - tStart) * 100) / 100;
                results.push({
                    name: t.name,
                    status: "pass",
                    durationMs: duration
                });
                passedCount++;
            } catch (err: any) {
                const duration = Math.round((performance.now() - tStart) * 100) / 100;
                results.push({
                    name: t.name,
                    status: "fail",
                    durationMs: duration,
                    error: err?.message || String(err),
                    errorStack: err?.stack
                });
                failedCount++;
            }
        }

        suiteResults.push({
            name: suite.name,
            category: suite.category,
            results,
            passedCount,
            failedCount,
            totalDurationMs: Math.round((performance.now() - suiteStartTime) * 100) / 100
        });
    }

    const totalDurationMs = Math.round((performance.now() - startTime) * 100) / 100;
    const totalPassed = suiteResults.reduce((acc, s) => acc + s.passedCount, 0);
    const totalFailed = suiteResults.reduce((acc, s) => acc + s.failedCount, 0);

    return {
        suites: suiteResults,
        totalTests,
        totalPassed,
        totalFailed,
        totalDurationMs,
        timestamp: Date.now()
    };
}
