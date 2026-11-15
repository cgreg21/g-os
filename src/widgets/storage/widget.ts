export function create(context) {
    const {api, config} = context;
    const dock = context.target === 'dock';
    const view = api.card('Stockage', 'drive-harddisk-symbolic');
    const ring = !dock ? api.progressRing(84) : null;
    const details = ring ? api.box({vertical: true, style_class: 'storage-widget-details'}) : null;
    const value = context.square && dock ? api.icon('drive-harddisk-symbolic', context.iconSize)
        : api.label('Disque ...', {style_class: 'g-os-utility-value'});
    if (ring) {
        const summary = api.box({style_class: 'storage-widget-summary'});
        summary.add_child(ring.actor);
        details.add_child(value);
        summary.add_child(details);
        view.body.add_child(summary);
    } else {
        view.body.add_child(value);
    }
    const detail = !dock ? api.label('') : null;
    let path;
    if (detail) {
        path = api.label('', {style_class: 'storage-widget-path'});
        if (ring) {
            details.add_child(detail);
            details.add_child(path);
        } else {
            view.body.add_child(detail);
            view.body.add_child(path);
        }
    }
    let closed = false;
    let pending = false;
    let lastPercent: number | null = null;
    let lastFreeText: string | null = null;
    let lastPathText: string | null = null;
    const update = () => {
        if (pending || closed)
            return;
        pending = true;
        api.diskStats(config.path).then(stats => {
            if (closed)
                return;
            const used = Math.max(0, stats.total - stats.free);
            const percent = stats.total > 0 ? Math.min(100, Math.round(used / stats.total * 100)) : 0;
            if (percent !== lastPercent) {
                ring?.setValue(percent);
                api.setDynamicLevel(percent / 100);
                lastPercent = percent;
            }
            if (!(context.square && dock) && value.text !== `${percent} % utilise`)
                value.text = `${percent} % utilise`;
            if (detail) {
                const freeText = `${api.formatBytes(stats.free)} libres`;
                if (freeText !== lastFreeText)
                    detail.text = freeText;
                lastFreeText = freeText;
            }
            if (path) {
                const pathText = `${config.path}  |  ${api.formatBytes(stats.total)} total`;
                if (pathText !== lastPathText)
                    path.text = pathText;
                lastPathText = pathText;
            }
        }).catch(() => {
            if (!closed) {
                lastPercent = null;
                lastFreeText = null;
                lastPathText = null;
                if (!(context.square && dock) && value.text !== 'Disque indisponible')
                    value.text = 'Disque indisponible';
            }
        }).finally(() => { pending = false; });
    };
    if (!dock)
        view.body.add_child(api.button('view-refresh-symbolic', 'Actualiser le stockage', update));
    api.onCleanup(() => { closed = true; });
    api.every(config.interval * 1000, update);
    update();
    return {...view, value, ring, details, detail, path, update};
}