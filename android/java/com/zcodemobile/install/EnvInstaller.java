package com.zcodemobile.install;

import android.content.Context;
import android.content.res.AssetManager;
import android.util.Log;

import com.zcodemobile.util.AssetUnpacker;
import com.zcodemobile.util.AtomicFileWriter;
import com.zcodemobile.util.FileModeUtil;
import com.zcodemobile.util.IoUtil;
import com.zcodemobile.util.Sha256;

import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;

/**
 * Optional, deferred Bionic userspace installer. The Node backend does NOT need
 * this (it is Bionic-linked), so failure here is best-effort and never blocks
 * the app. Runs on a background thread after the backend is already serving.
 */
public final class EnvInstaller {

    private static final String TAG = "EnvInstaller";

    public static final String ASSET_BOOTSTRAP = "env/bootstrap/bootstrap.tar.gz";
    public static final String ASSET_BOOTSTRAP_PLAIN = "env/bootstrap/bootstrap.tar";
    public static final String ASSET_MANIFEST = "env/manifest.json";
    public static final String ASSET_OVERLAY = "env/overlay";
    public static final String PREFIX_DIR = "usr";
    public static final String MARKER = ".installed";

    private EnvInstaller() {
    }

    public static File prefix(Context context) {
        return new File(context.getFilesDir(), PREFIX_DIR);
    }

    public static boolean isInstalled(Context context) {
        return new File(prefix(context), MARKER).isFile();
    }

    public static boolean isBundled(Context context) {
        AssetManager assets = context.getAssets();
        return AssetUnpacker.hasFile(assets, ASSET_BOOTSTRAP)
                || AssetUnpacker.hasFile(assets, ASSET_BOOTSTRAP_PLAIN);
    }

    /** @return a short status string; never throws to the caller. */
    public static synchronized String install(Context context) {
        AssetManager assets = context.getAssets();
        String asset = AssetUnpacker.hasFile(assets, ASSET_BOOTSTRAP) ? ASSET_BOOTSTRAP : null;
        if (asset == null && AssetUnpacker.hasFile(assets, ASSET_BOOTSTRAP_PLAIN)) {
            asset = ASSET_BOOTSTRAP_PLAIN;
        }
        if (asset == null) {
            return "skipped: no bootstrap archive bundled";
        }

        String bundleId = readBundleId(assets);
        File prefix = prefix(context);
        File marker = new File(prefix, MARKER);
        if (marker.isFile()) {
            try {
                if (bundleId == null
                        || bundleId.equals(IoUtil.readAll(new FileInputStream(marker), "UTF-8").trim())) {
                    return "already installed";
                }
                Log.i(TAG, "env bundle changed; reinstalling");
            } catch (Exception ignored) {
            }
        }

        File archive = null;
        try {
            if (!prefix.isDirectory() && !prefix.mkdirs()) {
                throw new IllegalStateException("cannot create " + prefix);
            }
            archive = File.createTempFile("zcode-bootstrap", ".tar", context.getCacheDir());
            AssetUnpacker.copyFile(assets, asset, archive);
            String expectedSha = readBootstrapSha(assets);
            if (expectedSha != null) {
                String actual = Sha256.of(archive);
                if (!expectedSha.equalsIgnoreCase(actual)) {
                    throw new IllegalStateException("bootstrap sha256 mismatch: " + actual);
                }
            }
            int links;
            try (InputStream in = new FileInputStream(archive)) {
                links = asset.endsWith(".gz")
                        ? TarExtractor.untarGz(in, prefix)
                        : TarExtractor.untar(in, prefix);
            }
            if (AssetUnpacker.hasTree(assets, ASSET_OVERLAY)) {
                AssetUnpacker.copyTree(assets, ASSET_OVERLAY, prefix);
            }
            File bin = new File(prefix, "bin");
            if (bin.isDirectory()) {
                FileModeUtil.recursiveSetExec(bin);
            }
            AtomicFileWriter.writeText(marker, bundleId == null ? "unverified" : bundleId);
            return "installed (symlinks=" + links + ")";
        } catch (Exception e) {
            Log.w(TAG, "env install failed (non-fatal): " + e.getMessage());
            return "failed: " + e.getMessage();
        } finally {
            IoUtil.deleteQuietly(archive);
        }
    }

    private static String readBundleId(AssetManager assets) {
        try (InputStream in = assets.open(ASSET_MANIFEST)) {
            JSONObject json = new JSONObject(IoUtil.readAll(in, "UTF-8"));
            return json.optString("bundleId", null);
        } catch (Exception e) {
            return null;
        }
    }

    private static String readBootstrapSha(AssetManager assets) {
        try (InputStream in = assets.open(ASSET_MANIFEST)) {
            JSONObject json = new JSONObject(IoUtil.readAll(in, "UTF-8"));
            return json.optString("bootstrapSha256", null);
        } catch (Exception e) {
            return null;
        }
    }
}
