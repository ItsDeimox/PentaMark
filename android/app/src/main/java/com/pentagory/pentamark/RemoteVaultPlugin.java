package com.pentagory.pentamark;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.IOException;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

/** The official Tailscale VPN provides connectivity; this plugin neither starts nor manages a VPN. */
@CapacitorPlugin(name = "RemoteVault")
public final class RemoteVaultPlugin extends Plugin {
    private final Object lock = new Object();
    private final ThreadPoolExecutor requests = new ThreadPoolExecutor(2, 2, 0, TimeUnit.SECONDS, new ArrayBlockingQueue<>(16));
    private RemoteConnection connection;
    private RemoteConnection.EventSession events;
    private long eventGeneration;
    private boolean paused;

    @PluginMethod public void configure(PluginCall call) {
        try {
            RemoteConnection next = new RemoteConnection(call.getString("origin"));
            RemoteConnection previous;
            synchronized (lock) {
                stopEventsLocked(); previous = connection; connection = next;
            }
            if (previous != null) previous.close();
            call.resolve();
        } catch (Exception error) { call.reject(error.getMessage(), error); }
    }

    private RemoteConnection current() throws IOException {
        synchronized (lock) {
            if (connection == null) throw new IOException("Configure a Tailscale vault first");
            return connection;
        }
    }

    @PluginMethod public void request(PluginCall call) {
        try {
            // Capture now, not when the queued operation eventually starts.
            RemoteConnection target = current();
            String url = call.getString("url");
            String method = call.getString("method", "GET");
            String body = call.getString("body");
            String base64 = call.getString("base64");
            String clientId = call.getString("clientId");
            requests.execute(() -> {
                try { call.resolve(new JSObject(target.request(url, method, body, base64, clientId).toString())); }
                catch (Exception error) { call.reject(error.getMessage(), error); }
            });
        } catch (RejectedExecutionException error) { call.reject("Remote vault is busy; try again", error); }
        catch (Exception error) { call.reject(error.getMessage(), error); }
    }

    @PluginMethod public void startEvents(PluginCall call) {
        try {
            synchronized (lock) {
                if (paused) throw new IOException("Remote events are paused");
                RemoteConnection target = current();
                stopEventsLocked();
                long generation = eventGeneration;
                events = target.startEvents(call.getString("url"), (type, data) -> {
                    synchronized (lock) {
                        if (generation == eventGeneration && !paused && connection == target) {
                            notifyListeners("remoteEvent", new JSObject().put("type", type).put("data", data));
                        }
                    }
                });
            }
            // Accepted, not necessarily connected. The 'open' event confirms the handshake.
            call.resolve();
        } catch (Exception error) {
            notifyListeners("remoteEvent", new JSObject().put("type", "error").put("data", error.getMessage()));
            call.reject(error.getMessage(), error);
        }
    }

    private void stopEventsLocked() {
        eventGeneration++;
        if (events != null) { events.close(); events = null; }
    }

    @PluginMethod public void stopEvents(PluginCall call) {
        synchronized (lock) { stopEventsLocked(); }
        call.resolve();
    }

    /** A WebView reload can keep this plugin alive when the frontend returns to local. */
    @PluginMethod public void disconnect(PluginCall call) {
        synchronized (lock) { disconnectLocked(); }
        call.resolve();
    }

    private void disconnectLocked() {
        RemoteConnection previous = connection;
        connection = null;
        stopEventsLocked(); // Invalidates callbacks before closing the socket.
        // Close before releasing the lock: captured/queued requests keep this closed
        // instance and cannot be redirected to a later configure() destination.
        if (previous != null) previous.close();
    }

    RemoteConnection.Media openMedia(String path, String range) throws IOException { return current().openMedia(path, range); }

    @Override protected void handleOnPause() {
        synchronized (lock) { paused = true; stopEventsLocked(); }
        super.handleOnPause();
    }

    @Override protected void handleOnResume() {
        synchronized (lock) { paused = false; }
        // Frontend visibility/resume owns restart and reconnect backoff.
        super.handleOnResume();
    }

    @Override protected void handleOnDestroy() {
        synchronized (lock) { paused = true; disconnectLocked(); }
        // Drain queued calls against the closed connection so their promises reject.
        requests.shutdown();
        super.handleOnDestroy();
    }
}
