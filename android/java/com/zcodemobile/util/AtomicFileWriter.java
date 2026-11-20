package com.zcodemobile.util;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.Charset;

/** Writes files atomically (sibling temp file + rename). */
public final class AtomicFileWriter {

    private AtomicFileWriter() {
    }

    public static void writeText(File target, String content) {
        File dir = target.getParentFile();
        if (dir != null && !dir.exists() && !dir.mkdirs()) {
            return;
        }
        File tmp = new File(dir, target.getName() + ".tmp");
        try (FileOutputStream out = new FileOutputStream(tmp)) {
            out.write(content.getBytes(Charset.forName("UTF-8")));
            out.flush();
            out.getFD().sync();
        } catch (Exception e) {
            IoUtil.deleteQuietly(tmp);
            return;
        }
        if (tmp.renameTo(target)) {
            return;
        }
        if (target.delete() && tmp.renameTo(target)) {
            return;
        }
        IoUtil.deleteQuietly(tmp);
    }
}
