export function create(context) {
    const {api, config} = context;
    const dock = context.target === 'dock';
    const actor = api.box({vertical: true,
        style: dock ? 'spacing: 2px;' : 'spacing: 8px;',
        style_class: dock ? 'example-status-dock' : 'g-os-desktop-widget example-status-desktop'});
    if (dock && context.square) {
        actor.add_style_class_name('example-status-square');
        actor.add_child(api.icon('starred-symbolic', context.iconSize));
        return {actor};
    }
    const title = api.label(config.caption, {visible: !dock || context.iconSize >= 32});
    title.set_style(`font-size: ${dock ? 10 : config['font-size']}px; color: ${config.color};`);
    const value = api.label('', {visible: config['show-time']});
    value.set_style(`font-size: ${dock ? 8 : 14}px;`);
    actor.add_child(title);
    actor.add_child(value);
    if (!dock)
        actor.add_child(api.button('preferences-system-symbolic', 'Configurer', () => api.openConfiguration()));
    const update = () => {
        value.text = api.now().format(config.mode === 'Date' ? '%d/%m/%Y' : '%H:%M');
    };
    api.watchClock(update);
    update();
    return {actor, dragHandle: title, update};
}