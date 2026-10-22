package com.pentagory.pentamark;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import java.util.zip.*;
import org.json.*;

/** Native streaming backup. Caller serializes working-file mutations for the whole call. */
final class SyncReplicaArchive {
    static void write(SyncFileJournal files,JSONObject manifest,OutputStream output)throws Exception {
        requireReferences(files,manifest);
        // Own the ZIP compressor, but not the provider stream; the plugin must close that before success.
        try(ZipOutputStream zip=new ZipOutputStream(new FilterOutputStream(output){@Override public void close()throws IOException{flush();}})) {
            zip.putNextEntry(new ZipEntry("manifest.json"));zip.write(manifest.toString().getBytes(StandardCharsets.UTF_8));zip.closeEntry();
            working(files,files.working,"",zip);
            File[] objects=files.objects.listFiles();if(objects==null)throw new IOException("storage-unavailable");
            Arrays.sort(objects,Comparator.comparing(File::getName));
            for(File object:objects) {
                String hash=object.getName();File verified=files.object(hash);
                if(!verified.isFile())throw new IOException("blob-unavailable");
                entry(zip,"objects/"+hash,verified,hash);
            }
        }
    }
    private static void requireReferences(SyncFileJournal files,Object value)throws Exception {
        if(value instanceof JSONObject) {
            JSONObject object=(JSONObject)value;
            if(!object.isNull("blobHash") && object.has("byteLength"))files.require(object.getString("blobHash"),object.getLong("byteLength"));
            Iterator<String> keys=object.keys();while(keys.hasNext())requireReferences(files,object.get(keys.next()));
        } else if(value instanceof JSONArray) {
            JSONArray array=(JSONArray)value;for(int i=0;i<array.length();i++)requireReferences(files,array.get(i));
        }
    }
    private static void working(SyncFileJournal files,File directory,String prefix,ZipOutputStream zip)throws Exception {
        File[] children=directory.listFiles();if(children==null)throw new IOException("storage-unavailable");
        Arrays.sort(children,Comparator.comparing(File::getName));
        for(File child:children) {
            String path=prefix+child.getName();File checked=files.target(path);
            if(checked.isDirectory()) {
                zip.putNextEntry(new ZipEntry("working/"+path+"/"));zip.closeEntry();working(files,checked,path+"/",zip);
            }else if(checked.isFile())entry(zip,"working/"+path,checked,SyncFileJournal.hash(checked));
            else throw new IOException("unsafe-path");
        }
    }
    private static void entry(ZipOutputStream zip,String name,File source,String expectedHash)throws Exception {
        long expectedLength=source.length(),count=0;MessageDigest digest=MessageDigest.getInstance("SHA-256");
        zip.putNextEntry(new ZipEntry(name));
        try(InputStream input=new FileInputStream(source)) {
            byte[] buffer=new byte[65536];int n;while((n=input.read(buffer))!=-1){zip.write(buffer,0,n);digest.update(buffer,0,n);count+=n;}
        }
        StringBuilder hash=new StringBuilder();for(byte b:digest.digest())hash.append(String.format(Locale.ROOT,"%02x",b&255));
        if(count!=expectedLength || !expectedHash.equals(hash.toString()))throw new IOException("export-source-changed");
        zip.closeEntry();
    }
}
