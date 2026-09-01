/**
 * features/self-test/core/assertion.ts
 *
 * 轻量级无依赖断言库 (Zero-dependency Assertions)
 */

export class AssertionError extends Error {
    public actual: any;
    public expected: any;

    constructor(message: string, actual?: any, expected?: any) {
        super(message);
        this.name = "AssertionError";
        this.actual = actual;
        this.expected = expected;
    }
}

function deepEqual(a: any, b: any): boolean {
    if (a === b) return true;
    if (a == null || b == null) return false;
    if (typeof a !== typeof b) return false;

    if (Array.isArray(a) && Array.isArray(b)) {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
            if (!deepEqual(a[i], b[i])) return false;
        }
        return true;
    }

    if (typeof a === "object") {
        const keysA = Object.keys(a);
        const keysB = Object.keys(b);
        if (keysA.length !== keysB.length) return false;
        for (const k of keysA) {
            if (!keysB.includes(k) || !deepEqual(a[k], b[k])) return false;
        }
        return true;
    }

    return false;
}

export function expect(actual: any) {
    const isNot = false;

    const createMatchers = (inverted: boolean) => ({
        toBe(expected: any) {
            const pass = actual === expected;
            if (inverted ? pass : !pass) {
                throw new AssertionError(
                    inverted
                        ? `Expected value NOT to be ${JSON.stringify(expected)}, but got ${JSON.stringify(actual)}`
                        : `Expected ${JSON.stringify(expected)}, but received ${JSON.stringify(actual)}`,
                    actual,
                    expected
                );
            }
        },

        toEqual(expected: any) {
            const pass = deepEqual(actual, expected);
            if (inverted ? pass : !pass) {
                throw new AssertionError(
                    inverted
                        ? `Expected value NOT to deeply equal ${JSON.stringify(expected)}`
                        : `Expected deep equality:\nExpected: ${JSON.stringify(expected, null, 2)}\nReceived: ${JSON.stringify(actual, null, 2)}`,
                    actual,
                    expected
                );
            }
        },

        toBeTruthy() {
            const pass = !!actual;
            if (inverted ? pass : !pass) {
                throw new AssertionError(
                    inverted
                        ? `Expected value NOT to be truthy, but got ${JSON.stringify(actual)}`
                        : `Expected value to be truthy, but got ${JSON.stringify(actual)}`,
                    actual,
                    true
                );
            }
        },

        toBeFalsy() {
            const pass = !actual;
            if (inverted ? pass : !pass) {
                throw new AssertionError(
                    inverted
                        ? `Expected value NOT to be falsy, but got ${JSON.stringify(actual)}`
                        : `Expected value to be falsy, but got ${JSON.stringify(actual)}`,
                    actual,
                    false
                );
            }
        },

        toBeNull() {
            const pass = actual === null;
            if (inverted ? pass : !pass) {
                throw new AssertionError(
                    inverted ? `Expected value NOT to be null` : `Expected null, but received ${JSON.stringify(actual)}`,
                    actual,
                    null
                );
            }
        },

        toBeUndefined() {
            const pass = actual === undefined;
            if (inverted ? pass : !pass) {
                throw new AssertionError(
                    inverted ? `Expected value NOT to be undefined` : `Expected undefined, but received ${JSON.stringify(actual)}`,
                    actual,
                    undefined
                );
            }
        },

        toContain(item: any) {
            let pass = false;
            if (typeof actual === "string" || Array.isArray(actual)) {
                pass = actual.includes(item);
            } else if (actual instanceof Set || actual instanceof Map) {
                pass = actual.has(item);
            }
            if (inverted ? pass : !pass) {
                throw new AssertionError(
                    inverted
                        ? `Expected container NOT to contain ${JSON.stringify(item)}`
                        : `Expected ${JSON.stringify(actual)} to contain ${JSON.stringify(item)}`,
                    actual,
                    item
                );
            }
        },

        toThrow(expectedErrorMsgOrRegex?: string | RegExp) {
            if (typeof actual !== "function") {
                throw new AssertionError(`Expected target to be a function, but got ${typeof actual}`);
            }
            let threw = false;
            let caughtError: any = null;
            try {
                actual();
            } catch (err: any) {
                threw = true;
                caughtError = err;
            }

            if (inverted) {
                if (threw) {
                    throw new AssertionError(`Expected function NOT to throw, but it threw: ${caughtError?.message || caughtError}`);
                }
            } else {
                if (!threw) {
                    throw new AssertionError(`Expected function to throw an error, but it did not`);
                }
                if (expectedErrorMsgOrRegex) {
                    const msg = caughtError?.message || String(caughtError);
                    if (expectedErrorMsgOrRegex instanceof RegExp) {
                        if (!expectedErrorMsgOrRegex.test(msg)) {
                            throw new AssertionError(`Expected thrown error message to match ${expectedErrorMsgOrRegex}, but got: "${msg}"`);
                        }
                    } else if (!msg.includes(expectedErrorMsgOrRegex)) {
                        throw new AssertionError(`Expected thrown error message to contain "${expectedErrorMsgOrRegex}", but got: "${msg}"`);
                    }
                }
            }
        }
    });

    return {
        ...createMatchers(false),
        not: createMatchers(true)
    };
}
