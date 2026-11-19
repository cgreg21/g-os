import Clutter from 'gi://Clutter';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';
import { LifecycleScope } from '../../core/lifecycleScope.js';
import { DelegateManager } from './delegateManager.js';

type DelegateActor = Clutter.Actor & {
    _delegate?: Record<string, unknown> | null;
};

export interface DragSourceCallbacks {
    onBegin?: () => void;
    onMotion?: (event: any) => void;
    onEnd?: (success: boolean) => void;
    onCancelled?: () => void;
    onDestroy?: () => void;
}

export interface DragSourceOptions {
    dragActorOpacity?: number;
}

export interface DropTargetDelegate {
    handleDragOver?: (...args: any[]) => number;
    acceptDrop?: (...args: any[]) => boolean;
    [key: string]: unknown;
}

interface SourceRegistration {
    dispose: () => void;
}

/**
 * Owns GNOME Shell drag sources and drop-target delegates.
 *
 * This class deliberately knows nothing about item ordering, insertion
 * geometry, previews, folders or removal policies. Features provide those
 * behaviors through delegates and lifecycle callbacks.
 */
export class DragAndDropController {
    private sources = new Map<DelegateActor, SourceRegistration>();
    private readonly delegates = new DelegateManager<DelegateActor>();
    private targets = new Map<DelegateActor, () => void>();
    private destroyed = false;

    registerSource(
        actor: DelegateActor,
        delegate: Record<string, unknown>,
        callbacks: DragSourceCallbacks = {},
        options: DragSourceOptions = {},
        lifecycle?: LifecycleScope,
    ): () => void {
        if (this.destroyed)
            return () => {};

        this.unregisterSource(actor);

        const removeDelegate = this.delegates.add(actor, delegate);

        let draggable: ReturnType<typeof DND.makeDraggable>;
        try {
            draggable = DND.makeDraggable(actor, {
                dragActorOpacity: options.dragActorOpacity,
            });
        } catch (error) {
            removeDelegate();
            throw error;
        }

        let disposed = false;
        let dragMonitor: {dragMotion: (event: any) => number} | null = null;
        let actorDestroySignal = 0;
        const signalIds: number[] = [];
        const removeDragMonitor = () => {
            if (!dragMonitor)
                return;
            const monitor = dragMonitor;
            dragMonitor = null;
            try {
                DND.removeDragMonitor(monitor);
            } catch (error) {
                // A monitor may already have been removed during Shell teardown.
                logError(error as Error, 'Unable to remove g-os drag monitor');
            }
        };

        const dispose = () => {
            if (disposed)
                return;
            disposed = true;
            removeDragMonitor();
            for (const signalId of signalIds) {
                try {
                    draggable.disconnect(signalId);
                } catch (error) {
                    logError(error as Error, 'Unable to disconnect g-os drag signal');
                }
            }
            if (actorDestroySignal) {
                try {
                    actor.disconnect(actorDestroySignal);
                } catch (error) {
                    logError(error as Error, 'Unable to disconnect g-os actor destroy signal');
                }
            }
            removeDelegate();
            this.sources.delete(actor);
        };

        try {
            signalIds.push(draggable.connect('drag-begin', () => {
                if (disposed)
                    return;
                callbacks.onBegin?.();
                // onBegin may synchronously unregister or destroy this source.
                if (disposed || !callbacks.onMotion)
                    return;
                dragMonitor = {
                    dragMotion: event => {
                        if (!disposed)
                            callbacks.onMotion?.(event);
                        return DND.DragMotionResult.CONTINUE;
                    },
                };
                DND.addDragMonitor(dragMonitor);
            }));
            signalIds.push(draggable.connect('drag-end', (_draggable, _time, success) => {
                if (disposed)
                    return;
                removeDragMonitor();
                callbacks.onEnd?.(Boolean(success));
            }));
            signalIds.push(draggable.connect('drag-cancelled', () => {
                if (!disposed)
                    callbacks.onCancelled?.();
            }));
            actorDestroySignal = actor.connect('destroy', () => {
                if (disposed)
                    return;
                try {
                    callbacks.onDestroy?.();
                } finally {
                    dispose();
                }
            });
            this.sources.set(actor, {dispose});
            lifecycle?.add(dispose);
        } catch (error) {
            // Signal setup can fail part-way through; release every acquired
            // connection and restore the actor delegate before propagating it.
            dispose();
            throw error;
        }
        return dispose;
    }

    registerTarget(
        actor: DelegateActor,
        delegate: DropTargetDelegate,
        lifecycle?: LifecycleScope,
    ): () => void {
        if (this.destroyed)
            return () => {};

        this.unregisterTarget(actor);
        const removeDelegate = this.delegates.add(actor, delegate);
        let disposed = false;
        let actorDestroySignal = 0;

        const dispose = () => {
            if (disposed)
                return;
            disposed = true;
            if (actorDestroySignal) {
                try {
                    actor.disconnect(actorDestroySignal);
                } catch (error) {
                    logError(error as Error, 'Unable to disconnect g-os drop-target destroy signal');
                }
            }
            removeDelegate();
            this.targets.delete(actor);
        };

        try {
            actorDestroySignal = actor.connect('destroy', dispose);
            this.targets.set(actor, dispose);
            lifecycle?.add(dispose);
        } catch (error) {
            // Restore the previous delegate if target setup fails part-way through.
            dispose();
            throw error;
        }
        return dispose;
    }

    hasSource(actor: DelegateActor): boolean {
        return this.sources.has(actor);
    }

    unregisterSource(actor: DelegateActor): void {
        this.sources.get(actor)?.dispose();
    }

    unregisterTarget(actor: DelegateActor): void {
        this.targets.get(actor)?.();
    }

    destroy(): void {
        if (this.destroyed)
            return;
        this.destroyed = true;
        for (const registration of [...this.sources.values()])
            registration.dispose();
        for (const dispose of [...this.targets.values()])
            dispose();
        this.sources.clear();
        this.targets.clear();
    }

    get sourceCount(): number {
        return this.sources.size;
    }

    get targetCount(): number {
        return this.targets.size;
    }

    get isDestroyed(): boolean {
        return this.destroyed;
    }
}
