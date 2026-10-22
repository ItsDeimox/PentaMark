import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
export function verifyInstrumentation(text,expected){
 if(/FAILURES|INSTRUMENTATION_FAILED|shortMsg=Process crashed|INSTRUMENTATION_STATUS_CODE:\s*-[1-9]/.test(text))throw Error('Instrumentation failed or skipped a test');
 const summary=/\bOK \(([1-9][0-9]*) tests?\)/.exec(text);if(!summary)throw Error('Missing successful nonempty test summary');
 const completed=[];let record={};
 for(const line of text.split(/\r?\n/)){
  const field=/^INSTRUMENTATION_STATUS: (class|test)=(.*)$/.exec(line);if(field)record[field[1]]=field[2];
  const code=/^INSTRUMENTATION_STATUS_CODE:\s*(-?\d+)/.exec(line);
  if(code){if(Number(code[1])===0&&record.class&&record.test)completed.push(record.class+'#'+record.test);record={};}
 }
 const count=Number(summary[1]);
 if(completed.length!==count)throw Error('Missing successful test completion records');
 if(expected&&(count!==1||completed[0]!==expected))throw Error('Missing expected interop completion');
 return count;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{console.log('Verified completed tests: '+verifyInstrumentation(readFileSync(process.argv[2],'utf8'),process.argv[3]));}
 catch(error){console.error(error.message);process.exitCode=1;}
}
