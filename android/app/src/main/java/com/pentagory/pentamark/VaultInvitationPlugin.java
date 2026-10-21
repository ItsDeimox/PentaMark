package com.pentagory.pentamark;

import android.content.Intent;
import android.net.Uri;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.net.URI;
import java.util.Arrays;

@CapacitorPlugin(name="VaultInvitation")
public final class VaultInvitationPlugin extends Plugin {
    private String pending;
    @Override public void load() { capture(getActivity().getIntent(), false); }
    @Override protected void handleOnNewIntent(Intent intent) { capture(intent, true); }
    private synchronized void capture(Intent intent, boolean emit) {
        String value = intent == null ? null : intent.getDataString();
        if (!validInvitation(value)) return;
        pending=value;
        if (emit && hasListeners("invitation")) notifyListeners("invitation",new JSObject().put("url",value));
    }
    @PluginMethod public synchronized void getLaunchInvitation(PluginCall call) {
        JSObject result=new JSObject(); if(pending!=null)result.put("url",pending);call.resolve(result);
    }
    @PluginMethod public synchronized void acknowledge(PluginCall call) {
        if(pending!=null&&pending.equals(call.getString("url")))pending=null;
        call.resolve();
    }
    @PluginMethod public void openOfficialInvite(PluginCall call) {
        String value=call.getString("url");
        if(!validOfficialInvite(value)){call.reject("Convite Tailscale inválido.");return;}
        getActivity().runOnUiThread(()->{
            try { Intent intent=new Intent(Intent.ACTION_VIEW,Uri.parse(value));intent.addCategory(Intent.CATEGORY_BROWSABLE);getActivity().startActivity(intent);call.resolve(); }
            catch(Exception error){call.reject("Não foi possível abrir o convite.");}
        });
    }
    static boolean validOfficialInvite(String value) {
        if(value==null||value.length()>2048)return false;
        try{URI uri=new URI(value);return "https".equals(uri.getScheme())&&"login.tailscale.com".equals(uri.getHost())&&uri.getPort()==-1&&uri.getUserInfo()==null&&uri.getQuery()==null&&uri.getFragment()==null&&uri.getPath().matches("/admin/invite/[A-Za-z0-9_-]+")&&!value.contains("\\");}catch(Exception error){return false;}
    }
    static boolean validInvitation(String value) {
        if(value==null||value.length()>4096)return false;
        try{
            Uri uri=Uri.parse(value);
            if(!"pentamark".equals(uri.getScheme())||!"join".equals(uri.getHost())||uri.getUserInfo()!=null||uri.getFragment()!=null||!(uri.getPath()==null||uri.getPath().isEmpty()||uri.getPath().equals("/"))||!"1".equals(uri.getQueryParameter("v")))return false;
            for(String key:uri.getQueryParameterNames())if(!Arrays.asList("v","host","invite","name").contains(key)||uri.getQueryParameters(key).size()!=1)return false;
            new RemoteConnection(uri.getQueryParameter("host")).close();
            return validOfficialInvite(uri.getQueryParameter("invite"));
        }catch(Exception error){return false;}
    }
}
