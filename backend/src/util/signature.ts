
export function canonicalize(value: unknown): string {
    if (value === undefined) {
        return 'undefined';
    }
    if (value === null) {
        return 'null';
    }

    if (Array.isArray(value)) {
        return `[${value.map(canonicalize).join(',')}]`;
    }

    if (value !== null && typeof value === 'object') {
        const entries = Object.entries(value as Record<string, unknown>)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, val]) => `${JSON.stringify(key)}:${canonicalize(val)}`);
        return `{${entries.join(',')}}`;
    }

    return JSON.stringify(value);
}
