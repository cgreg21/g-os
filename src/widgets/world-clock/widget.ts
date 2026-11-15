export function create(context) {
    const {api, config} = context;
    const dock = context.target === 'dock';
    const view = api.card(config.city || 'Horloge mondiale', 'globe-symbolic');
    const value = context.square && dock ? api.icon('globe-symbolic', context.iconSize)
        : api.label('', {style_class: 'g-os-utility-value'});
    view.body.add_child(value);
    const date = !dock ? api.label('') : null;
    if (date)
        view.body.add_child(date);
    let timeFormat;
    let dateFormat;
    try {
        timeFormat = new Intl.DateTimeFormat(undefined, {timeZone: config.timezone, hour: '2-digit', minute: '2-digit', hour12: config['twelve-hour']});
        dateFormat = new Intl.DateTimeFormat(undefined, {timeZone: config.timezone, weekday: 'short', day: 'numeric', month: 'short'});
    } catch {
        if (!(context.square && dock))
            value.text = 'Fuseau invalide';
    }
    const update = () => {
        if (!timeFormat)
            return;
        const now = new Date(api.wallTime());
        if (!(context.square && dock))
            value.text = timeFormat.format(now);
        if (date)
            date.text = dateFormat.format(now);
    };
    api.watchClock(update);
    update();
    return {...view, value, update};
}