package com.zcodemobile;

/** App constants read from config/app.env at build time (values inlined here). */
public final class ZCodeConfig {

    public static final String PKG = "com.zcodemobile";
    public static final String APP_NAME = "ZCode Mobile";
    public static final String APP_VERSION_NAME = "3.18.2";
    public static final int APP_VERSION_CODE = 1;
    public static final String CORE_VERSION = "3.18.2";

    public static final int PORT = 45210;
    public static final String HOST = "127.0.0.1";
    public static final String BACKEND_BASE_URL = "http://" + HOST + ":" + PORT + "/";
    public static final String HEALTH_URL = BACKEND_BASE_URL + "health";
    public static final String RPC_URL = BACKEND_BASE_URL + "rpc";

    public static final String OAUTH_SCHEME = "zcode";
    public static final String OAUTH_CALLBACK = OAUTH_SCHEME + "://oauth/callback";

    public static final int MIN_API = 24;
    public static final int TARGET_SDK = 28;

    private ZCodeConfig() {
    }
}
