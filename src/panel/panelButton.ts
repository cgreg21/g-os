/**
 * Shared construction and sizing for every interactive topbar item.
 * The module is dependency-injected so its geometry can be tested without GNOME.
 */

export function calculatePanelButtonMetrics({
    panelHeight,
    panelVerticalPadding = 0,
    buttonPadding = 0,
    spacing = 0,
}) {
    const values = [panelHeight, panelVerticalPadding, buttonPadding, spacing];
    if (values.some(value => !Number.isFinite(value) || value < 0) || panelHeight <= 0)
        throw new RangeError('Panel button dimensions must be finite non-negative values');

    const effectivePadding = Math.min(buttonPadding,
        Math.max(0, Math.floor((panelHeight - 2 * panelVerticalPadding - 1) / 2)));
    const contentHeight = Math.max(1, panelHeight - 2 * panelVerticalPadding - 2 * effectivePadding);
    return {
        contentHeight,
        iconSize: Math.max(1, Math.floor(contentHeight * 0.72)),
        fontSize: Math.max(1, Math.floor(contentHeight * 0.64)),
        padding: effectivePadding,
        spacing,
    };
}

/**
 * Create the common St.Button shell and its optional icon/text content.
 * Callers keep ownership of actions and menus; presentation stays shared.
 */
export function createPanelButton(St, Clutter, {
    iconName = null,
    icon = null,
    text = null,
    accessibleName = '',
    styleClass = '',
    visible = true,
    canFocus = true,
    reactive = true,
    child = null,
} = {}) {
    const content = child ?? new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        y_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
        style_class: 'g-os-panel-button-content',
    });
    let iconActor = icon;
    let labelActor = null;

    if (!child) {
        if (!iconActor && iconName)
            iconActor = new St.Icon({icon_name: iconName, style_class: 'system-status-icon'});
        if (iconActor)
            content.add_child(iconActor);
        if (text !== null && text !== undefined) {
            labelActor = typeof text === 'string'
                ? new St.Label({text, y_align: Clutter.ActorAlign.CENTER})
                : text;
            labelActor.y_align = Clutter.ActorAlign.CENTER;
            content.add_child(labelActor);
        }
    }

    const button = new St.Button({
        style_class: ['panel-button', 'g-os-panel-button', styleClass].filter(Boolean).join(' '),
        accessible_name: accessibleName,
        can_focus: canFocus,
        reactive,
        visible,
        child: content,
    });
    button.panelContent = content;
    button.panelIcon = iconActor;
    button.panelLabel = labelActor;
    return button;
}

export function applyPanelButtonMetrics(button, metrics) {
    button.set_style(`padding: ${metrics.padding}px; margin: 0; min-height: 0;`);
    button.panelContent?.set_style?.(`spacing: ${metrics.spacing}px;`);
    button.panelIcon?.set_style?.(`icon-size: ${metrics.iconSize}px;`);
    button.panelLabel?.set_style?.(`font-size: ${metrics.fontSize}px;`);
}

/**
 * The menu variant deliberately remains an St.Button. Popup behavior is
 * composed onto the same shared button instead of using PanelMenu.Button.
 */
export function createPanelMenuButton(St, Clutter, PopupMenu, options = {}) {
    const button = createPanelButton(St, Clutter, options);
    const panelButton = button as any;
    panelButton.container = button;
    panelButton.menu = new PopupMenu.PopupMenu(button, 0.5, St.Side.TOP);
    button.connect('clicked', () => panelButton.menu.toggle());
    button.connect('popup-menu', () => panelButton.menu.open());
    button.connect('destroy', () => {
        panelButton.menu.close({animate: false});
        panelButton.menu.destroy();
    });
    return panelButton;
}
