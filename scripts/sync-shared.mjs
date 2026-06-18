// Copies the canonical files in /shared into both packages so each can be
// built and deployed independently. Run from the repo root: `npm run sync:shared`.
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url)) + '/..';
const src = join(root, 'shared');
const targets = [join(root, 'frontend/src/shared'), join(root, 'backend/src/shared')];

const files = readdirSync(src).filter((f) => f.endsWith('.ts'));
for (const target of targets) {
  mkdirSync(target, { recursive: true });
  for (const f of files) {
    copyFileSync(join(src, f), join(target, f));
    console.log(`synced ${f} -> ${target}`);
  }
}
console.log('shared sync complete.');
