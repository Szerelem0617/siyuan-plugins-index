<script lang="ts">
    import { onMount } from "svelte";
    import { runAllTests, type TestReport } from "../core/test-runner";
    import { registerSupertagSchemaSuite } from "../suites/supertag-schema.suite";
    import { registerSupertagDiffSuite } from "../suites/supertag-diff.suite";
    import { registerConditionEvaluatorSuite } from "../suites/condition-evaluator.suite";
    import { registerParamResolverSuite } from "../suites/param-resolver.suite";
    import { registerApiSandboxSuite } from "../suites/api-sandbox.suite";

    export let dialog: any;

    let isRunning = false;
    let report: TestReport | null = null;
    let currentProgress = { suite: "", test: "", current: 0, total: 0 };
    let expandedSuites: Set<string> = new Set();
    let expandedErrors: Set<string> = new Set();

    function initSuites() {
        registerSupertagSchemaSuite();
        registerSupertagDiffSuite();
        registerConditionEvaluatorSuite();
        registerParamResolverSuite();
        registerApiSandboxSuite();
    }

    async function executeTests() {
        if (isRunning) return;
        isRunning = true;
        currentProgress = { suite: "准备中", test: "正在加载测试套件...", current: 0, total: 0 };

        try {
            report = await runAllTests((suite, test, current, total) => {
                currentProgress = { suite, test, current, total };
            });

            // 默认展开有失败用例的套件，若全过则全部展开
            const newExpanded = new Set<string>();
            report.suites.forEach(s => {
                newExpanded.add(s.name);
            });
            expandedSuites = newExpanded;
        } finally {
            isRunning = false;
        }
    }

    function toggleSuite(suiteName: string) {
        if (expandedSuites.has(suiteName)) {
            expandedSuites.delete(suiteName);
        } else {
            expandedSuites.add(suiteName);
        }
        expandedSuites = new Set(expandedSuites);
    }

    function toggleError(testKey: string) {
        if (expandedErrors.has(testKey)) {
            expandedErrors.delete(testKey);
        } else {
            expandedErrors.add(testKey);
        }
        expandedErrors = new Set(expandedErrors);
    }

    onMount(() => {
        initSuites();
        executeTests();
    });
</script>

<div class="self-test-container">
    <!-- 头部仪表盘 -->
    <div class="test-header">
        <div class="header-main">
            <div class="header-title-block">
                <span class="test-title-icon">🧪</span>
                <div class="test-title-text">
                    <span class="title-main">IndexOS 核心自检诊断控制台</span>
                    <span class="title-sub">Supertag 协议、Diff、条件 DSL 与运行时 API 沙箱自动化测试</span>
                </div>
            </div>
            <div class="header-actions">
                <button
                    class="b3-button b3-button--primary test-run-btn"
                    disabled={isRunning}
                    on:click={executeTests}
                >
                    {#if isRunning}
                        <span class="spinner-small"></span> 正在运行...
                    {:else}
                        🚀 重新运行全套自检
                    {/if}
                </button>
                <button class="b3-button b3-button--cancel" on:click={() => dialog?.destroy()}>
                    关闭
                </button>
            </div>
        </div>

        <!-- 统计面板 -->
        <div class="stats-banner">
            <div class="stat-card">
                <span class="stat-label">总用例数</span>
                <span class="stat-val">{report ? report.totalTests : 0}</span>
            </div>
            <div class="stat-card stat-card--pass">
                <span class="stat-label">通过用例</span>
                <span class="stat-val stat-val--pass">{report ? report.totalPassed : 0}</span>
            </div>
            <div class="stat-card stat-card--fail">
                <span class="stat-label">失败用例</span>
                <span class="stat-val stat-val--fail">{report ? report.totalFailed : 0}</span>
            </div>
            <div class="stat-card">
                <span class="stat-label">总耗时</span>
                <span class="stat-val">{report ? report.totalDurationMs : 0} ms</span>
            </div>
            <div class="stat-card stat-card--status">
                <span class="stat-label">系统健康状态</span>
                {#if isRunning}
                    <span class="status-badge status-badge--running">⚡ 诊断中...</span>
                {:else if !report}
                    <span class="status-badge">就绪</span>
                {:else if report.totalFailed === 0}
                    <span class="status-badge status-badge--all-pass">✅ 全部健康 (100%)</span>
                {:else}
                    <span class="status-badge status-badge--has-fail">❌ 存在 {report.totalFailed} 项异常</span>
                {/if}
            </div>
        </div>

        {#if isRunning}
            <div class="progress-bar-wrap">
                <div
                    class="progress-bar-inner"
                    style="width: {currentProgress.total ? (currentProgress.current / currentProgress.total) * 100 : 0}%;"
                ></div>
                <span class="progress-text">
                    [{currentProgress.current}/{currentProgress.total}] 正在执行: {currentProgress.suite} ➔ {currentProgress.test}
                </span>
            </div>
        {/if}
    </div>

    <!-- 测试套件列表区 -->
    <div class="test-body">
        {#if report}
            <div class="suites-list">
                {#each report.suites as suite}
                    {@const isExpanded = expandedSuites.has(suite.name)}
                    <div class="suite-card {suite.failedCount > 0 ? 'suite-card--fail' : 'suite-card--pass'}">
                        <div
                            class="suite-header"
                            role="button"
                            tabindex="0"
                            on:click={() => toggleSuite(suite.name)}
                            on:keydown={e => (e.key === 'Enter' || e.key === ' ') && toggleSuite(suite.name)}
                        >
                            <div class="suite-header-left">
                                <span class="suite-expand-arrow {isExpanded ? 'expanded' : ''}">▼</span>
                                <span class="suite-status-icon">{suite.failedCount === 0 ? '✅' : '❌'}</span>
                                <span class="suite-title">{suite.name}</span>
                                <span class="category-chip">{suite.category}</span>
                            </div>
                            <div class="suite-header-right">
                                <span class="suite-summary-pill {suite.failedCount === 0 ? 'pill-pass' : 'pill-fail'}">
                                    {suite.passedCount} 通过 / {suite.results.length} 总计
                                </span>
                                <span class="suite-time">{suite.totalDurationMs} ms</span>
                            </div>
                        </div>

                        {#if isExpanded}
                            <div class="tests-list">
                                {#each suite.results as testItem, idx}
                                    {@const testKey = `${suite.name}_${idx}`}
                                    {@const hasError = testItem.status === 'fail'}
                                    <div class="test-row {hasError ? 'test-row--fail' : 'test-row--pass'}">
                                        <div class="test-row-main">
                                            <span class="test-icon">{hasError ? '❌' : '✓'}</span>
                                            <span class="test-name">{testItem.name}</span>
                                            <span class="test-duration">{testItem.durationMs} ms</span>
                                        </div>

                                        {#if hasError && testItem.error}
                                            <div class="test-error-box">
                                                <div class="error-msg-line">
                                                    <span>💥 错误: {testItem.error}</span>
                                                    {#if testItem.errorStack}
                                                        <button
                                                            class="toggle-stack-btn"
                                                            on:click={() => toggleError(testKey)}
                                                        >
                                                            {expandedErrors.has(testKey) ? '折叠堆栈' : '展开堆栈'}
                                                        </button>
                                                    {/if}
                                                </div>
                                                {#if expandedErrors.has(testKey) && testItem.errorStack}
                                                    <pre class="error-stack-pre">{testItem.errorStack}</pre>
                                                {/if}
                                            </div>
                                        {/if}
                                    </div>
                                {/each}
                            </div>
                        {/if}
                    </div>
                {/each}
            </div>
        {/if}
    </div>
</div>

<style>
    .self-test-container {
        display: flex;
        flex-direction: column;
        height: 100%;
        background: var(--b3-theme-background);
        color: var(--b3-theme-on-background);
        box-sizing: border-box;
        overflow: hidden;
    }

    .test-header {
        padding: 16px 20px;
        background: var(--b3-theme-surface);
        border-bottom: 1px solid var(--b3-border-color);
        display: flex;
        flex-direction: column;
        gap: 12px;
        flex-shrink: 0;
    }

    .header-main {
        display: flex;
        align-items: center;
        justify-content: space-between;
    }

    .header-title-block {
        display: flex;
        align-items: center;
        gap: 10px;
    }

    .test-title-icon {
        font-size: 24px;
    }

    .test-title-text {
        display: flex;
        flex-direction: column;
    }

    .title-main {
        font-size: 15px;
        font-weight: 700;
        color: var(--b3-theme-on-surface);
    }

    .title-sub {
        font-size: 11px;
        color: var(--b3-theme-on-surface-light);
        opacity: 0.7;
    }

    .header-actions {
        display: flex;
        gap: 8px;
        align-items: center;
    }

    .stats-banner {
        display: grid;
        grid-template-columns: repeat(5, 1fr);
        gap: 8px;
    }

    .stat-card {
        background: var(--b3-theme-background);
        border: 1px solid var(--b3-border-color);
        border-radius: 6px;
        padding: 6px 10px;
        display: flex;
        flex-direction: column;
        gap: 2px;
    }

    .stat-card--pass {
        border-color: rgba(16, 185, 129, 0.3);
        background: rgba(16, 185, 129, 0.05);
    }

    .stat-card--fail {
        border-color: rgba(239, 68, 68, 0.3);
        background: rgba(239, 68, 68, 0.05);
    }

    .stat-label {
        font-size: 10px;
        color: var(--b3-theme-on-surface-light);
    }

    .stat-val {
        font-size: 15px;
        font-weight: 700;
        font-family: ui-monospace, monospace;
    }

    .stat-val--pass {
        color: #10B981;
    }

    .stat-val--fail {
        color: #EF4444;
    }

    .status-badge {
        font-size: 11px;
        font-weight: 700;
        padding: 2px 6px;
        border-radius: 4px;
        display: inline-block;
    }

    .status-badge--running {
        color: #3B82F6;
    }

    .status-badge--all-pass {
        color: #059669;
    }

    .status-badge--has-fail {
        color: #DC2626;
    }

    .progress-bar-wrap {
        position: relative;
        height: 18px;
        background: var(--b3-theme-background);
        border-radius: 4px;
        overflow: hidden;
        border: 1px solid var(--b3-border-color);
        display: flex;
        align-items: center;
    }

    .progress-bar-inner {
        position: absolute;
        top: 0;
        left: 0;
        bottom: 0;
        background: var(--indexos-accent-primary, #3B82F6);
        transition: width 0.1s ease;
        opacity: 0.25;
    }

    .progress-text {
        position: relative;
        font-size: 10px;
        font-family: monospace;
        padding-left: 8px;
        color: var(--b3-theme-on-surface);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .test-body {
        flex: 1;
        overflow-y: auto;
        padding: 16px 20px;
    }

    .suites-list {
        display: flex;
        flex-direction: column;
        gap: 10px;
    }

    .suite-card {
        background: var(--b3-theme-surface);
        border: 1px solid var(--b3-border-color);
        border-radius: 8px;
        overflow: hidden;
    }

    .suite-card--fail {
        border-left: 4px solid #EF4444;
    }

    .suite-card--pass {
        border-left: 4px solid #10B981;
    }

    .suite-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 14px;
        background: var(--b3-theme-surface);
        cursor: pointer;
        user-select: none;
        transition: background 0.15s;
    }

    .suite-header:hover {
        background: var(--b3-theme-background-hover, rgba(0,0,0,0.03));
    }

    .suite-header-left {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .suite-expand-arrow {
        font-size: 10px;
        opacity: 0.6;
        transition: transform 0.2s;
    }

    .suite-expand-arrow.expanded {
        transform: rotate(0deg);
    }

    .suite-expand-arrow:not(.expanded) {
        transform: rotate(-90deg);
    }

    .suite-title {
        font-size: 13px;
        font-weight: 700;
    }

    .category-chip {
        font-size: 9px;
        font-family: monospace;
        text-transform: uppercase;
        background: var(--b3-theme-background);
        border: 1px solid var(--b3-border-color);
        padding: 1px 5px;
        border-radius: 4px;
        opacity: 0.7;
    }

    .suite-header-right {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .suite-summary-pill {
        font-size: 11px;
        font-weight: 600;
        padding: 2px 8px;
        border-radius: 10px;
    }

    .pill-pass {
        background: rgba(16, 185, 129, 0.12);
        color: #059669;
    }

    .pill-fail {
        background: rgba(239, 68, 68, 0.12);
        color: #DC2626;
    }

    .suite-time {
        font-size: 11px;
        font-family: monospace;
        opacity: 0.6;
    }

    .tests-list {
        border-top: 1px solid var(--b3-border-color);
        display: flex;
        flex-direction: column;
    }

    .test-row {
        padding: 8px 14px 8px 32px;
        border-bottom: 1px solid var(--b3-border-color);
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .test-row:last-child {
        border-bottom: none;
    }

    .test-row--fail {
        background: rgba(239, 68, 68, 0.03);
    }

    .test-row-main {
        display: flex;
        align-items: center;
        justify-content: space-between;
    }

    .test-icon {
        font-size: 11px;
        margin-right: 6px;
    }

    .test-name {
        flex: 1;
        font-size: 12px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }

    .test-duration {
        font-size: 10px;
        font-family: monospace;
        opacity: 0.5;
    }

    .test-error-box {
        margin-top: 4px;
        padding: 8px 10px;
        background: rgba(239, 68, 68, 0.08);
        border: 1px solid rgba(239, 68, 68, 0.2);
        border-radius: 4px;
        font-size: 11px;
        color: #DC2626;
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .error-msg-line {
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-weight: 600;
    }

    .toggle-stack-btn {
        background: transparent;
        border: none;
        color: #3B82F6;
        cursor: pointer;
        font-size: 10px;
        text-decoration: underline;
    }

    .error-stack-pre {
        margin: 4px 0 0 0;
        font-size: 10px;
        font-family: monospace;
        color: var(--b3-theme-on-surface);
        background: var(--b3-theme-background);
        padding: 6px;
        border-radius: 4px;
        overflow-x: auto;
        white-space: pre-wrap;
    }

    .spinner-small {
        display: inline-block;
        width: 10px;
        height: 10px;
        border: 2px solid rgba(255, 255, 255, 0.3);
        border-top-color: #fff;
        border-radius: 50%;
        animation: spin 0.6s linear infinite;
        vertical-align: -1px;
        margin-right: 4px;
    }

    @keyframes spin {
        to { transform: rotate(360deg); }
    }
</style>
