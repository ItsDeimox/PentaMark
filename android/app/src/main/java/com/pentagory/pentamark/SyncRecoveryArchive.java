package com.pentagory.pentamark;
import java.io.*;
import org.json.JSONObject;
import java.util.*;
import java.util.zip.*;
/** Opaque archive; never opens SQLite or constructs a replica. Caller owns exclusive writer gate. */
final class SyncRecoveryArchive {
    interface Links { boolean isLink(File file)throws IOException; }
    private static final String[] DATABASE_FILES={"replica.db","replica.db-wal","replica.db-shm","replica.db-journal"};
    static void copyDatabaseFiles(File root,File destination,Links links)throws Exception {
        check(root,links);check(destination,links);
        if(!destination.isDirectory() || destination.list()==null || destination.list().length!=0
            || destination.equals(root) || destination.getPath().startsWith(root.getPath()+File.separator))throw new IOException("unsafe-destination");
        Map<String,String> before=databaseInventory(root,links);
        byte[] buffer=new byte[65536];
        for(String name:before.keySet()) {
            File source=new File(root,name),copy=new File(destination,name);check(source,links);
            try(InputStream in=new FileInputStream(source);FileOutputStream out=new FileOutputStream(copy)) {
                int n;while((n=in.read(buffer))!=-1)out.write(buffer,0,n);out.getFD().sync();
            }
            if(!before.get(name).equals(copy.length()+":"+SyncFileJournal.hash(copy)))throw new IOException("export-source-changed");
        }
        if(!before.equals(databaseInventory(root,links)))throw new IOException("export-source-changed");
    }
    static Map<String,String> databaseInventory(File root,Links links)throws Exception {
        Map<String,String> result=new TreeMap<>();check(root,links);
        for(String name:DATABASE_FILES) {
            File file=new File(root,name);check(file,links);
            if(!file.exists())continue;if(!file.isFile())throw new IOException("unsafe-path");
            result.put(name,file.length()+":"+SyncFileJournal.hash(file));
        }
        return result;
    }
    static void write(File root,JSONObject profile,OutputStream output,Links links)throws Exception {
        if(links.isLink(root)||!root.isDirectory())throw new IOException("unsafe-path");
        root=root.getCanonicalFile();
        Map<String,String> before=inventory(root,links);
        JSONObject label=new JSONObject().put("format","pentamark-opaque-recovery").put("formatVersion",1)
            .put("requiresCompatibleApp",true).put("warning","Opaque recovery backup; requires a compatible future app. Not a logical replica export.")
            .put("profile",profile).put("files",new JSONObject(before));
        try(ZipOutputStream zip=new ZipOutputStream(new FilterOutputStream(output){
            @Override public void write(byte[] b,int off,int len)throws IOException{out.write(b,off,len);}
            @Override public void close()throws IOException{flush();}
        })) {
            zip.putNextEntry(new ZipEntry("recovery.json"));zip.write(label.toString().getBytes("UTF-8"));zip.closeEntry();
            byte[] buffer=new byte[65536];
            for(String name:before.keySet()) {
                File file=new File(root,name);check(file,links);
                zip.putNextEntry(new ZipEntry("replica/"+name));
                if(!name.endsWith("/")) {
                    java.security.MessageDigest digest=java.security.MessageDigest.getInstance("SHA-256");long length=0;
                    try(InputStream in=new FileInputStream(file)){int n;while((n=in.read(buffer))!=-1){zip.write(buffer,0,n);digest.update(buffer,0,n);length+=n;}}
                    StringBuilder hash=new StringBuilder();for(byte b:digest.digest())hash.append(String.format(Locale.ROOT,"%02x",b&255));
                    if(!before.get(name).equals(length+":"+hash))throw new IOException("export-source-changed");
                }
                zip.closeEntry();
            }
            if(!before.equals(inventory(root,links)))throw new IOException("export-source-changed");
        }
        if(!before.equals(inventory(root,links)))throw new IOException("export-source-changed");
    }
    private static Map<String,String> inventory(File root,Links links)throws Exception {
        Map<String,String> result=new TreeMap<>();walk(root,"",result,links);return result;
    }
    private static void check(File file,Links links)throws IOException {
        if(links.isLink(file)||!file.getCanonicalFile().equals(file.getAbsoluteFile()))throw new IOException("unsafe-path");
    }
    private static void walk(File dir,String prefix,Map<String,String> result,Links links)throws Exception {
        check(dir,links);File[] children=dir.listFiles();if(children==null)throw new IOException("storage-unavailable");
        for(File child:children) {
            check(child,links);String name=child.getName();
            if(name.contains("\\")||name.contains("/")||name.equals(".")||name.equals(".."))throw new IOException("unsafe-path");
            String path=prefix+name;
            if(child.isDirectory()){result.put(path+"/","directory");walk(child,path+"/",result,links);}
            else if(child.isFile())result.put(path,child.length()+":"+SyncFileJournal.hash(child));
            else throw new IOException("unsafe-path");
        }
    }
}
