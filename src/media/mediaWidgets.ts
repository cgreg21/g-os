import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {CleanupManager} from '../core/cleanupManager.js';

type MediaState = {
    player: any;
    title: string;
    artist: string;
    identity: string;
    cover: string;
    playing: boolean;
    canPlay: boolean;
    canPrevious: boolean;
    canNext: boolean;
    playerCount: number;
};

type MediaWidgetView = St.BoxLayout & {
    cover: St.Icon;
    controls: Record<string, St.Button> & {raise?: St.Button; playPause?: St.Button; cycle?: St.Button};
    dragHandle?: Clutter.Actor;
    title: St.Label;
    artist: St.Label;
    identity: St.Label;
    coverUri?: string;
    ownerButton?: St.Button;
    updateMedia: (state: MediaState) => void;
};

type MediaSource = {connect(signal: string, callback: () => void): number};

export function withMediaWidgets(Base) {
    return class extends Base {
        _stopMediaTracking() {
            this._mediaSourceCleanup?.clear();
            this._mediaSourceCleanup = null;
            for (const cleanup of this._mediaPlayers?.values() ?? [])
                cleanup.clear();
            this._mediaPlayers?.clear();
            this._mediaSource = null;
            this._selectedMediaPlayer = null;
        }

        _syncMediaPlayers() {
            const enabled = this._mediaServiceUsers > 0 ||
                this._widgetRuntime?.instances.some(instance => instance.enabled && instance.widget === 'media') ||
                (!this._settings.get_boolean('widgets-managed') && (this._settings.get_boolean('desktop-widget-media') ||
                    this._settings.get_boolean('dock-widget-media')));
            const source = enabled ? Main.panel.statusArea?.dateMenu?._messageList?._messageView?._mediaSource : null;
            if (source !== this._mediaSource) {
                this._stopMediaTracking();
                this._mediaSource = source;
                if (source) {
                    const cleanup = new CleanupManager();
                    for (const signal of ['player-added', 'player-removed'])
                        cleanup.addSignal(source, (source as MediaSource).connect(signal, () => this._syncMediaPlayers()));
                    this._mediaSourceCleanup = cleanup;
                }
            }
            const players = source?.players ?? [];
            for (const [player, cleanup] of this._mediaPlayers) {
                if (!players.includes(player)) {
                    this._mediaPlayers.delete(player);
                    cleanup.clear();
                }
            }
            for (const player of players) {
                if (!this._mediaPlayers.has(player)) {
                    const cleanup = new CleanupManager();
                    cleanup.addSignal(player, player.connect('changed', () => this._refreshMediaWidgets()));
                    this._mediaPlayers.set(player, cleanup);
                }
            }
            this._refreshMediaWidgets();
        }

        _mediaState() {
            const players = [...this._mediaPlayers.keys()].filter(player => {
                try {
                    return player.canPlay && typeof player.status === 'string';
                } catch {
                    return false;
                }
            });
            const player = players.includes(this._selectedMediaPlayer) ? this._selectedMediaPlayer
                : players.find(candidate => candidate.status === 'Playing') ?? players[0] ?? null;
            return {
                player,
                title: player?.trackTitle || 'Aucune lecture',
                artist: player?.trackArtists?.join(', ') || (player ? 'Artiste inconnu' : 'Aucun lecteur actif'),
                identity: player?.app?.get_name() || player?.source?.title || 'Lecteur média',
                cover: player?.trackCoverUrl || '',
                playing: player?.status === 'Playing',
                canPlay: Boolean(player?.canPlay),
                canPrevious: Boolean(player?.canGoPrevious),
                canNext: Boolean(player?.canGoNext),
                playerCount: players.length,
            };
        }

        _refreshMediaWidgets() {
            const state = this._mediaState();
            for (const view of this._mediaViews ?? [])
                view.updateMedia(state);
        }

        _cycleMediaPlayer() {
            const players = [...this._mediaPlayers.keys()];
            if (players.length < 2)
                return;
            const index = players.indexOf(this._mediaState().player);
            this._selectedMediaPlayer = players[(index + 1) % players.length];
            this._refreshMediaWidgets();
        }

        _mediaAction(action) {
            const state = this._mediaState();
            const allowed = {playPause: state.canPlay, previous: state.canPrevious, next: state.canNext,
                raise: Boolean(state.player)};
            if (allowed[action])
                state.player[action]();
        }

        _createMediaView({compact = false, square = false, iconSize = 48, screen = null, monitor = null} = {}) {
            const verticalDock = compact && screen?.position !== 0;
            const view = new St.BoxLayout({
                style_class: `g-os-media-view${compact ? ' g-os-media-compact' : ''}${square ? ' g-os-media-square' : ''}` +
                    `${verticalDock ? ' g-os-media-vertical' : ''}`,
                orientation: (compact || square) && !verticalDock ? Clutter.Orientation.HORIZONTAL : Clutter.Orientation.VERTICAL,
            }) as MediaWidgetView;
            if (screen && !compact && !square)
                view.set_width(Math.max(160, Math.min(280, this._settings.get_int('desktop-widget-width'))));
            const cover = new St.Icon({icon_name: 'audio-x-generic-symbolic',
                fallback_icon_name: 'audio-x-generic-symbolic',
                icon_size: square ? iconSize : compact ? Math.min(iconSize - 4, 24) : 48});
            view.cover = cover;
            view.controls = {};
            let ownTooltip = null;
            if (!screen && !square) {
                ownTooltip = new St.Label({style_class: 'dash-label g-os-dock-tooltip', visible: false});
                Main.layoutManager.addTopChrome(ownTooltip);
                screen = {position: 0, monitor: monitor ?? Main.layoutManager.monitors[Main.layoutManager.primaryIndex],
                    tooltip: ownTooltip};
            }
            if (square) {
                view.add_child(cover);
            } else {
                const header = new St.BoxLayout({style_class: 'g-os-media-header',
                    orientation: Clutter.Orientation.HORIZONTAL, x_expand: true});
                const coverButton = new St.Button({child: cover, can_focus: true, track_hover: true,
                    accessible_name: 'Ouvrir le lecteur', style_class: 'g-os-media-cover'});
                coverButton.connect('clicked', () => this._mediaAction('raise'));
                this._attachTooltip(screen, coverButton, 'Ouvrir le lecteur', {magnify: false, scroll: false});
                header.add_child(coverButton);
                const info = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL,
                    style_class: 'g-os-media-info', x_expand: true, y_align: Clutter.ActorAlign.CENTER, visible: !verticalDock});
                view.dragHandle = info;
                for (const field of ['title', 'artist', 'identity']) {
                    const label = new St.Label({style_class: `g-os-media-${field}`,
                        visible: !verticalDock && (!compact || field === 'title' || (field === 'artist' && iconSize >= 32)), x_expand: true});
                    label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
                    view[field] = label;
                    info.add_child(label);
                }
                header.add_child(info);
                view.add_child(header);
                const controls = new St.BoxLayout({style_class: 'g-os-media-controls',
                    orientation: verticalDock ? Clutter.Orientation.VERTICAL : Clutter.Orientation.HORIZONTAL,
                    x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER});
                for (const [action, icon, name] of [
                    ['previous', 'media-skip-backward-symbolic', 'Piste précédente'],
                    ['playPause', 'media-playback-start-symbolic', 'Lire'],
                    ['next', 'media-skip-forward-symbolic', 'Piste suivante'],
                    ['cycle', 'view-more-symbolic', 'Lecteur suivant'],
                ]) {
                    const button = new St.Button({style_class: 'g-os-media-control', can_focus: true,
                        accessible_name: name, track_hover: true, width: compact ? 18 : 20,
                        height: compact ? Math.min(iconSize - 4, 24) : 28,
                        child: new St.Icon({icon_name: icon, icon_size: compact ? 12 : 16})});
                    button.connect('clicked', () => action === 'cycle'
                        ? this._cycleMediaPlayer() : this._mediaAction(action));
                    if (screen)
                        this._attachTooltip(screen, button, () => button.accessible_name, {magnify: false, scroll: false});
                    view.controls[action] = button;
                    controls.add_child(button);
                }
                view.add_child(controls);
                view.controls.raise = coverButton;
            }
            view.updateMedia = state => {
                if (!square) {
                    view.title.text = state.title;
                    view.artist.text = state.artist;
                    view.identity.text = state.identity;
                    const controls: [string, boolean][] = [['previous', state.canPrevious], ['playPause', state.canPlay],
                        ['next', state.canNext], ['raise', Boolean(state.player)], ['cycle', state.playerCount > 1]];
                    for (const [action, enabled] of controls) {
                        view.controls[action].reactive = enabled;
                        view.controls[action].can_focus = enabled;
                    }
                    view.controls.cycle.visible = state.playerCount > 1;
                    (view.controls.playPause.get_child() as St.Icon).icon_name = state.playing
                        ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic';
                    view.controls.playPause.accessible_name = state.playing ? 'Mettre en pause' : 'Lire';
                }
                if (view.coverUri !== state.cover) {
                    view.coverUri = state.cover;
                    try {
                        cover.gicon = state.cover ? new Gio.FileIcon({file: Gio.File.new_for_uri(state.cover)}) : null;
                    } catch {
                        cover.gicon = null;
                    }
                }
                if (view.ownerButton)
                    view.ownerButton.accessible_name = `${state.identity} : ${state.title}, ${state.artist}`;
            };
            this._mediaViews.add(view);
            view.connect('destroy', () => {
                this._mediaViews.delete(view);
                ownTooltip?.destroy();
            });
            view.updateMedia(this._mediaState());
            return view;
        }

    };
}
