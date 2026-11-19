/**
 * Explicitly retain GNOME Shell's native popup-menu style hooks.
 *
 * Colors, borders, shadows, hover/checked states and typography are deliberately
 * left to the active Shell theme so light/dark mode and theme changes stay live.
 */
export function applyNativeMenuTheme(menu, ...styleClasses) {
    if (!menu?.actor || !menu?.box)
        return false;

    menu.actor.add_style_class_name('popup-menu');
    menu.box.add_style_class_name('popup-menu-content');
    for (const styleClass of styleClasses) {
        if (styleClass)
            menu.actor.add_style_class_name(styleClass);
    }
    return true;
}
