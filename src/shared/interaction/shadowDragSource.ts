import type Clutter from 'gi://Clutter';
import type {LifecycleScope} from '../../core/lifecycleScope.js';
import type {DragAndDropController, DragSourceCallbacks, DragSourceOptions} from './dragAndDrop.js';

type ShadowDragSourceOptions = {
    controller: DragAndDropController;
    actor: Clutter.Actor & {_delegate?: Record<string, unknown> | null};
    visualActor?: Clutter.Actor;
    St: any;
    Clutter: any;
    delegate?: Record<string, unknown>;
    callbacks?: DragSourceCallbacks;
    options?: DragSourceOptions;
    lifecycle?: LifecycleScope | null;
};

/**
 * Register a source using the shared GNOME Shell drag visual.
 *
 * The visual actor is cloned into a styled St container before feature callbacks
 * replace or hide the original actor. Features only supply their drag delegate
 * and behavior; clone sizing, shadow and cleanup stay identical everywhere.
 */
export function registerShadowDragSource({
    controller,
    actor,
    visualActor = actor,
    St,
    Clutter,
    delegate = {},
    callbacks = {},
    options = {},
    lifecycle = null,
}: ShadowDragSourceOptions) {
    let dragActor = null;
    const createDragActor = () => {
        const [width, height] = visualActor.get_size();
        const container = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            style_class: 'g-os-dnd-drag-actor',
            width,
            height,
            reactive: false,
        });
        container.add_child(new Clutter.Clone({source: visualActor, reactive: false}));
        return container;
    };
    const getDragActorSource = typeof delegate.getDragActorSource === 'function'
        ? delegate.getDragActorSource
        : typeof actor._delegate?.getDragActorSource === 'function'
            ? actor._delegate.getDragActorSource
            : () => visualActor;
    const finish = callback => {
        try {
            callback?.();
        } finally {
            dragActor = null;
        }
    };

    return controller.registerSource(actor, {
        ...delegate,
        getDragActorSource,
        getDragActor: () => dragActor ?? createDragActor(),
    }, {
        ...callbacks,
        onBegin: () => {
            // GNOME Shell asks for getDragActor after drag-begin. Capture the
            // clone before feature behavior replaces the source actor.
            dragActor = createDragActor();
            callbacks.onBegin?.();
        },
        onEnd: success => finish(() => callbacks.onEnd?.(success)),
        onCancelled: () => finish(() => callbacks.onCancelled?.()),
        onDestroy: () => finish(() => callbacks.onDestroy?.()),
    }, options, lifecycle ?? undefined);
}
