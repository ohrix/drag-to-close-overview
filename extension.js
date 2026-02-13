import Clutter from "gi://Clutter";
import GLib from "gi://GLib";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as DND from "resource:///org/gnome/shell/ui/dnd.js";
import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";

const BOTTOM_EDGE_TRIGGER_PX = 96;
const LOG_PREFIX = "[drag-close]";
const DRAG_CONTINUE =
    DND.DragMotionResult?.CONTINUE ??
    DND.DragDropResult?.CONTINUE ??
    0;

export default class DragToCloseInOverviewExtension extends Extension {
    enable() {
        this._touchState = new Map();
        this._activeGesture = null;
        this._closeTimeoutId = 0;
        this._debugEnabled = false;

        this._capturedEventId = global.stage.connect(
            "captured-event",
            this._onCapturedEvent.bind(this)
        );

        this._dragMonitor = {
            dragMotion: this._onDragMotion.bind(this),
            dragDrop: this._onDragDrop.bind(this),
        };
        DND.addDragMonitor(this._dragMonitor);

        this._log("enabled", {
            stageHeight: global.stage.height,
            capturedEventId: this._capturedEventId,
            hasDragMonitor: true,
        });
    }

    disable() {
        this._log("disable called", {
            capturedEventId: this._capturedEventId ?? 0,
            trackedTouches: this._touchState?.size ?? 0,
            hadActiveGesture: !!this._activeGesture,
        });

        if (this._capturedEventId) {
            global.stage.disconnect(this._capturedEventId);
            this._capturedEventId = 0;
        }

        if (this._dragMonitor) {
            DND.removeDragMonitor(this._dragMonitor);
            this._dragMonitor = null;
        }

        this._touchState?.clear();
        this._touchState = null;
        this._activeGesture = null;
        if (this._closeTimeoutId) {
            GLib.source_remove(this._closeTimeoutId);
            this._closeTimeoutId = 0;
        }
        this._debugEnabled = false;
    }

    _onCapturedEvent(_actor, event) {
        const type = event.type();
        const overviewVisible = Main.overview.visible || Main.overview.visibleTarget;

        if (!overviewVisible || type === Clutter.EventType.NOTHING)
            return Clutter.EVENT_PROPAGATE;

        if (type === Clutter.EventType.TOUCH_BEGIN ||
            type === Clutter.EventType.TOUCH_UPDATE ||
            type === Clutter.EventType.TOUCH_END ||
            type === Clutter.EventType.TOUCH_CANCEL) {
            this._log("touch event received", {type});
        }

        switch (type) {
        case Clutter.EventType.TOUCH_BEGIN:
            return this._onTouchBegin(event);
        case Clutter.EventType.TOUCH_UPDATE:
            return this._onTouchUpdate(event);
        case Clutter.EventType.TOUCH_END:
        case Clutter.EventType.TOUCH_CANCEL:
            return this._onTouchEnd(event);
        default:
            return Clutter.EVENT_PROPAGATE;
        }
    }

    _onTouchBegin(event) {
        const touchKey = this._getTouchKey(event);
        if (touchKey === null) {
            this._log("touch begin ignored", {reason: "missing-sequence"});
            return Clutter.EVENT_PROPAGATE;
        }

        const source = event.get_source();
        const metaWindow = this._findMetaWindow(source, event);
        if (!metaWindow) {
            this._log("touch begin ignored", {
                reason: "no-meta-window",
                sourceType: source?.constructor?.name ?? "unknown",
            });
            return Clutter.EVENT_PROPAGATE;
        }

        const [x, y] = event.get_coords();
        this._touchState.set(touchKey, {
            metaWindow,
            maxY: y,
        });

        this._activeGesture = {
            touchKey,
            metaWindow,
            startWorkspace: metaWindow.get_workspace?.() ?? null,
            dragStarted: false,
            lastY: y,
            maxY: y,
            armedAtMs: Date.now(),
        };

        this._log("touch begin tracked", {
            touchKey,
            x,
            y,
            trackedTouches: this._touchState.size,
            title: metaWindow.get_title?.() ?? "unknown",
        });

        return Clutter.EVENT_PROPAGATE;
    }

    _onTouchUpdate(event) {
        const touchKey = this._getTouchKey(event);
        const state = touchKey !== null ? this._touchState.get(touchKey) : null;
        if (!state)
            return Clutter.EVENT_PROPAGATE;

        const [, y] = event.get_coords();
        if (y > state.maxY)
            state.maxY = y;

        if (this._activeGesture && this._activeGesture.touchKey === touchKey) {
            this._activeGesture.lastY = y;
            if (y > this._activeGesture.maxY)
                this._activeGesture.maxY = y;
        }

        return Clutter.EVENT_PROPAGATE;
    }

    _onTouchEnd(event) {
        const touchKey = this._getTouchKey(event);
        if (touchKey !== null)
            this._touchState.delete(touchKey);

        if (this._activeGesture && this._activeGesture.touchKey === touchKey && !this._activeGesture.dragStarted) {
            this._log("touch end without drag", {touchKey});
            this._activeGesture = null;
        }

        return Clutter.EVENT_PROPAGATE;
    }

    _onDragMotion(dragEvent) {
        if (!this._activeGesture)
            return DRAG_CONTINUE;

        const nowMs = Date.now();
        if (nowMs - this._activeGesture.armedAtMs > 3000) {
            this._log("gesture timeout", {touchKey: this._activeGesture.touchKey});
            this._activeGesture = null;
            return DRAG_CONTINUE;
        }

        const eventMetaWindow = this._extractMetaWindow(dragEvent?.source);
        if (eventMetaWindow && eventMetaWindow !== this._activeGesture.metaWindow)
            return DRAG_CONTINUE;

        this._activeGesture.dragStarted = true;

        const y = typeof dragEvent?.y === "number" ? dragEvent.y : null;
        if (typeof y === "number") {
            this._activeGesture.lastY = y;
            if (y > this._activeGesture.maxY)
                this._activeGesture.maxY = y;
        }

        return DRAG_CONTINUE;
    }

    _onDragDrop(dragEvent) {
        if (!this._activeGesture)
            return DRAG_CONTINUE;

        const gesture = this._activeGesture;

        const eventMetaWindow = this._extractMetaWindow(dragEvent?.source);
        if (eventMetaWindow && eventMetaWindow !== gesture.metaWindow)
            return DRAG_CONTINUE;

        const pointer = global.get_pointer?.() ?? [null, null, null];
        const pointerY = typeof pointer[1] === "number" ? pointer[1] : null;
        const eventY = typeof dragEvent?.y === "number" ? dragEvent.y : null;
        const lastY = typeof gesture.lastY === "number" ? gesture.lastY : null;
        const maxY = typeof gesture.maxY === "number" ? gesture.maxY : null;
        const releaseY = Number.isFinite(eventY) ? eventY : lastY;
        const reachedBottomEdge =
            Number.isFinite(releaseY) &&
            releaseY >= global.stage.height - BOTTOM_EDGE_TRIGGER_PX;

        const currentWorkspace = gesture.metaWindow.get_workspace?.() ?? null;
        const workspaceChanged =
            gesture.startWorkspace !== null &&
            currentWorkspace !== null &&
            gesture.startWorkspace !== currentWorkspace;

        this._log("native drag drop evaluated", {
            touchKey: gesture.touchKey,
            pointerY,
            eventY,
            lastY,
            maxY,
            releaseY,
            dragStarted: gesture.dragStarted,
            stageHeight: global.stage.height,
            bottomEdgePx: BOTTOM_EDGE_TRIGGER_PX,
            reachedBottomEdge,
            workspaceChanged,
        });

        this._activeGesture = null;

        if (!gesture.dragStarted)
            return DRAG_CONTINUE;

        if (!reachedBottomEdge)
            return DRAG_CONTINUE;

        if (workspaceChanged)
            return DRAG_CONTINUE;

        if (typeof gesture.metaWindow.can_close === "function" && !gesture.metaWindow.can_close()) {
            this._log("close rejected", {reason: "window-cannot-close"});
            return DRAG_CONTINUE;
        }

        this._log("closing window", {
            touchKey: gesture.touchKey,
            title: gesture.metaWindow.get_title?.() ?? "unknown",
        });
        this._deferCloseWindow(gesture.metaWindow, gesture.touchKey);

        return DRAG_CONTINUE;
    }

    _deferCloseWindow(metaWindow, touchKey) {
        if (this._closeTimeoutId) {
            GLib.source_remove(this._closeTimeoutId);
            this._closeTimeoutId = 0;
        }

        this._closeTimeoutId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            80,
            () => {
                this._closeTimeoutId = 0;
                try {
                    metaWindow.delete(this._getDeleteTimestamp());
                    this._log("window close dispatched", {touchKey});
                } catch (e) {
                    this._log("window close failed", {
                        touchKey,
                        error: `${e}`,
                    });
                }
                return GLib.SOURCE_REMOVE;
            }
        );
    }

    _getDeleteTimestamp() {
        if (typeof global.get_current_time_roundtrip === "function")
            return global.get_current_time_roundtrip();

        if (typeof global.get_current_time === "function")
            return global.get_current_time();

        if (typeof Clutter.get_current_event_time === "function")
            return Clutter.get_current_event_time();

        return 0;
    }

    _getTouchKey(event) {
        const sequence = event.get_event_sequence();
        if (!sequence)
            return null;

        if (typeof sequence.get_slot === "function")
            return sequence.get_slot();

        return sequence;
    }

    _extractMetaWindow(candidate) {
        if (!candidate)
            return null;

        if (typeof candidate.get_meta_window === "function")
            return candidate.get_meta_window();

        return (
            candidate.metaWindow ??
            candidate.meta_window ??
            candidate._metaWindow ??
            candidate.window?.metaWindow ??
            candidate._windowActor?.metaWindow ??
            candidate.windowActor?.metaWindow ??
            null
        );
    }

    _findMetaWindow(actor, event = null) {
        let current = actor;
        let depth = 0;
        while (current) {
            const currentMetaWindow = this._extractMetaWindow(current);
            if (currentMetaWindow) {
                this._log("metaWindow found", {
                    depth,
                    via: "actor",
                    title: currentMetaWindow.get_title?.() ?? "unknown",
                });
                return currentMetaWindow;
            }

            const delegate = current._delegate;
            const delegateMetaWindow = this._extractMetaWindow(delegate);
            if (delegateMetaWindow) {
                this._log("metaWindow found", {
                    depth,
                    via: "delegate",
                    title: delegateMetaWindow.get_title?.() ?? "unknown",
                });
                return delegateMetaWindow;
            }
            current = current.get_parent?.() ?? null;
            depth++;
        }

        if (event) {
            const [x, y] = event.get_coords();
            const pickMode =
                Clutter.PickMode.ALL !== undefined
                    ? Clutter.PickMode.ALL
                    : Clutter.PickMode.REACTIVE;
            const picked = global.stage.get_actor_at_pos(pickMode, x, y);
            if (picked && picked !== actor)
                return this._findMetaWindow(picked, null);
        }

        this._log("metaWindow not found");
        return null;
    }

    _log(message, data = null) {
        if (!this._debugEnabled)
            return;

        if (data)
            log(`${LOG_PREFIX} ${message} ${JSON.stringify(data)}`);
        else
            log(`${LOG_PREFIX} ${message}`);
    }
}
