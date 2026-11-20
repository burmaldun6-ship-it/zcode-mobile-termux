package com.zcodemobile.util;

import android.system.ErrnoException;
import android.system.Os;
import android.util.Log;

import java.io.File;

/** Applies unix modes/exec bits to extracted files. */
public final class FileModeUtil {

    private static final String TAG = "FileModeUtil";

    private FileModeUtil() {
    }

    public static void setExec(File file) {
        if (file == null || !file.exists()) {
            return;
        }
        try {
            Os.chmod(file.getAbsolutePath(), 0755);
        } catch (ErrnoException e) {
            Log.w(TAG, "chmod failed " + file + ": " + e);
        }
        file.setReadable(true, false);
        file.setExecutable(true, false);
    }

    public static void recursiveSetExec(File dir) {
        File[] files = dir.listFiles();
        if (files == null) {
            return;
        }
        for (File file : files) {
            if (file.isDirectory()) {
                setExec(file);
                recursiveSetExec(file);
            } else {
                setExec(file);
            }
        }
    }

    public static void applyMode(File file, long mode) {
        try {
            Os.chmod(file.getAbsolutePath(), (int) (mode & 0777L));
        } catch (ErrnoException e) {
            Log.w(TAG, "chmod failed " + file + ": " + e);
        }
        file.setReadable((mode & 0400L) != 0, false);
        file.setWritable((mode & 0200L) != 0, false);
        file.setExecutable((mode & 0100L) != 0 || file.isDirectory(), false);
    }
}
