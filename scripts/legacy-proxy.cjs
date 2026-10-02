// Temporary compatibility for installed clients still using the former Render URL.
// No Mongo, JWT signing key or provider credentials are needed by this process.
const http = require('node:http');
const { Readable } = require('node:stream');
const allowed = new Set(['/api/v1/health', '/api/v1/auth/sign-in', '/api/v1/auth/sign-in/password', '/api/v1/auth/sign-up', '/api/v1/auth/sign-out']);
const server = http.createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (!allowed.has(path) || !['GET', 'POST'].includes(req.method)) { res.writeHead(404).end(); return; }
  const chunks=[];let bytes=0;
  try {
    for await (const chunk of req) { bytes+=chunk.length;if(bytes>24576){res.writeHead(413).end();return;}chunks.push(chunk); }
    const headers = {accept:'application/json','content-type':'application/json'};
    if (req.headers.authorization) headers.authorization=req.headers.authorization;
    const upstream = await fetch('https://api.deepdrill.cl'+path, {method:req.method, headers, body:req.method==='POST'?Buffer.concat(chunks):undefined, redirect:'error', signal:AbortSignal.timeout(15000)});
    res.setHeader('content-type','application/json');res.setHeader('cache-control','no-store');res.setHeader('x-content-type-options','nosniff');
    if(upstream.headers.has('retry-after'))res.setHeader('retry-after',upstream.headers.get('retry-after'));
    res.writeHead(upstream.status);
    if(upstream.body)Readable.fromWeb(upstream.body).pipe(res);else res.end();
  } catch { if(!res.headersSent)res.writeHead(503,{'content-type':'application/json'});res.end(JSON.stringify({statusCode:503,code:'SERVICE_UNAVAILABLE',message:'Service temporarily unavailable.'})); }
});
server.listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log('Legacy API compatibility proxy ready'));
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
