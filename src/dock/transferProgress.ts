export type TransferProgressEntry = {
    progress: number;
    visible: boolean;
    revision: number;
};

export function resolveActiveTransfers(
    sources: Iterable<ReadonlyMap<string, TransferProgressEntry>>,
): Map<string, TransferProgressEntry> {
    const active = new Map<string, TransferProgressEntry>();
    for (const entries of sources) {
        for (const [appId, entry] of entries) {
            if (entry.visible && (!active.has(appId) || entry.revision > active.get(appId)!.revision))
                active.set(appId, entry);
        }
    }
    return active;
}
