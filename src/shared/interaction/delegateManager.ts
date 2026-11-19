type DelegateHost = {
    _delegate?: Record<string, unknown> | null;
};

interface DelegateState {
    original: Record<string, unknown> | null | undefined;
    layers: Map<symbol, Record<string, unknown>>;
    current: Record<string, unknown> | null;
}

/**
 * Composes multiple feature delegates on one actor and safely removes them
 * in any order without restoring an already-disposed delegate layer.
 */
export class DelegateManager<T extends DelegateHost> {
    private readonly states = new Map<T, DelegateState>();

    add(target: T, delegate: Record<string, unknown>): () => void {
        let state = this.states.get(target);
        if (!state) {
            state = {
                original: target._delegate,
                layers: new Map(),
                current: null,
            };
            this.states.set(target, state);
        }

        const token = Symbol('delegate-layer');
        state.layers.set(token, delegate);
        try {
            this.apply(target, state);
        } catch (error) {
            state.layers.delete(token);
            if (state.layers.size === 0)
                this.states.delete(target);
            throw error;
        }

        let disposed = false;
        return () => {
            if (disposed)
                return;
            disposed = true;
            state!.layers.delete(token);

            if (target._delegate === state!.current) {
                if (state!.layers.size > 0)
                    this.apply(target, state!);
                else
                    this.restore(target, state!);
            }

            if (state!.layers.size === 0)
                this.states.delete(target);
        };
    }

    private apply(target: T, state: DelegateState): void {
        const composed = Object.assign(
            Object.create(state.original ?? null),
            ...state.layers.values(),
        ) as Record<string, unknown>;
        state.current = composed;
        target._delegate = composed;
    }

    private restore(target: T, state: DelegateState): void {
        if (state.original)
            target._delegate = state.original;
        else
            delete target._delegate;
        state.current = null;
    }

    get size(): number {
        return this.states.size;
    }
}
