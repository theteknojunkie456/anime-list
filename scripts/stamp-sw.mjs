// The service worker is the only thing that decides whether a device ever sees a
// new build, and a browser installs a new one ONLY when sw.js itself changes
// byte-wise. Ours had not changed in seven weeks while index.html changed
// constantly, so no device installed a new worker, the activate handler that
// purges old caches never ran, and phones kept serving an August cache.
//
// So the cache name is stamped from the content it caches. Any change to the app
// changes sw.js, which installs a new worker, which drops every older cache. No
// hand-bumping, nothing to remember.
import {readFileSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
const root=join(dirname(fileURLToPath(import.meta.url)),'..');
export function expectedCache(){
  const h=createHash('sha256').update(readFileSync(join(root,'index.html'))).digest('hex').slice(0,10);
  return 'animelist-'+h;
}
export function currentCache(){
  const m=readFileSync(join(root,'sw.js'),'utf8').match(/const CACHE = '([^']+)'/);
  return m?m[1]:null;
}
// Run directly: rewrite sw.js if it is out of date, and say whether it moved.
if(process.argv[1]&&process.argv[1].endsWith('stamp-sw.mjs')){
  const want=expectedCache(), have=currentCache();
  if(want===have){console.log('stamp-sw: already '+want);}
  else{
    const p=join(root,'sw.js');
    writeFileSync(p, readFileSync(p,'utf8').replace(/const CACHE = '[^']+'/, "const CACHE = '"+want+"'"));
    console.log('stamp-sw: '+have+' -> '+want);
  }
}
