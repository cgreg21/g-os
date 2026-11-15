export function create(context) {
    const {api, config} = context;
    if (context.target === 'dock')
        return api.createDockBuiltin('calendar', context);
    const actor = api.box({style_class: 'g-os-desktop-widget g-os-desktop-widget-calendar', vertical: true});
    actor.monthLabel = api.label('', {style_class: 'g-os-desktop-widget-month'});
    actor.dayLabel = api.label('', {style_class: 'g-os-desktop-widget-day'});
    actor.weekdayLabel = api.label('', {style_class: 'g-os-desktop-widget-weekday', visible: config['show-weekday']});
    for (const label of [actor.monthLabel, actor.dayLabel, actor.weekdayLabel])
        actor.add_child(label);
    const update = () => {
        const date = api.now();
        actor.monthLabel.text = date.format('%B %Y');
        actor.dayLabel.text = date.format('%d');
        actor.weekdayLabel.text = date.format('%A');
    };
    api.watchClock(update);
    update();
    return {actor, update, dragHandle: actor};
}