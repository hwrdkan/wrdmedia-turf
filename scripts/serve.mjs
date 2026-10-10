import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(process.argv[2]||'.'),port=Number(process.argv[3]||8787);
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.woff2':'font/woff2','.svg':'image/svg+xml','.mp4':'video/mp4'};
http.createServer((req,res)=>{try{
const u=new URL(req.url,'http://localhost');
if(u.pathname.startsWith('/api/')){res.writeHead(503,{'Content-Type':'application/json'});return res.end(JSON.stringify({error:'AI rendering is paused in this local static preview. Configure your own Cloudflare function and provider key to enable it.'}))}
let f=path.resolve(root,'.'+decodeURIComponent(u.pathname));
if(f!==root&&!f.startsWith(root+path.sep)){res.writeHead(403);return res.end('Forbidden')}
if(fs.existsSync(f)&&fs.statSync(f).isDirectory())f=path.join(f,'index.html');
if(!fs.existsSync(f)){if(fs.existsSync(f+'.html'))f+='.html';else{res.writeHead(404);return res.end('Not found')}}
res.writeHead(200,{'Content-Type':types[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(res);
}catch{res.writeHead(400);res.end('Bad request')}}).listen(port,'127.0.0.1',()=>console.log(`Preview: http://localhost:${port}`));
