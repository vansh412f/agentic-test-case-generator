import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const read = (name: string) => readFileSync(require.resolve(`prismjs/${name}`), 'utf8');

export const prismCss = read('themes/prism-tomorrow.css');
export const prismJs = [
  'components/prism-core.min.js',
  'components/prism-clike.min.js',
  'components/prism-javascript.min.js',
  'components/prism-typescript.min.js',
].map(read).join('\n').replace(/<\/script/gi, '<\\/script');
