import { readFile, readdir, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, 'dist');
const maker = join(root, 'maker');
const assets = {};
const types = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.ttf':'font/ttf','.otf':'font/otf','.woff':'font/woff','.woff2':'font/woff2'};
async function collect(folder) {
  for (const entry of await readdir(folder, {withFileTypes:true})) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) { await collect(path); continue; }
    const extension = entry.name.slice(entry.name.lastIndexOf('.'));
    if (!types[extension]) continue;
    assets[relative(maker,path).split('\\').join('/')] = {type:types[extension],data:(await readFile(path)).toString('base64')};
  }
}
await collect(maker);
if(!assets['index.html'] || !assets['app.js']) throw new Error('The Intro Maker interface is missing.');
await rm(dist,{recursive:true,force:true});
await mkdir(join(dist,'server'),{recursive:true});
const reviewHTML=(await readFile(join(root,'review/index.html'),'utf8')).replace('<!--REVIEW_SCRIPT-->', '<script>'+await readFile(join(root,'review/gallery-playback.js'),'utf8')+'\n'+await readFile(join(root,'review/intro-jingles.js'),'utf8')+'\n'+await readFile(join(root,'review/app.js'),'utf8')+'</script>');
const jingleHTML=await readFile(join(root,'jingles/index.html'),'utf8');
await writeFile(join(dist,'server/index.js'), `const MAKER_ASSETS=${JSON.stringify(assets)};\nconst REVIEW_PAGE=${JSON.stringify(reviewHTML)};\nconst JINGLE_UPLOADER=${JSON.stringify(jingleHTML)};\n` + await readFile(join(root,'worker/jingles.js'),'utf8')+'\n'+await readFile(join(root,'worker/index.js'),'utf8'));
console.log(`Built Intro Maker and Intro Review (${Object.keys(assets).length} protected editor assets).`);
