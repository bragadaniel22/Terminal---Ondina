// Servidor Node único — serve o index.html estático e monta os MESMOS handlers de api/*.js,
// sem alterar nenhum deles. Usado para hospedar o terminal fora do Vercel (Render, Fly, etc.),
// onde não existe o modelo de "uma função serverless por arquivo".
//
// Os 12 handlers em api/ usam a assinatura do Vercel — handler(req, res) com req.query,
// res.status(), res.setHeader() e res.json(). O `shim` abaixo entrega exatamente esses quatro
// sobre o req/res cru do node:http, por isso nenhum arquivo de api/ precisou mudar.
//
// Sem dependência nova: só node:http. As dependências do package.json (ws, xlsx) continuam
// sendo usadas pelos próprios handlers (histórico de DI Futuro e planilha da NTN-B).
//
// Porta: process.env.PORT (a Render define isso sozinha); 8080 como padrão local.
// Raiz dos arquivos: argumento opcional na linha de comando, senão o diretório atual.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { extname, join, normalize } from 'node:path';

const ROOT = process.argv[2] || '.';
const PORT = process.env.PORT || 8080;

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript',
  '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
};

// Dá ao handler do Vercel exatamente os quatro métodos que ele usa.
function shim(req, res, url) {
  req.query = Object.fromEntries(url.searchParams);
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => {
    if (!res.hasHeader('content-type')) res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(o));
    return res;
  };
  return res;
}

// Importa cada handler uma vez só e reaproveita (o módulo fica vivo entre requisições — é por
// isso que o cache em memória do api/ai-news.js funciona ainda melhor aqui do que no Vercel,
// onde cada invocação podia cair numa instância fria).
const handlers = new Map();
function loadHandler(name) {
  if (!handlers.has(name)) {
    handlers.set(name, import(pathToFileURL(join(ROOT, 'api', name + '.js')).href).then((m) => m.default));
  }
  return handlers.get(name);
}

const SAFE_API = /^[a-z0-9-]+$/i;

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:' + PORT);
  try {
    if (url.pathname.startsWith('/api/')) {
      const name = url.pathname.slice(5).replace(/\/+$/, '');
      if (!SAFE_API.test(name)) { res.statusCode = 404; return res.end('{"error":"rota desconhecida"}'); }
      const handler = await loadHandler(name);
      return handler(req, shim(req, res, url));
    }

    // Arquivo estático. `normalize` + a checagem de '..' evitam servir nada fora da raiz.
    const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
    if (normalize(rel).startsWith('..')) { res.statusCode = 403; return res.end('403'); }
    const buf = await readFile(join(ROOT, rel));
    res.setHeader('Content-Type', TYPES[extname(rel).toLowerCase()] || 'application/octet-stream');
    res.end(buf);
  } catch (e) {
    const faltando = e.code === 'ENOENT' || e.code === 'ERR_MODULE_NOT_FOUND';
    res.statusCode = faltando ? 404 : 500;
    res.end(JSON.stringify({ error: faltando ? 'não encontrado' : e.message }));
  }
// 0.0.0.0 é obrigatório na Render (e em qualquer container): escutar só em localhost deixaria
// o serviço inacessível de fora e a Render marcaria o deploy como falho.
}).listen(PORT, '0.0.0.0', () => console.log('terminal no ar na porta ' + PORT));
