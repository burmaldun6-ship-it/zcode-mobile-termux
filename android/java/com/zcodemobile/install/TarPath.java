package com.zcodemobile.install;

import java.util.ArrayList;
import java.util.List;

/** Normalizes a tar entry name into a safe relative path (null = reject). */
public final class TarPath {

    private TarPath() {
    }

    public static String normalize(String rawName) {
        if (rawName == null) {
            return null;
        }
        String name = rawName.replace('\\', '/');
        if (name.startsWith("/")) {
            return null;
        }
        while (name.startsWith("./")) {
            name = name.substring(2);
        }
        if (name.isEmpty() || ".".equals(name)) {
            return "";
        }
        List<String> parts = new ArrayList<>();
        for (String part : name.split("/")) {
            if (part.isEmpty() || ".".equals(part)) {
                continue;
            }
            if ("..".equals(part)) {
                return null;
            }
            parts.add(part);
        }
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < parts.size(); i++) {
            if (i > 0) {
                sb.append('/');
            }
            sb.append(parts.get(i));
        }
        return sb.toString();
    }
}
