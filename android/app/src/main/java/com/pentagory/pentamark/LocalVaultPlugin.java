package com.pentagory.pentamark;

import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.system.ErrnoException;
import android.system.Os;
import android.system.OsConstants;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.InputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.util.LinkedHashSet;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/** Register in MainActivity before super.onCreate(). SAF grants need no storage permission. */
@CapacitorPlugin(name = "LocalVault")
public final class LocalVaultPlugin extends Plugin {
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final AtomicBoolean pickerOpen = new AtomicBoolean();
    private LocalVault vault;

    private LocalVault vault() throws Exception {
        if (vault == null) vault = new LocalVault(new File(getContext().getFilesDir(), "vault"), new LocalVault.FileAccess() {
            public void move(File source, File destination, boolean replace) throws IOException {
                if (!replace && destination.exists()) throw new IOException("O destino já existe");
                try { Os.rename(source.getAbsolutePath(), destination.getAbsolutePath()); }
                catch (ErrnoException e) { throw new IOException("Não foi possível mover o arquivo", e); }
            }
            public boolean isSymbolicLink(File file) throws IOException {
                try { return OsConstants.S_ISLNK(Os.lstat(file.getAbsolutePath()).st_mode); }
                catch (ErrnoException e) {
                    if (e.errno == OsConstants.ENOENT || e.errno == OsConstants.ENOTDIR) return false;
                    throw new IOException("Não foi possível validar caminho", e);
                }
            }
            public byte[] decodeBase64(String value) { return Base64.decode(value, Base64.NO_WRAP); }
        });
        return vault;
    }

    @PluginMethod public void info(PluginCall call) {
        executor.execute(() -> {
            try { call.resolve(new JSObject().put("root", vault().getRoot())); }
            catch (Exception e) { call.reject("Não foi possível abrir o cofre local", e); }
        });
    }

    @PluginMethod public void request(PluginCall call) {
        String url = call.getString("url");
        String method = call.getString("method", "GET");
        String body = call.getString("body");
        String base64 = call.getString("base64");
        if (url == null) { call.reject("url é obrigatório"); return; }
        executor.execute(() -> {
            try { call.resolve(new JSObject(vault().request(url, method, body, base64).toString())); }
            catch (Exception e) { call.reject("Não foi possível abrir o cofre local", e); }
        });
    }

    @PluginMethod public void exportVault(PluginCall call) {
        if (!pickerOpen.compareAndSet(false, true)) { call.reject("Já existe um seletor de documentos aberto"); return; }
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/zip");
        intent.putExtra(Intent.EXTRA_TITLE, "PentaMark-" + System.currentTimeMillis() + ".zip");
        getActivity().runOnUiThread(() -> {
            try { startActivityForResult(call, intent, "exportResult"); }
            catch (Exception e) { pickerOpen.set(false); call.reject("Não foi possível abrir o seletor", e); }
        });
    }

    @ActivityCallback private void exportResult(PluginCall call, ActivityResult result) {
        if (call == null) { pickerOpen.set(false); return; }
        Uri uri = result.getData() == null ? null : result.getData().getData();
        if (result.getResultCode() != Activity.RESULT_OK || uri == null) {
            pickerOpen.set(false); call.resolve(new JSObject().put("cancelled", true)); return;
        }
        executor.execute(() -> {
            try {
                try (OutputStream output = getContext().getContentResolver().openOutputStream(uri, "wt")) {
                    if (output == null) throw new java.io.IOException("Documento indisponível");
                    vault().exportZip(output);
                }
                call.resolve(new JSObject().put("cancelled", false));
            } catch (Exception e) { call.reject("Falha ao exportar o cofre; os arquivos originais foram preservados", e); }
            finally { pickerOpen.set(false); }
        });
    }

    @PluginMethod public void importDocuments(PluginCall call) {
        if (!pickerOpen.compareAndSet(false, true)) { call.reject("Já existe um seletor de documentos aberto"); return; }
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        getActivity().runOnUiThread(() -> {
            try { startActivityForResult(call, intent, "importResult"); }
            catch (Exception e) { pickerOpen.set(false); call.reject("Não foi possível abrir o seletor", e); }
        });
    }

    @ActivityCallback private void importResult(PluginCall call, ActivityResult result) {
        if (call == null) { pickerOpen.set(false); return; }
        Intent intent = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || intent == null) {
            pickerOpen.set(false); call.resolve(new JSObject().put("cancelled", true)); return;
        }
        Set<Uri> uris = new LinkedHashSet<>();
        ClipData clips = intent.getClipData();
        if (clips != null) for (int i = 0; i < clips.getItemCount(); i++) uris.add(clips.getItemAt(i).getUri());
        if (intent.getData() != null) uris.add(intent.getData());
        executor.execute(() -> {
            int count = 0;
            try {
                for (Uri uri : uris) {
                    String name = displayName(uri);
                    try (InputStream input = getContext().getContentResolver().openInputStream(uri)) {
                        if (input == null) throw new java.io.IOException("Documento indisponível");
                        vault().importDocument(name, input);
                        count++;
                    }
                }
                call.resolve(new JSObject().put("count", count));
            } catch (Exception e) {
                call.reject("Falha na importação após " + count + " arquivo(s). As cópias concluídas e os originais foram preservados. " + e.getMessage(), e);
            } finally {
                if (count > 0) notifyListeners("vaultChanged", new JSObject().put("type", "notes"));
                pickerOpen.set(false);
            }
        });
    }

    private String displayName(Uri uri) {
        try (Cursor cursor = getContext().getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (index >= 0 && !cursor.isNull(index)) return cursor.getString(index);
            }
        }
        return "arquivo";
    }

    @Override protected void handleOnDestroy() {
        executor.shutdown();
        super.handleOnDestroy();
    }
}
