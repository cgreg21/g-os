export function create(context) {
    const {api, config} = context;
    if (context.target === 'dock')
        return api.createDockBuiltin('clock', context);
    const actor = api.box({style_class: 'g-os-desktop-widget g-os-desktop-widget-clock', vertical: true});
    actor.timeLabel = api.label('', {style_class: 'g-os-desktop-widget-time'});
    actor.dateLabel = api.label('', {style_class: 'g-os-desktop-widget-date', visible: config['show-date']});
    actor.add_child(actor.timeLabel);
    actor.add_child(actor.dateLabel);
    const update = () => {
        const date = api.now();
        actor.timeLabel.text = config.format === 'Systeme' ? api.clockTimeText()
            : date.format(config.format === '12 h' ? '%I:%M %p' : '%H:%M');
        actor.dateLabel.text = date.format('%A, %d %B');
    };
    api.watchClock(update);
    update();
    return {actor, update, dragHandle: actor};
}