/**
 * tokenizer.ts
 *
 * 轻量级 SQL Tokenizer 与语法解析提取器 (专为 Siyuan AV DML/DDL 语法设计)
 * 零第三方依赖，精准识别字符串字面量、转义引号、逗号分隔符与嵌套括号。
 */

export interface ParsedSetAssignment {
    colName: string;
    value: any;
}

/**
 * 安全解析 SET 子句：col1 = 'val1, val2', col2 = 123
 */
export function parseSetAssignments(setStr: string): Record<string, any> {
    const result: Record<string, any> = {};
    const tokens = tokenizeSqlClause(setStr);
    
    let currentKey = "";
    let currentValueTokens: string[] = [];
    let isValueMode = false;

    for (let idx = 0; idx < tokens.length; idx++) {
        const token = tokens[idx];
        if (!isValueMode) {
            if (token === "=") {
                isValueMode = true;
            } else {
                currentKey += token;
            }
        } else {
            if (token === "," && !inNestedExpression(currentValueTokens)) {
                const key = cleanIdentifier(currentKey);
                const rawVal = currentValueTokens.join("").trim();
                result[key] = parsePrimitiveValue(rawVal);
                currentKey = "";
                currentValueTokens = [];
                isValueMode = false;
            } else {
                currentValueTokens.push(token);
            }
        }
    }

    if (currentKey.trim() && isValueMode) {
        const key = cleanIdentifier(currentKey);
        const rawVal = currentValueTokens.join("").trim();
        result[key] = parsePrimitiveValue(rawVal);
    }

    return result;
}

/**
 * 安全解析 (col1, col2, col3) 列表
 */
export function parseColumnList(colsStr: string): string[] {
    const rawItems = splitByTopLevelComma(colsStr);
    return rawItems.map(item => cleanIdentifier(item));
}

/**
 * 安全解析 VALUES (val1, val2), (val3, val4) 子句
 */
export function parseValuesTuples(valsStr: string): any[][] {
    const tuples: any[][] = [];
    const trimmed = valsStr.trim();
    
    // 匹配一组或多组 (...) 元组
    let i = 0;
    let inTuple = false;
    let currentTupleStr = "";
    let parenDepth = 0;
    let inQuote = false;
    let quoteChar = "";

    while (i < trimmed.length) {
        const char = trimmed[i];
        if (inQuote) {
            currentTupleStr += char;
            if (char === quoteChar && trimmed[i - 1] !== "\\") {
                inQuote = false;
            }
        } else {
            if (char === "'" || char === '"' || char === "`") {
                inQuote = true;
                quoteChar = char;
                currentTupleStr += char;
            } else if (char === "(") {
                if (parenDepth === 0) {
                    inTuple = true;
                    currentTupleStr = "";
                } else {
                    currentTupleStr += char;
                }
                parenDepth++;
            } else if (char === ")") {
                parenDepth--;
                if (parenDepth === 0 && inTuple) {
                    inTuple = false;
                    const items = splitByTopLevelComma(currentTupleStr);
                    tuples.push(items.map(it => parsePrimitiveValue(it)));
                    currentTupleStr = "";
                } else {
                    currentTupleStr += char;
                }
            } else {
                if (inTuple) {
                    currentTupleStr += char;
                }
            }
        }
        i++;
    }

    // 单组无外层括号容错处理
    if (tuples.length === 0 && trimmed.length > 0) {
        const items = splitByTopLevelComma(trimmed);
        tuples.push(items.map(it => parsePrimitiveValue(it)));
    }

    return tuples;
}

/**
 * 按顶层逗号分割表达式（忽略单双引号字面量内部的逗号）
 */
export function splitByTopLevelComma(str: string): string[] {
    const results: string[] = [];
    let current = "";
    let inQuote = false;
    let quoteChar = "";
    let parenDepth = 0;

    for (let i = 0; i < str.length; i++) {
        const char = str[i];
        if (inQuote) {
            current += char;
            if (char === quoteChar && str[i - 1] !== "\\") {
                inQuote = false;
            }
        } else {
            if (char === "'" || char === '"' || char === "`") {
                inQuote = true;
                quoteChar = char;
                current += char;
            } else if (char === "(") {
                parenDepth++;
                current += char;
            } else if (char === ")") {
                parenDepth--;
                current += char;
            } else if (char === "," && parenDepth === 0) {
                results.push(current.trim());
                current = "";
            } else {
                current += char;
            }
        }
    }
    if (current.trim()) {
        results.push(current.trim());
    }
    return results;
}

/**
 * 将字符串解析为基础 JS 数据类型
 */
export function parsePrimitiveValue(valStr: string): any {
    const trimmed = valStr.trim();
    if (trimmed.toLowerCase() === "true") return true;
    if (trimmed.toLowerCase() === "false") return false;
    if (trimmed.toLowerCase() === "null") return null;

    // 引号包包裹的字符串
    if ((trimmed.startsWith("'") && trimmed.endsWith("'")) ||
        (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
        (trimmed.startsWith("`") && trimmed.endsWith("`"))) {
        return trimmed.slice(1, -1).replace(/\\(["'`])/g, "$1");
    }

    // 数字字面量
    if (!isNaN(Number(trimmed)) && trimmed !== "") {
        return Number(trimmed);
    }

    // JSON 数组/对象尝试
    if ((trimmed.startsWith("[") && trimmed.endsWith("]")) ||
        (trimmed.startsWith("{") && trimmed.endsWith("}"))) {
        try {
            return JSON.parse(trimmed);
        } catch {
            return trimmed;
        }
    }

    return trimmed;
}

/**
 * 清理标识符名称（移除反引号、双引号、单引号与前后空白）
 */
export function cleanIdentifier(name: string): string {
    return name.trim().replace(/^['"`]|['"`]$/g, "");
}

/**
 * 将 SQL 语句解析为 Token 节点序列
 */
function tokenizeSqlClause(str: string): string[] {
    const tokens: string[] = [];
    let current = "";
    let inQuote = false;
    let quoteChar = "";

    for (let i = 0; i < str.length; i++) {
        const char = str[i];
        if (inQuote) {
            current += char;
            if (char === quoteChar && str[i - 1] !== "\\") {
                tokens.push(current);
                current = "";
                inQuote = false;
            }
        } else {
            if (char === "'" || char === '"' || char === "`") {
                if (current.trim()) tokens.push(current.trim());
                current = char;
                inQuote = true;
                quoteChar = char;
            } else if (char === "=" || char === ",") {
                if (current.trim()) tokens.push(current.trim());
                tokens.push(char);
                current = "";
            } else {
                current += char;
            }
        }
    }
    if (current.trim()) tokens.push(current.trim());
    return tokens;
}

function inNestedExpression(tokens: string[]): boolean {
    let openCount = 0;
    for (const t of tokens) {
        if (t.includes("(")) openCount++;
        if (t.includes(")")) openCount--;
    }
    return openCount > 0;
}
