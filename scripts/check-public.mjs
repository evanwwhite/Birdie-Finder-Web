import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, extname } from 'node:path';
const root = resolve(process.argv[2] ?? 'dist');
const pages = ['index.html','catalog-live.html','login.html','scorecard.html','players.html','import.html'];
for (const page of pages) assert(existsSync(resolve(root,page)),`Missing ${page}`);
for (const absent of ['data','shop.html','events.html','course.html','courses.html','disc.html','assets/app.js'])
  assert(!existsSync(resolve(root,absent)),`Unsafe public asset: ${absent}`);
for (const page of pages) {
  const html = readFileSync(resolve(root,page),'utf8');
  for (const [,body] of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) if (body.trim()) new Function(body);
  for (const [,href] of html.matchAll(/href="([^"]+)"/g)) {
    if (/^(https?:|#|mailto:)/.test(href)) continue;
    const path = href.split(/[?#]/)[0];
    assert(existsSync(resolve(root,path)),`${page} links to missing ${path}`);
  }
  assert(!/DiscIt|Overpass|128 reviews|Maya K|Riley K\.|\$\d{2}\b/.test(html),`${page} has demo content`);
}
for (const file of readdirSync(resolve(root,'assets'))) {
  if (extname(file)==='.js') new Function(readFileSync(resolve(root,'assets',file),'utf8'));
}
const config = readFileSync(resolve(root,'assets/config.local.js'),'utf8');
assert(!config.includes('sb_secret_') && !config.includes('service_role'));
console.log('Public web: allowed pages, local links, scripts, source exclusions, and secret gate PASS');
