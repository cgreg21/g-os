/** Minimal actor contract kept independent from GJS so animation ownership is testable. */
export interface AnimationTarget {
    ease(params: AnimationParameters): void;
    remove_transition(property: string): void;
}

export interface AnimationParameters extends Record<string, unknown> {
    duration: number;
    mode?: number;
    onComplete?: () => void;
}

export interface AnimationOptions {
    durationMs: number;
    mode: number;
    onComplete?: () => void;
}

interface ActiveAnimation {
    actor: AnimationTarget;
    properties: string[];
}

/** Owns keyed actor transitions, replacing stale animations and guarding callbacks. */
export class AnimationManager {
    private readonly active = new Map<string, ActiveAnimation>();
    private readonly requests = new Map<string, symbol>();
    private destroyed = false;

    animate(
        key: string,
        actor: AnimationTarget,
        properties: Record<string, number>,
        options: AnimationOptions,
    ): void {
        if (this.destroyed)
            return;

        const request = Symbol(`animation:${key}`);
        this.requests.set(key, request);
        this.cancelActive(key);
        // remove_transition() may synchronously re-enter animate() or cancel().
        // The nested operation is newer and must retain ownership of this key.
        if (this.destroyed || this.requests.get(key) !== request)
            return;
        const animation: ActiveAnimation = {
            actor,
            properties: Object.keys(properties).map(property => property.replace(/_/g, '-')),
        };
        this.active.set(key, animation);
        const params: AnimationParameters = {
            ...properties,
            duration: Math.max(0, options.durationMs),
            mode: options.mode,
            onComplete: () => {
                if (this.destroyed || this.active.get(key) !== animation ||
                    this.requests.get(key) !== request)
                    return;
                this.active.delete(key);
                this.requests.delete(key);
                options.onComplete?.();
            },
        };

        try {
            actor.ease(params);
        } catch (error) {
            if (this.active.get(key) === animation)
                this.active.delete(key);
            if (this.requests.get(key) === request)
                this.requests.delete(key);
            throw error;
        }
    }

    cancel(key: string): void {
        this.requests.delete(key);
        this.cancelActive(key);
    }

    private cancelActive(key: string): void {
        const animation = this.active.get(key);
        if (!animation)
            return;
        this.active.delete(key);
        for (const property of animation.properties) {
            try {
                animation.actor.remove_transition(property);
            } catch (error) {
                // Continue cancelling remaining properties if an actor is already disposed.
                try {
                    logError(error as Error, `Unable to cancel animation transition: ${property}`);
                } catch {
                    // Logging must not prevent later transitions from being cancelled.
                }
            }
        }
    }

    cancelAll(): void {
        for (const key of [...this.active.keys()])
            this.cancel(key);
    }

    destroy(): void {
        if (this.destroyed)
            return;
        this.destroyed = true;
        this.cancelAll();
    }

    get size(): number {
        return this.active.size;
    }

    get isDestroyed(): boolean {
        return this.destroyed;
    }
}
