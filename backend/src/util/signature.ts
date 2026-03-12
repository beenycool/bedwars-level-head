/**
 * Serializes an object into a canonical JSON string format.
 * This ensures that objects with identical data but different key orders
 * or formatting will produce the exact same string, which is necessary
 * for deterministic signature verification.
 *
 * ⚡ Bolt: Optimization
 * Replaced Object.entries().sort().map().join() and array.map().join()
 * with direct string concatenation in standard for loops.
 * This avoids multiple intermediate O(N) array allocations per nested object/array,
 * significantly reducing memory allocations and GC pressure during recursive canonicalization
 * of large payloads (e.g. Hypixel player stats).
 */
export function canonicalize(value: unknown): string {
    if (value === undefined) {
        return 'undefined';
    }
    if (value === null) {
        return 'null';
    }

    if (Array.isArray(value)) {
        let str = '[';
        for (let i = 0; i < value.length; i++) {
            if (i > 0) str += ',';
            str += canonicalize(value[i]);
        }
        str += ']';
        return str;
    }

    if (typeof value === 'object') {
        const obj = value as Record<string, unknown>;
        const keys = Object.keys(obj).sort();
        let str = '{';
        for (let i = 0; i < keys.length; i++) {
            if (i > 0) str += ',';
            const key = keys[i];
            str += JSON.stringify(key) + ':' + canonicalize(obj[key]);
        }
        str += '}';
        return str;
    }

    return JSON.stringify(value);
}
