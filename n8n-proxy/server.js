const http = require('node:http');
const httpProxy = require('http-proxy');

const port = Number(process.env.PORT || 8080);
const upstream = process.env.N8N_UPSTREAM;

if (!upstream) {
  throw new Error('N8N_UPSTREAM is required');
}

const proxy = httpProxy.createProxyServer({
  target: upstream,
  ws: true,
  xfwd: true,
  changeOrigin: false,
});

proxy.on('error', (error, request, response) => {
  console.error('Proxy error:', error.message);

  if (response && !response.headersSent) {
    response.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
  }

  if (response && !response.writableEnded) {
    response.end('AGEN n8n proxy unavailable');
  }
});

const server = http.createServer((request, response) => {
  if (request.url === '/_proxy-health') {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ ok: true, service: 'agen-n8n-proxy' }));
    return;
  }

  proxy.web(request, response);
});

server.on('upgrade', (request, socket, head) => {
  proxy.ws(request, socket, head);
});

server.listen(port, '0.0.0.0', () => {
  console.log(`AGEN n8n proxy listening on 0.0.0.0:${port}`);
});
