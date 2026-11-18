import Clutter from 'gi://Clutter';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';
import { LifecycleScope } from '../../core/lifecycleScope.js';

type DelegateActor = Clutter.Actor & {
    _delegate?: Record<string, unknown> | null;
};

export interface DragSourceCallbacks {
    onBegin?: () => void;
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

        const previousDelegate = actor._delegate;
        const composedDelegate = Object.assign(
            Object.create(previousDelegate ?? null),
            delegate,
        );
        actor._delegate = composedDelegate;

        const draggable = DND.makeDraggable(actor, {
            dragActorOpacity: options.dragActorOpacity,
        });
        let disposed = false;
        const signalIds = [
            draggable.connect('drag-begin', () => callbacks.onBegin?.()),
            draggable.connect('drag-end', (_draggable, _time, success) =>
                callbacks.onEnd?.(Boolean(success))),
            draggable.connect('drag-cancelled', () => callbacks.onCancelled?.()),
        ];
        let actorDestroySignal = 0;

        const dispose = () => {
            if (disposed)
                return;
            disposed = true;
            for (const signalId of signalIds)
                draggable.disconnect(signalId);
            if (actorDestroySignal)
                actor.disconnect(actorDestroySignal);
            if (actor._delegate === composedDelegate) {
                if (previousDelegate)
                    actor._delegate = previousDelegate;
                else
                    delete actor._delegate;
            }
            this.sources.delete(actor);
        };

        actorDestroySignal = actor.connect('destroy', () => {
            callbacks.onDestroy?.();
            dispose();
        });
        this.sources.set(actor, {dispose});
        lifecycle?.add(dispose);
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
        const previousDelegate = actor._delegate;
        const composedDelegate = Object.assign(
            Object.create(previousDelegate ?? null),
            delegate,
        );
        actor._delegate = composedDelegate;
        let disposed = false;
        let actorDestroySignal = 0;

        const dispose = () => {
            if (disposed)
                return;
            disposed = true;
            if (actorDestroySignal)
                actor.disconnect(actorDestroySignal);
            if (actor._delegate === composedDelegate) {
                if (previousDelegate)
                    actor._delegate = previousDelegate;
                else
                    delete actor._delegate;
            }
            this.targets.delete(actor);
        };

        actorDestroySignal = actor.connect('destroy', dispose);
        this.targets.set(actor, dispose);
        lifecycle?.add(dispose);
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
