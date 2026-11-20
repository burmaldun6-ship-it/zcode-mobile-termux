package com.zcodemobile.core;

/** Cross-component state shared by the service, bridge and UI. */
public final class CoreRuntimeState {

    public static final int PORT = com.zcodemobile.ZCodeConfig.PORT;

    /** Published once the backend HTTP bridge answers on its loopback port. */
    public static volatile String backendUrl = null;
    /** Fail-closed startup error surfaced to the UI instead of a hung splash. */
    public static volatile String lastError = null;
    /** True while an unexpected exit is being auto-restarted. */
    public static volatile boolean restarting = false;
    /** Bumped on every successful ready; the UI reloads when it changes. */
    public static volatile int readyGeneration = 0;

    private CoreRuntimeState() {
    }
}
