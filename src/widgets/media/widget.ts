export function create(context) {
    const {api} = context;
    if (context.target === 'dock')
        return api.createDockBuiltin('media', context);
    const actor = api.box({style_class: 'g-os-desktop-widget g-os-desktop-widget-media', vertical: true});
    const view = api.createMediaView({monitor: context.monitor});
    actor.mediaView = view;
    actor.add_child(view);
    return {actor, dragHandle: view.dragHandle};
}