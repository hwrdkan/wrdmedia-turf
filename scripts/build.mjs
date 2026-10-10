import fs from 'node:fs';
fs.mkdirSync('public',{recursive:true});
for(const p of ['index.html','src','assets','_headers'])fs.cpSync(p,'public/'+p,{recursive:true});
if(!fs.existsSync('public/img/vendor'))throw new Error('Keep public/img/ in the project: these are the bundled image source files.');
console.log('Built public/. Backend: functions/, visualizer/, data/ remain outside public/.');
