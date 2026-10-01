const http = require('http');

const PORT = Number(process.env.PORT || 8080);

http.createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  res.writeHead(404);
  res.end('not found');
}).listen(PORT, '0.0.0.0');
