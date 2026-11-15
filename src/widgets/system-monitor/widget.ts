export function create(context) {
    const {api, config} = context;
    const dock = context.target === 'dock';
    const view = api.card('Systeme', 'utilities-system-monitor-symbolic');
    const value = context.square && dock ? api.icon('utilities-system-monitor-symbolic', context.iconSize)
        : api.label('CPU ...', {style_class: 'g-os-utility-value'});
    view.body.add_child(value);
    const trend = !dock ? api.sparkline() : null;
    if (trend)
        view.body.add_child(trend.actor);
    const memory = !dock ? api.label('RAM ...') : null;
    const activity = !dock ? api.label('') : null;
    for (const label of [memory, activity].filter(Boolean))
        view.body.add_child(label);
    let closed = false;
    let pending = false;
    let previous;
    const history = [];
    const update = () => {
        if (pending || closed)
            return;
        pending = true;
        api.systemStats().then(stats => {
            if (closed)
                return;
            const total = previous ? stats.cpuTotal - previous.cpuTotal : 0;
            const idle = previous ? stats.cpuIdle - previous.cpuIdle : 0;
            const cpu = total > 0 ? Math.max(0, Math.min(100, Math.round((1 - idle / total) * 100))) : 0;
            previous = stats;
            history.push(cpu);
            if (history.length > 32)
                history.shift();
            if (!(context.square && dock))
                value.text = `CPU ${cpu} %`;
            trend?.setValues(history);
            api.setDynamicLevel(cpu / 100);
            if (memory) {
                memory.text = `RAM ${api.formatBytes(stats.memoryUsed)} / ${api.formatBytes(stats.memoryTotal)}`;
                activity.text = `Charge ${stats.load.toFixed(2)}  |  Actif ${api.formatDuration(stats.uptime * 1000)}`;
            }
        }).catch(() => {
            if (!closed && !(context.square && dock))
                value.text = 'Systeme indisponible';
        }).finally(() => { pending = false; });
    };
    api.onCleanup(() => { closed = true; });
    api.every(config.interval * 1000, update);
    update();
    return {...view, value, trend, history, memory, activity, update};
}