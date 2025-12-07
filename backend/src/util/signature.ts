
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
            .sort(([a], [b]) => {
                if (a < b) return -1;
                if (a > b) return 1;
                return 0;
            })
            .map(([key, val]) => `${JSON.stringify(key)}:${canonicalize(val)}`);
        return `{${entries.join(',')}}`;
    }

    return JSON.stringify(value);
}
