package com.zcodemobile.core;

import android.content.Context;
import android.util.Log;

import com.zcodemobile.ZCodeConfig;
import com.zcodemobile.runtime.RuntimeManager;
import com.zcodemobile.util.ProcessUtils;

import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.File;
import java.io.FileWriter;
import java.io.InputStreamReader;
import java.io.Writer;

/** Launches, waits for ready, streams logs, and restarts the backend on crash. */
public final class CoreProcessSupervisor {

    private static final String TAG = "CoreProcessSupervisor";

    private static final long SUSTAINED_READY_MS = 60000;
    private static final int MAX_RESTARTS = 3;
    private static final long RESTART_BASE_MS = 1000;
    private static final long RESTART_MAX_MS = 30000;

    private final Context appContext;
    private final RuntimeManager runtime;
    private final Runnable terminalListener;

    private volatile Process process;
    private volatile boolean stopping;
    private Thread worker;

    public CoreProcessSupervisor(Context context, RuntimeManager runtime, Runnable terminalListener) {
        this.appContext = context.getApplicationContext();
        this.runtime = runtime;
        this.terminalListener = terminalListener;
    }

    public void start() {
        stopping = false;
        worker = new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    loop();
                } finally {
                    if (!stopping && terminalListener != null) {
                        try {
                            terminalListener.run();
                        } catch (Exception e) {
                            Log.w(TAG, "terminal callback failed", e);
                        }
                    }
                }
            }
        }, "ZCodeBackendThread");
        worker.start();
    }

    public void stop() {
        stopping = true;
        destroy(process);
        if (worker != null) {
            worker.interrupt();
        }
    }

    private void loop() {
        int attempt = 0;
        while (!stopping) {
            Writer log = openLog();
            try {
                CoreRuntimeState.lastError = null;
                CoreRuntimeState.restarting = false;
                Process proc = CoreLauncher.launch(runtime, appContext.getFilesDir());
                process = proc;

                final Writer streamLog = log;
                Thread streamer = new Thread(new Runnable() {
                    @Override
                    public void run() {
                        stream(proc, streamLog);
                    }
                }, "ZCodeLogStream");
                streamer.setDaemon(true);
                streamer.start();

                if (!waitForReady(proc, log)) {
                    if (stopping) {
                        break;
                    }
                    if (CoreRuntimeState.lastError == null) {
                        CoreRuntimeState.lastError = "backend did not become ready within "
                                + (BackendHealthProbe.READY_TIMEOUT_MS / 1000) + "s";
                        writeLine(log, CoreRuntimeState.lastError);
                    }
                    destroy(proc);
                    break;
                }

                long readyAt = System.currentTimeMillis();
                try {
                    proc.waitFor();
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                }
                if (stopping) {
                    break;
                }
                int code = ProcessUtils.exitCode(proc);
                if (System.currentTimeMillis() - readyAt >= SUSTAINED_READY_MS) {
                    attempt = 0;
                }
                CoreRuntimeState.backendUrl = null;
                attempt++;

                if (attempt > MAX_RESTARTS) {
                    CoreRuntimeState.restarting = false;
                    CoreRuntimeState.lastError = "backend crashed " + MAX_RESTARTS
                            + " times; giving up (last exit code " + code + ")";
                    writeLine(log, CoreRuntimeState.lastError);
                    break;
                }
                long delay = delayFor(attempt);
                CoreRuntimeState.restarting = true;
                CoreRuntimeState.lastError = "backend exited unexpectedly (code " + code
                        + "); restarting in " + (delay / 1000) + "s ("
                        + attempt + "/" + MAX_RESTARTS + ")";
                Log.w(TAG, CoreRuntimeState.lastError);
                writeLine(log, CoreRuntimeState.lastError);
                closeQuietly(log);
                log = null;
                sleepInterruptible(delay);
            } catch (Exception e) {
                if (stopping) {
                    break;
                }
                Log.e(TAG, "backend start failed", e);
                CoreRuntimeState.lastError = e.getMessage() == null
                        ? e.getClass().getSimpleName() : e.getMessage();
                writeLine(log, "backend start failed: " + CoreRuntimeState.lastError);
                break;
            } finally {
                closeQuietly(log);
            }
        }
    }

    private boolean waitForReady(Process proc, Writer log) {
        long start = System.currentTimeMillis();
        while (System.currentTimeMillis() - start < BackendHealthProbe.READY_TIMEOUT_MS) {
            if (stopping) {
                return false;
            }
            if (!ProcessUtils.isAlive(proc)) {
                CoreRuntimeState.lastError = "backend process exited before it became ready (code "
                        + ProcessUtils.exitCode(proc) + ")";
                writeLine(log, CoreRuntimeState.lastError);
                return false;
            }
            if (BackendHealthProbe.probeOnce()) {
                CoreRuntimeState.backendUrl = ZCodeConfig.BACKEND_BASE_URL;
                CoreRuntimeState.lastError = null;
                CoreRuntimeState.restarting = false;
                CoreRuntimeState.readyGeneration++;
                String ready = "backend ready on " + ZCodeConfig.HOST + ":" + ZCodeConfig.PORT;
                Log.i(TAG, ready);
                writeLine(log, ready);
                return true;
            }
            sleepInterruptible(60);
        }
        return false;
    }

    private void stream(Process proc, Writer log) {
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(proc.getInputStream()))) {
            String line;
            while ((line = reader.readLine()) != null) {
                String safe = line.length() > 4000 ? line.substring(0, 4000) : line;
                Log.d("ZCodeBackend", safe);
                writeLine(log, safe);
            }
        } catch (Exception e) {
            Log.w(TAG, "log stream ended", e);
        }
    }

    private static long delayFor(int attempt) {
        int shift = Math.min(attempt - 1, 5);
        return Math.min(RESTART_BASE_MS << shift, RESTART_MAX_MS);
    }

    private void sleepInterruptible(long ms) {
        long end = System.currentTimeMillis() + ms;
        while (!stopping) {
            long left = end - System.currentTimeMillis();
            if (left <= 0) {
                return;
            }
            ProcessUtils.sleep(Math.min(left, 250));
        }
    }

    private Writer openLog() {
        try {
            File dir = new File(appContext.getFilesDir(), "logs");
            if (!dir.isDirectory() && !dir.mkdirs()) {
                return null;
            }
            return new BufferedWriter(new FileWriter(new File(dir, "backend.log"), true));
        } catch (Exception e) {
            Log.w(TAG, "cannot open backend log: " + e.getMessage());
            return null;
        }
    }

    private static void writeLine(Writer writer, String line) {
        if (writer == null) {
            return;
        }
        try {
            writer.write(line);
            writer.write('\n');
            writer.flush();
        } catch (Exception ignored) {
        }
    }

    private static void closeQuietly(Writer writer) {
        if (writer != null) {
            try {
                writer.close();
            } catch (Exception ignored) {
            }
        }
    }

    private static void destroy(Process proc) {
        if (proc != null) {
            try {
                proc.destroy();
            } catch (Exception ignored) {
            }
            try {
                proc.destroyForcibly();
            } catch (Exception ignored) {
            }
        }
        CoreLauncher.killOrphanBackendProcesses();
    }
}
