package com.zcodemobile.util;

/** Process helpers: interrupts, liveness and exit codes. */
public final class ProcessUtils {

    private ProcessUtils() {
    }

    public static void sleep(long ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    public static boolean isAlive(Process proc) {
        try {
            proc.exitValue();
            return false;
        } catch (IllegalThreadStateException stillRunning) {
            return true;
        }
    }

    public static int exitCode(Process proc) {
        try {
            return proc.exitValue();
        } catch (IllegalThreadStateException stillRunning) {
            return -1;
        }
    }
}
