// CI: abre ?test=1 num Chrome/Chromium headless (puppeteer-core, sem download de
// browser — usa o do runner) e falha o job se o selfTest não reportar N/N OK.
// Mesmo ambiente do teste manual — nada de emulação de DOM (jsdom quebraria).
// Env: CHROME_PATH (binário; default = Chrome do runner) · TEST_URL (default localhost:5179).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const URL = process.env.TEST_URL || 'http://localhost:5179/?test=1';
const CHROME = process.env.CHROME_PATH ||
  ['/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium'].find(p => fs.existsSync(p));
if (!CHROME) { console.error('Chrome não encontrado (defina CHROME_PATH).'); process.exit(1); }

// espera o http.server subir (o workflow inicia servidor e script em sequência imediata)
for (let i = 0; i < 30; i++) {
  try { await fetch(URL); break; }
  catch { if (i === 29) { console.error('servidor não subiu em', URL); process.exit(1); } await new Promise(r => setTimeout(r, 500)); }
}

// user-data-dir temporário: sem ele, Edge/Chrome no Windows falha o launch quando o
// perfil default está travado (browser aberto) — e no runner é inofensivo.
const browser = await puppeteer.launch({
  executablePath: CHROME,
  args: ['--no-sandbox', `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), 'yama-ci-'))}`],
}).catch((e) => { console.error('Falha ao lançar o browser:', e.message); process.exit(1); });
try {
  const page = await browser.newPage();
  let result = null;
  const falhas = [];
  page.on('console', (m) => {
    const t = m.text();
    if (t.includes('Yama selfTest:')) result = t;
    if (t.startsWith('FALHOU:')) falhas.push(t);   // console.warn por assert reprovado
  });
  page.on('pageerror', (e) => console.error('pageerror:', e.message));   // diagnóstico (o veredito é o selfTest)
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  for (let i = 0; i < 80 && !result; i++) await new Promise(r => setTimeout(r, 250));   // até 20s

  if (!result) { console.error('selfTest não reportou resultado no console (boot quebrado?).'); process.exit(1); }
  const clean = result.replace(/^%c/, '').replace(/font-weight:.*$/, '').trim();
  const m = clean.match(/Yama selfTest: (\d+)\/(\d+) OK/);
  if (!m || m[1] !== m[2] || /FALHARAM/.test(clean)) {
    console.error('❌', clean);
    falhas.forEach(f => console.error(' ', f));
    process.exit(1);
  }
  console.log('✅', clean);
} finally {
  await browser.close();
}
