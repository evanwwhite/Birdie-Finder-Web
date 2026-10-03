import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)),'..');
const out = resolve(process.argv[2] ?? resolve(root,'dist'));
if (out !== resolve(root,'dist') && !out.startsWith('/tmp/birdie-'))
  throw new Error('Output must be this repo\'s dist or a /tmp/birdie-* directory.');
const url = process.env.BIRDIE_PUBLIC_SUPABASE_URL ?? '';
const key = process.env.BIRDIE_PUBLIC_SUPABASE_ANON_KEY ?? '';
if ((url || key) && (!/^https?:\/\//.test(url) || !key)) throw new Error('Set both public Supabase URL and anon key.');
if (key.startsWith('sb_secret_')) throw new Error('A secret key cannot be put in a client build.');
if (key.split('.').length === 3) {
  const payload = JSON.parse(Buffer.from(key.split('.')[1],'base64url').toString('utf8'));
  if (payload.role !== 'anon') throw new Error('Only an anon JWT may be put in a client build.');
}
const allow = ['catalog-live.html','login.html','scorecard.html','players.html','import.html',
  'assets/styles.css','assets/solo.js','assets/legacy-import.js','assets/vendor/supabase.js'];
rmSync(out,{recursive:true,force:true}); mkdirSync(out,{recursive:true});
for (const path of allow) {
  const target = resolve(out,path);
  mkdirSync(dirname(target),{recursive:true}); cpSync(resolve(root,path),target);
}
cpSync(resolve(root,'catalog-live.html'),resolve(out,'index.html'));
writeFileSync(resolve(out,'assets/config.local.js'),
  `window.BIRDIE_SUPABASE_URL=${JSON.stringify(url)};\nwindow.BIRDIE_SUPABASE_ANON_KEY=${JSON.stringify(key)};\n`);
for (const disallowed of ['data/courses.csv','data/all_discs.csv','shop.html','events.html','course.html','disc.html','assets/app.js']) {
  if (existsSync(resolve(out,disallowed))) throw new Error(`Unsafe asset in public build: ${disallowed}`);
}
for (const path of allow.filter(x => x.endsWith('.html'))) {
  const html = readFileSync(resolve(out,path),'utf8');
  if (/\b(?:Riley K\.|Maya K|128 reviews|\$\d{2}\b)/.test(html)) throw new Error(`Unsupported claim in ${path}`);
}
console.log(`Public web build: ${out} (${allow.length + 2} allowlisted files; no legacy CSVs or demo pages)`);
