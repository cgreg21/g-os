import Clutter from 'gi://Clutter';

/**
 * Register a source using the shared GNOME Shell drag visual.
 *
 * The source actor is cloned into a styled St container before feature callbacks
 * replace or hide the original actor. Features only supply their drag delegate
 * and behavior; clone sizing, shadow and cleanup stay identical everywhere.
 */
export function registerShadowDragSource({
    controller,
    actor,
    St,
    delegate = {},
    callbacks = {},
    options = {},
    lifecycle = null,
}) {
    let dragActor = null;
    const createDragActor = () => {
        const [width, height] = actor.get_size();
        const container = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            style_class: 'g-os-dnd-drag-actor',
            width,
            height,
            reactive: false,
        });
        container.add_child(new Clutter.Clone({source: actor, reactive: false}));
        return container;
    };
    const finish = callback => {
        try {
            callback?.();
        } finally {
            dragActor = null;
        }
    };

    return controller.registerSource(actor, {
        ...delegate,
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
