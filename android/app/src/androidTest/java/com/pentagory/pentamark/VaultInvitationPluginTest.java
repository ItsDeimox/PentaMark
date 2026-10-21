package com.pentagory.pentamark;

import static org.junit.Assert.*;
import android.content.Intent;
import android.net.Uri;
import android.os.SystemClock;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONTokener;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class VaultInvitationPluginTest {
    private String invite(String host){return "pentamark://join?v=1&host="+Uri.encode(host)+"&invite="+Uri.encode("https://login.tailscale.com/admin/invite/offline_test")+"&name=Convite%20offline";}
    @Test public void rejectsOtherSchemesCredentialsAndUntrustedOrigins(){
        assertTrue(VaultInvitationPlugin.validInvitation(invite("http://100.100.10.20:3417")));
        for(String host:new String[]{"http://127.0.0.1:3417","https://evil.example","http://x:y@100.100.10.20:3417","http://100.100.10.20:3417/api/config"})assertFalse(host,VaultInvitationPlugin.validInvitation(invite(host)));
        assertFalse(VaultInvitationPlugin.validInvitation(invite("http://100.100.10.20:3417")+"&v=1"));
        assertFalse(VaultInvitationPlugin.validOfficialInvite("https://login.tailscale.com.evil.example/admin/invite/test"));
        assertFalse(VaultInvitationPlugin.validOfficialInvite("javascript:alert(1)"));
    }
    private Object evaluate(ActivityScenario<MainActivity> scenario,String script)throws Exception{
        CountDownLatch done=new CountDownLatch(1);AtomicReference<String> result=new AtomicReference<>();
        scenario.onActivity(activity->activity.getBridge().getWebView().evaluateJavascript(script,value->{result.set(value);done.countDown();}));
        assertTrue(done.await(10,TimeUnit.SECONDS));return new JSONTokener(result.get()==null?"null":result.get()).nextValue();
    }
    private void await(ActivityScenario<MainActivity> scenario,String expression)throws Exception{
        long until=SystemClock.elapsedRealtime()+30000;
        while(SystemClock.elapsedRealtime()<until){if(Boolean.TRUE.equals(evaluate(scenario,expression)))return;SystemClock.sleep(100);}
        fail("Timed out: "+expression+" page="+evaluate(scenario,"document.body.innerText.slice(0,1200)")+" diagnostics="+evaluate(scenario,"JSON.stringify({url:location.href,dialogs:Array.from(document.querySelectorAll('dialog')).map(d=>({open:d.open,text:d.innerText,display:getComputedStyle(d).display})),toast:document.querySelector('.pm-toast')?.textContent,parse:(()=>{try{const u=new URL('pentamark://join?v=1&host=http%3A%2F%2F100.100.10.20%3A3417&invite=https%3A%2F%2Flogin.tailscale.com%2Fadmin%2Finvite%2Foffline_test&name=Convite%20offline');return {protocol:u.protocol,host:u.hostname,path:u.pathname,keys:Array.from(u.searchParams.keys())};}catch(e){return String(e);}})()})"));
    }
    @Test public void realNativeIntentOpensGuidedDialogWithoutConnectingOrNetwork()throws Exception{
        Intent intent=new Intent(Intent.ACTION_VIEW,Uri.parse(invite("http://100.100.10.20:3417")),InstrumentationRegistry.getInstrumentation().getTargetContext(),MainActivity.class);
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(intent)){
            await(scenario,"!!document.querySelector('dialog[open]') && document.body.innerText.includes('Convite offline')");
            assertEquals(Boolean.TRUE,evaluate(scenario,"Array.from(document.querySelectorAll('dialog[open] button')).some(b=>b.textContent==='Conectar ao cofre'&&b.disabled)"));
            assertEquals(Boolean.TRUE,evaluate(scenario,"!localStorage.getItem('pentamark:android:remote-profile')"));
            scenario.onActivity(activity->assertTrue(activity.getBridge().getWebView().getSettings().getBlockNetworkLoads()));
            evaluate(scenario,"Array.from(document.querySelectorAll('dialog[open] button')).find(b=>b.textContent==='Cancelar').click();true");
            await(scenario,"!document.querySelector('dialog[open]')");
        }
    }
}
