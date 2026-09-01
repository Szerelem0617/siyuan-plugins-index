/**
 * dispatcher/param-resolver.ts
 *
 * 负责参数解析、多层级来源合并、模版占位符实时替换 ({{time}}, {{cycle}}, {{prompt}} 等)
 * 以及 Auto-Context 链式推导与上下文块 ID 注入。
 */

import type { CommandDef } from "../registry/command-registry";
import { getBlockId, getParentIdAndRootId, getBlockAttrs, resolveLayer4Params } from "../utils/context-extractor";
import { renderTemplate, formatDate, formatTime } from "../utils/template-engine";
import { promptUserModal } from "../utils/prompt-modal";
import { navigateTopology, fetchNodeMeta } from "../utils/topology-navigator";
import { COMMAND_BINDINGS } from "../registration";
import type { CommandContext, ParamSources } from "./types";

export function parseParam(raw: string | Record<string, unknown> | null | undefined): Record<string, unknown> {
    if (!raw) return {};
    if (typeof raw === "object") return raw;
    try {
        const parsed = JSON.parse(raw);
        return typeof parsed === "object" && parsed !== null ? parsed : {};
    } catch (_) {
        return {};
    }
}

export function mergeParamSources(sources: ParamSources): Record<string, unknown> {
    const merged: Record<string, unknown> = { ...parseParam(sources.commandDb) };
    if (sources.auto) Object.assign(merged, sources.auto);
    if (sources.manual) {
        const parsedManual = parseParam(sources.manual);
        for (const [k, v] of Object.entries(parsedManual)) {
            if (v !== undefined && v !== "") {
                merged[k] = v;
            }
        }
    }
    return merged;
}

export async function resolveCommandParams(
    def: CommandDef,
    sources: ParamSources,
    context: CommandContext,
    specificCommandId?: string
): Promise<Record<string, unknown>> {
    const actualId = specificCommandId || (context as any)?.actualCommandId || def.id;
    
    // Layer 3 客制化入参 (最高优先级)
    const layer3Params = parseParam(sources.sources || sources.manual);

    // Layer 2 默认入参（优先精准匹配当前分身 commandRef，如 index.setBlockAttribute-1）
    let liveDbParam: any = null;
    try {
        const liveDbBinding = Object.values(COMMAND_BINDINGS).find(b => 
            b.commandRef === actualId || b.methodName === actualId || b.commandRef === def.id || b.methodName === def.name
        );
        liveDbParam = liveDbBinding?.inputMapping || liveDbBinding?.paramMapping;
    } catch (e) {
    }
    const layer2Params = parseParam(liveDbParam || sources.commandDb);

    const effectiveSources: ParamSources = {
        commandDb: liveDbParam || undefined,
        ...sources
    };
    const raw = mergeParamSources(effectiveSources);

    const result: Record<string, unknown> = {};

    for (const schema of def.params) {
        const layer3Val = layer3Params[schema.key];
        const layer2Val = layer2Params[schema.key];
        
        let value: any = undefined;
        const isLayer3Specified = layer3Val !== undefined && String(layer3Val).trim() !== "";

        if (isLayer3Specified) {
            // 1. 显式客制化配置 (Layer 3 / Manual Params) 拥有最高优先级
            value = layer3Val;
        } else if (layer2Val !== undefined && String(layer2Val).trim() !== "") {
            // 2. Layer 2 (Command-DB) 配置值
            value = layer2Val;
        } else {
            // 3. Supertag tag_created 专属 Auto-Context 智能推导 (仅在非 tag_created 生产时序且非自身命令时推导)
            let tagCreatedToken: string | undefined = undefined;
            const isTagCreatedEvent = context.eventName === "tag_created" || (context as any).event === "tag_created";
            if (context.supertag && !isTagCreatedEvent) {
                const { suggestTagCreatedBinding } = await import("../utils/tag-created-auto-context");
                const suggested = suggestTagCreatedBinding(context.supertag, schema.key, schema.type, def.id);
                if (suggested.matched && suggested.token) {
                    tagCreatedToken = suggested.token;
                    console.log(`  [ParamResolver Tag-Created-Auto-Context] ⚡ 为参数 "${schema.key}" 自动推导 tag_created 变量: "${tagCreatedToken}"`);
                }
            }

            // 4. Schema 注册默认值 或 tag_created 推导值
            value = tagCreatedToken || schema.default;
        }
        if (schema.key === "attrs" || schema.type === "attributes") {
            try {
                if (typeof value === "object" && value !== null) {
                    const resolvedObj: Record<string, any> = {};
                    for (const [attrK, attrV] of Object.entries(value)) {
                        const attrContext = { ...context, _currentAttrName: attrK };
                        resolvedObj[attrK] = typeof attrV === "string" ? await resolveTemplate(attrV, attrContext) : attrV;
                    }
                    result[schema.key] = resolvedObj;
                } else if (typeof value === "string") {
                    const trimmed = value.trim();
                    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
                        try {
                            const parsed = JSON.parse(trimmed);
                            const resolvedObj: Record<string, any> = {};
                            for (const [attrK, attrV] of Object.entries(parsed)) {
                                const attrContext = { ...context, _currentAttrName: attrK };
                                resolvedObj[attrK] = typeof attrV === "string" ? await resolveTemplate(String(attrV), attrContext) : attrV;
                            }
                            result[schema.key] = resolvedObj;
                        } catch {
                            const lines = value.split("\n");
                            const resolvedLines: string[] = [];
                            for (const line of lines) {
                                const colonIdx = line.indexOf(":");
                                const equalIdx = line.indexOf("=");
                                const splitIdx = colonIdx !== -1 ? colonIdx : equalIdx;
                                if (splitIdx !== -1) {
                                    const k = line.slice(0, splitIdx).trim();
                                    const v = line.slice(splitIdx + 1).trim();
                                    const attrContext = { ...context, _currentAttrName: k };
                                    const resV = await resolveTemplate(v, attrContext);
                                    resolvedLines.push(`${k}: ${resV}`);
                                } else if (line.trim()) {
                                    resolvedLines.push(await resolveTemplate(line, context));
                                }
                            }
                            result[schema.key] = resolvedLines.join("\n");
                        }
                    } else {
                        const lines = value.split("\n");
                        const resolvedLines: string[] = [];
                        for (const line of lines) {
                            const colonIdx = line.indexOf(":");
                            const equalIdx = line.indexOf("=");
                            const splitIdx = colonIdx !== -1 ? colonIdx : equalIdx;
                            if (splitIdx !== -1) {
                                const k = line.slice(0, splitIdx).trim();
                                const v = line.slice(splitIdx + 1).trim();
                                const attrContext = { ...context, _currentAttrName: k };
                                const resV = await resolveTemplate(v, attrContext);
                                resolvedLines.push(`${k}: ${resV}`);
                            } else if (line.trim()) {
                                resolvedLines.push(await resolveTemplate(line, context));
                            }
                        }
                        result[schema.key] = resolvedLines.join("\n");
                    }
                } else {
                    result[schema.key] = value;
                }
            } catch (err) {
                console.error(`  [ParamResolver attrs Error]:`, err);
                result[schema.key] = value;
            }
            continue;
        }

        const attrNameVal = String(result["attrName"] || layer3Params["attrName"] || layer2Params["attrName"] || raw["attrName"] || "").trim();
        const contextualContext = attrNameVal ? { ...context, _currentAttrName: attrNameVal } : context;
        try {
            if (schema.paramMode === "template") {
                result[schema.key] = await resolveTemplate(String(value ?? ""), contextualContext);
            } else if (typeof value === "string") {
                result[schema.key] = await resolveTemplate(value, contextualContext);
            } else {
                result[schema.key] = value;
            }
        } catch (err) {
            console.error(`  [ParamResolver STEP B Error] 参数 "${schema.key}" 解析模板失败:`, err);
            result[schema.key] = value;
        }

        // 自动统一处理：若参数为 id / blockid 且最终解析为空，系统自动填充当前上下文块 ID
        if ((schema.key === "id" || schema.type === "blockid") && (!result[schema.key] || String(result[schema.key]).trim() === "")) {
            const currentBlockId = getBlockId(context);
            if (currentBlockId) {
                result[schema.key] = currentBlockId;
                console.log(`  [ParamResolver Auto-Context-Default] ⚡ 自动为 "${schema.key}" 参数应用当前上下文块 ID: "${currentBlockId}"`);
            }
        }
    }

    for (const [k, v] of Object.entries(raw)) {
        if (!(k in result)) {
            try {
                result[k] = typeof v === "string" ? await resolveTemplate(v, context) : v;
            } catch (_) {
                result[k] = v;
            }
        }
    }

    return result;
}

/**
 * 智能变量与属性解析核心（支持 var. 统一前缀、多态局部优先与显式全局/跨标签逃逸）：
 * 1. 显式全局逃逸：var.global.prop / var.global-prop / global.prop / global-prop -> 读取 custom-<prop> 或原生内置属性 (name, memo, alias, bookmark)
 * 2. 显式跨标签路由：var.<tag>.<prop> / <tag>.<prop> -> 读取 custom-tag--<tag>--<prop>
 * 3. 裸变量/属性智能多态解析：var.<prop> 或 <prop>
 *    - Priority 1: context.vars (内存中运行时出参，如 step 产出的 createdblock, last_id)
 *    - Priority 2: 当前 Supertag 局部属性 custom-tag--<currentTag>--<prop>
 *    - Priority 3: 全局属性 custom-<prop> 或原生属性 (name, memo, alias, bookmark)
 *    - Priority 4: 块上挂载的其他 Supertag 局部属性 custom-tag--*--<prop>
 *    - Priority 5: 物理原键匹配 (如 custom-xxx)
 */
export function resolveVarExpression(
    rawToken: string,
    context: CommandContext,
    blockAttrs: Record<string, string> = {}
): string | undefined {
    let token = (rawToken || "").trim();
    if (!token) return undefined;

    // 剥离 var. 前缀（统一归一化，既支持 {{var.status}} 也支持 {{status}}）
    const isVarPrefixed = token.startsWith("var.");
    const bareToken = isVarPrefixed ? token.slice(4).trim() : token;

    // 1. 优先检查 context.vars 中是否存在完全匹配的显式出参（例如复合命令/触发器 Step 产出的 createdblock, last_id）
    if (context.vars) {
        if (token in context.vars && context.vars[token] !== undefined && context.vars[token] !== null) {
            return String(context.vars[token]);
        }
        if (bareToken in context.vars && context.vars[bareToken] !== undefined && context.vars[bareToken] !== null) {
            return String(context.vars[bareToken]);
        }
        const varDotKey = `var.${bareToken}`;
        if (varDotKey in context.vars && context.vars[varDotKey] !== undefined && context.vars[varDotKey] !== null) {
            return String(context.vars[varDotKey]);
        }
    }

    const currentTag = (context.supertag || "").replace(/#/g, "").trim().toLowerCase();

    // 2. 显式全局逃逸：var.global.prop / var.global-prop / global.prop / global-prop
    const globalMatch = bareToken.match(/^global[.-](.+)$/i);
    if (globalMatch) {
        const prop = globalMatch[1].trim();
        const lowerProp = prop.toLowerCase();
        // 原生内置属性 (name, memo, alias, bookmark)
        if (["name", "memo", "alias", "bookmark"].includes(lowerProp)) {
            if (lowerProp in blockAttrs && blockAttrs[lowerProp] !== undefined) return String(blockAttrs[lowerProp]);
            if (prop in blockAttrs && blockAttrs[prop] !== undefined) return String(blockAttrs[prop]);
        }
        // 全局自定义属性 custom-<prop>
        const customKey = `custom-${prop}`;
        if (customKey in blockAttrs && blockAttrs[customKey] !== undefined) {
            return String(blockAttrs[customKey]);
        }
        return undefined;
    }

    // 3. 显式跨标签路由：var.<tag>.<prop> 或 <tag>.<prop> (如 var.article.word_count 或 article.word_count)
    const tagMatch = bareToken.match(/^([a-zA-Z0-9_-]+)\.(.+)$/);
    if (tagMatch) {
        const targetTag = tagMatch[1].trim().toLowerCase();
        const prop = tagMatch[2].trim();
        const customTagKey = `custom-tag--${targetTag}--${prop}`;
        if (customTagKey in blockAttrs && blockAttrs[customTagKey] !== undefined) {
            return String(blockAttrs[customTagKey]);
        }
    }

    // 4. 缺省裸字段多态决议 (如 bareToken 为 "card-id", "status", "word_count")
    const prop = bareToken;

    // 4.1 优先级 1: 当前 Supertag 局部属性 (custom-tag--<currentTag>--<prop>)
    if (currentTag) {
        const localKey = `custom-tag--${currentTag}--${prop}`;
        if (localKey in blockAttrs && blockAttrs[localKey] !== undefined && blockAttrs[localKey] !== "") {
            return String(blockAttrs[localKey]);
        }
    }

    // 4.2 优先级 2: 全局属性 (custom-<prop>) 或原生内置属性
    const lowerProp = prop.toLowerCase();
    if (["name", "memo", "alias", "bookmark"].includes(lowerProp)) {
        if (lowerProp in blockAttrs && blockAttrs[lowerProp] !== undefined) return String(blockAttrs[lowerProp]);
        if (prop in blockAttrs && blockAttrs[prop] !== undefined) return String(blockAttrs[prop]);
    }
    const globalCustomKey = `custom-${prop}`;
    if (globalCustomKey in blockAttrs && blockAttrs[globalCustomKey] !== undefined && blockAttrs[globalCustomKey] !== "") {
        return String(blockAttrs[globalCustomKey]);
    }

    // 4.3 优先级 3: 块上挂载的其他 Supertag 局部属性 (custom-tag--*--<prop>)
    for (const [attrKey, attrVal] of Object.entries(blockAttrs)) {
        if (attrKey.startsWith("custom-tag--") && attrKey.endsWith(`--${prop}`)) {
            if (attrVal !== undefined && attrVal !== "") {
                return String(attrVal);
            }
        }
    }

    // 4.4 优先级 4: 物理原键直配 (例如传入 custom-tag--task--status 或 custom-xxx)
    if (prop in blockAttrs && blockAttrs[prop] !== undefined) {
        return String(blockAttrs[prop]);
    }

    return undefined;
}

export async function resolveTemplate(text: string, context: CommandContext): Promise<string> {
    if (!text || typeof text !== "string" || (!text.includes("{{") && !text.includes("${"))) return text;

    let normalizedText = text.replace(/\$\{([a-zA-Z0-9_.:-]+)\}/g, "{{$1}}");

    if (normalizedText.includes("{{prompt") || normalizedText.includes("{{interactive") || normalizedText.includes("{{input")) {
        const isBackground = context.executionMode === "background";
        const promptRegex = /\{\{(prompt|interactive|input)(?::([^}]+))?\}\}/g;
        let match: RegExpExecArray | null;

        if (!context.promptCache) {
            context.promptCache = new Map<string, string>();
        }

        while ((match = promptRegex.exec(normalizedText)) !== null) {
            const fullPlaceholder = match[0];
            if (isBackground) {
                normalizedText = normalizedText.replace(fullPlaceholder, "");
            } else {
                const titlePrompt = match[2]?.trim() || "请输入参数内容";
                let userInput: string;

                if (context.promptCache.has(titlePrompt)) {
                    userInput = context.promptCache.get(titlePrompt)!;
                } else {
                    const res = await promptUserModal(titlePrompt);
                    userInput = res ?? "";
                    context.promptCache.set(titlePrompt, userInput);
                }

                if (!context.vars) context.vars = {};
                context.vars[`prompt_${titlePrompt}`] = userInput;
                context.vars["prompt"] = userInput;

                normalizedText = normalizedText.replace(fullPlaceholder, userInput);
            }
        }
    }

    let blockId = "";
    try {
        blockId = getBlockId(context);
    } catch (_) {}

    const cleanTag = (context.supertag || "").replace(/#/g, "").trim();

    const variables: Record<string, string> = {
        "date": formatDate(new Date()),
        "time": formatTime(new Date()),
        "supertag": cleanTag,
        "tag": cleanTag,
        "context.supertag": cleanTag,
        "context.tag": cleanTag,
        "self.id": blockId || "",
        "self": blockId || "",
        "this.id": blockId || "",
        "this": blockId || "",
        "block_id": blockId || "",
        "id": blockId || "",
    };

    if (context.vars) {
        for (const [k, v] of Object.entries(context.vars)) {
            if (v !== undefined && v !== null) {
                const strVal = String(v);
                const varKey = k.startsWith("var.") ? k : `var.${k}`;
                variables[varKey] = strVal;
                variables[k] = strVal;
            }
        }
    }

    if (blockId && (normalizedText.includes("{{root_id}}") || normalizedText.includes("{{parent_id}}") || normalizedText.includes("{{root.id}}") || normalizedText.includes("{{parent.id}}"))) {
        try {
            const { rootId, parentId } = await getParentIdAndRootId(blockId);
            variables["root_id"] = rootId;
            variables["root.id"] = rootId;
            variables["parent_id"] = parentId;
            variables["parent.id"] = parentId;
        } catch (_) {}
    }

    let blockAttrs: Record<string, string> = {};
    if (blockId) {
        try {
            blockAttrs = await getBlockAttrs(blockId) || {};
        } catch (_) {}
    }

    // 🌟 核心智能变量解析：扫描模板中所有 {{xxx}}，通过 resolveVarExpression 进行多态优先级决议
    const tokenMatches = normalizedText.match(/\{\{([a-zA-Z0-9_.:-]+)\}\}/g);
    if (tokenMatches) {
        for (const fullMatch of tokenMatches) {
            const token = fullMatch.slice(2, -2).trim();
            if (token in variables) continue;
            if (token.startsWith("cycle") || token.startsWith("prompt") || token.startsWith("interactive") || token.startsWith("input")) continue;

            const resolvedVar = resolveVarExpression(token, context, blockAttrs);
            if (resolvedVar !== undefined) {
                variables[token] = resolvedVar;
            }
        }
    }

    // 🔄 状态轮转指令解析：{{cycle:v1,v2,v3}} 或 {{cycle}}
    if (normalizedText.includes("{{cycle")) {
        const cycleRegex = /\{\{cycle(?::([^}]+))?\}\}/g;
        let cycleMatch: RegExpExecArray | null;
        while ((cycleMatch = cycleRegex.exec(normalizedText)) !== null) {
            const fullPlaceholder = cycleMatch[0];
            const optionsRaw = cycleMatch[1]?.trim();

            let options: string[] = [];
            if (optionsRaw !== undefined && optionsRaw !== null && optionsRaw !== "") {
                options = optionsRaw.split(",").map(s => s.trim().replace(/^["']|["']$/g, ""));
            }

            const currentAttrName = (context as any)?._currentAttrName || "";
            const currentTag = (context?.supertag || "").replace(/#/g, "").trim().toLowerCase();

            // 💡 智能感知数据库列 Schema：若未提供显式候选，自动从关联数据库 Select 列中提取 options
            if (options.length === 0 && currentTag && currentAttrName) {
                try {
                    const { supertagAVProjector } = await import("../../unified-attributes/projection/supertag-av-projector");
                    const { getColIDMap } = await import("../../../shared/utils/av-utils");
                    const rootTag = currentTag.split(/[\.\/]/)[0].toLowerCase();
                    const boundAvId = supertagAVProjector.getBoundAv(currentTag) || supertagAVProjector.getBoundAv(rootTag);
                    if (boundAvId) {
                        const { keyValues } = await getColIDMap(boundAvId);
                        const cleanKey = currentAttrName.replace(new RegExp(`^custom-${currentTag}[.-]`), "").replace(/^custom-/, "").trim().toLowerCase();
                        const matchedCol = keyValues.find((kv: any) => kv.key && (kv.key.name?.toLowerCase() === cleanKey || kv.key.id === cleanKey));
                        if (matchedCol && matchedCol.key && Array.isArray(matchedCol.key.options) && matchedCol.key.options.length > 0) {
                            options = matchedCol.key.options.map((o: any) => o.name || o.content || String(o)).filter(Boolean);
                        }
                    }
                } catch (_) {}
            }

            if (options.length === 0) {
                options = ["pending", "done"];
            }

            let currentVal = "";
            if (currentAttrName) {
                const cleanKey = currentAttrName.replace(/^custom-/, "");
                currentVal = variables[cleanKey] || variables[`custom-${cleanKey}`] || variables[currentAttrName] || "";
            }

            let nextVal = options[0];
            const currentIndex = options.indexOf(currentVal);
            if (currentIndex >= 0) {
                nextVal = options[(currentIndex + 1) % options.length];
            } else {
                nextVal = options[0];
            }

            console.log(`[TemplateEngine] 🔄 {{cycle}} 轮转计算: 当前值 "${currentVal}" ➔ 下一状态 "${nextVal}" (候选列表: [${options.join(", ")}])`);
            normalizedText = normalizedText.replace(fullPlaceholder, nextVal);
        }
    }

    // 🌐 今日日记文档宏解析：{{daily_doc}}, {{daily_doc_id}}, {{daily_doc.id}}, {{today_doc}}
    if (normalizedText.includes("{{daily_doc") || normalizedText.includes("{{today_doc")) {
        try {
            let targetBox = "";
            if (blockId) {
                const nodeMeta = await fetchNodeMeta(blockId);
                targetBox = nodeMeta?.box || "";
            }
            if (!targetBox) {
                const activeProtyle = (window as any).activeProtyleInstance || (window as any).siyuan?.ws?.protyle;
                targetBox = activeProtyle?.notebookId || "";
            }

            let resolvedDailyId = "";
            if (targetBox) {
                // 1. 调用思源官方日记 API (支持按笔记本配置路径自动创建/获取)
                const res = await post("/api/filetree/createDailyNote", {
                    notebook: targetBox,
                    app: "siyuan"
                });
                if (res?.data?.id) {
                    resolvedDailyId = res.data.id;
                }
            }

            if (!resolvedDailyId) {
                // 2. 降级 SQL 查询当前笔记本或全局今日日记
                const todayStr = formatDate(new Date());
                const boxClause = targetBox ? `AND box = '${targetBox}'` : "";
                const dailyRes = await post("/api/query/sql", {
                    stmt: `SELECT id FROM blocks WHERE type = 'd' ${boxClause} AND content = '${todayStr}' LIMIT 1`
                });
                const dailyRows = Array.isArray(dailyRes) ? dailyRes : (dailyRes?.data || []);
                if (dailyRows.length > 0) {
                    resolvedDailyId = dailyRows[0].id;
                }
            }

            if (resolvedDailyId) {
                variables["daily_doc"] = resolvedDailyId;
                variables["daily_doc.id"] = resolvedDailyId;
                variables["daily_doc_id"] = resolvedDailyId;
                variables["today_doc"] = resolvedDailyId;
                variables["today_doc.id"] = resolvedDailyId;
            }
        } catch (e) {
            console.warn(`[ParamResolver] 解析 daily_doc 失败:`, e);
        }
    }

    // 🌐 拓扑导航宏与链式路径解析 (如 {{self.id}}, {{doc.id}}, {{doc.next.id}}, {{doc.prev.id}}, {{prev.id}}, {{next.id}}, {{parent.id}}, {{root.id}}, {{notebook.id}}, {{block.id}}, {{block1.id}} 等)
    const topologyMatches = normalizedText.match(/\{\{([a-zA-Z0-9_.:-]+)\}\}/g);
    if (topologyMatches && blockId) {
        for (const fullMatch of topologyMatches) {
            const token = fullMatch.slice(2, -2).trim();
            if (token in variables) continue;
            if (token.startsWith("attr:") || token.startsWith("var.") || token.startsWith("cycle") || token.startsWith("prompt")) continue;

            const navPattern = /^(?:self|this|doc|page|notebook|box|root|prev|previous|next|parent|child|children|block)(?:[._\d]|$)/i;
            if (navPattern.test(token)) {
                try {
                    let pathExpr = token
                        .replace(/_id$/i, "")
                        .replace(/_block$/i, "")
                        .replace(/parent_doc/i, "doc.parent")
                        .replace(/doc_next/i, "doc.next")
                        .replace(/doc_prev/i, "doc.prev")
                        .replace(/prev_block/i, "prev")
                        .replace(/next_block/i, "next")
                        .replace(/parent_block/i, "parent")
                        .replace(/_/g, ".");

                    const resolvedNavId = await navigateTopology(blockId, pathExpr);
                    if (resolvedNavId) {
                        variables[token] = resolvedNavId;
                        console.log(`[ParamResolver Topology] 🌐 拓扑路径解析成功: {{${token}}} ➔ "${resolvedNavId}" (起始: ${blockId})`);
                    }
                } catch (navErr) {
                    console.warn(`[ParamResolver Topology] 解析 {{${token}}} 异常:`, navErr);
                }
            }
        }
    }

    return renderTemplate(normalizedText, variables);
}
