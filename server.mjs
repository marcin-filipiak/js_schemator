/* Minimalny serwer statyczny bez zależności — uruchom: npm start
 *
 * Serwer celowo nie pozwala przeglądarce trzymać w cache plików aplikacji:
 *  - wysyła nagłówki no-store / no-cache,
 *  - dopisuje do importów JS oraz do <script>/<link> w HTML parametr ?v=<hash>.
 * Hash jest liczony z zawartości pliku ORAZ z hashy jego importów, więc zmiana
 * dowolnego modułu zmienia adresy wszystkich modułów, które go używają.
 * Dzięki temu po każdej zmianie kodu przeglądarka pobiera świeże pliki i nie
 * trzeba czyścić cache ręcznie.
 */
import http from 'node:http';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)));
const port = Number(process.env.PORT) || 5173;

let appVersion = '0.0.0';
try {
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  if (pkg && typeof pkg.version === 'string') appVersion = pkg.version;
} catch {
  /* brak package.json — zostaje wersja domyślna */
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

const NO_CACHE = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
  Pragma: 'no-cache',
  Expires: '0'
};

/* --- zbieranie zależności --- */

const IMPORT_RE = /(\bfrom\s*|\bimport\s*|\bimport\(\s*)(['"])([^'"]+)\2/g;
const HTML_REF_RE = /(\b(?:src|href))=("|')([^"']+)\2/g;

function jsSpecifiers(source) {
  const out = [];
  for (const match of source.matchAll(IMPORT_RE)) {
    const spec = match[3];
    if (spec.startsWith('.') || spec.startsWith('/')) out.push(spec.split('?')[0]);
  }
  return out;
}

function htmlSpecifiers(source) {
  const out = [];
  for (const match of source.matchAll(HTML_REF_RE)) {
    const url = match[3];
    if (/^(https?:)?\/\//.test(url) || url.startsWith('data:') || url.startsWith('#')) continue;
    const ext = extname(url.split('?')[0]).toLowerCase();
    if (['.js', '.mjs', '.css'].includes(ext)) out.push(url.split('?')[0]);
  }
  return out;
}

function resolveSpecifier(spec, fromFile) {
  const target = spec.startsWith('/')
    ? join(root, spec)
    : resolve(resolve(fromFile, '..'), spec);
  return target.startsWith(root + sep) ? target : null;
}

/* --- wersjonowanie (hash przechodni: plik + jego importy) --- */

const NO_HASH = new Set(); // zabezpieczenie przed cyklami importów

async function fileHash(filePath) {
  if (!filePath) return '';
  const data = await readFile(filePath).catch(() => null);
  if (!data) return '';

  const ext = extname(filePath).toLowerCase();
  const textual = ['.js', '.mjs', '.html'].includes(ext);
  const hash = createHash('sha1').update(data);

  if (textual && !NO_HASH.has(filePath)) {
    NO_HASH.add(filePath);
    try {
      const source = data.toString('utf8');
      const specs = ext === '.html' ? htmlSpecifiers(source) : jsSpecifiers(source);
      for (const spec of specs) {
        hash.update(await fileHash(resolveSpecifier(spec, filePath)));
      }
    } finally {
      NO_HASH.delete(filePath);
    }
  }

  return hash.digest('hex').slice(0, 10);
}

function withVersion(url, version) {
  if (!version) return url;
  return url.includes('?') ? `${url}&v=${version}` : `${url}?v=${version}`;
}

async function versionImports(source, fromFile) {
  const replacements = [];
  const marked = source.replace(IMPORT_RE, (match, head, quote, spec) => {
    if (!spec.startsWith('.') && !spec.startsWith('/')) return match;
    const placeholder = `\u0000${replacements.length}\u0000`;
    replacements.push({ placeholder, head, quote, spec });
    return placeholder;
  });
  if (!replacements.length) return source;

  for (const item of replacements) {
    item.version = await fileHash(resolveSpecifier(item.spec.split('?')[0], fromFile));
  }

  let out = marked;
  for (const item of replacements) {
    out = out.replace(item.placeholder, `${item.head}${item.quote}${withVersion(item.spec, item.version)}${item.quote}`);
  }
  return out;
}

async function versionHtml(source, fromFile) {
  const replacements = [];
  const marked = source.replace(HTML_REF_RE, (match, attr, quote, url) => {
    if (/^(https?:)?\/\//.test(url) || url.startsWith('data:') || url.startsWith('#')) return match;
    const ext = extname(url.split('?')[0]).toLowerCase();
    if (!['.js', '.mjs', '.css'].includes(ext)) return match;
    const placeholder = `\u0000${replacements.length}\u0000`;
    replacements.push({ placeholder, attr, quote, url });
    return placeholder;
  });
  if (!replacements.length) return source;

  for (const item of replacements) {
    item.version = await fileHash(resolveSpecifier(item.url.split('?')[0], fromFile));
  }

  let out = marked;
  for (const item of replacements) {
    out = out.replace(item.placeholder, `${item.attr}=${item.quote}${withVersion(item.url, item.version)}${item.quote}`);
  }
  return out.replace('</head>', `  <meta name="app-version" content="${appVersion}">\n</head>`);
}

/* --- serwer --- */

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === '/') pathname = '/index.html';
    const filePath = normalize(join(root, pathname));
    if (!filePath.startsWith(root)) {
      res.writeHead(403, { ...NO_CACHE }).end('Forbidden');
      return;
    }

    const ext = extname(filePath).toLowerCase();
    let data = await readFile(filePath);

    if (ext === '.js' || ext === '.mjs') {
      data = Buffer.from(await versionImports(data.toString('utf8'), filePath), 'utf8');
    } else if (ext === '.html') {
      data = Buffer.from(await versionHtml(data.toString('utf8'), filePath), 'utf8');
    }

    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': data.length,
      ...NO_CACHE
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...NO_CACHE }).end('Nie znaleziono');
  }
});

server.listen(port, () => {
  console.log(`Schemator działa na http://localhost:${port} (cache wyłączony, moduły wersjonowane)`);
});
