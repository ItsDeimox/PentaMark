import {pathToFileURL} from 'node:url';
export function assertSupportedNode(version){
 const match=/^(\d+)\.(\d+)\.(\d+)$/.exec(version);
 const [major,minor,patch]=match?match.slice(1).map(Number):[0,0,0];
 if(major<24||(major===24&&(minor<18||(minor===18&&patch<1))))throw new Error('PentaMark precisa do Node.js 24.18.1 ou superior para o armazenamento SQLite. Atualize o Node.js; seus arquivos não foram alterados.');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{assertSupportedNode(process.versions.node);await import('node:sqlite');}
 catch(error){console.error(error.message);process.exitCode=1;}
}
