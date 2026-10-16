import { createTwoFilesPatch } from 'diff';
import { escapeHtml } from './escape.ts';

export function generateDiffHtml(before: string, after: string, attempt: number): string {
  const patch = createTwoFilesPatch(`attempt-${attempt - 1}.ts`, `attempt-${attempt}.ts`, before, after);
  const lines = patch.split('\n').map((line) => {
    const background = line.startsWith('+') ? '#123c2b' : line.startsWith('-') ? '#4b2027' : 'transparent';
    return `<span style="display:block;background:${background}">${escapeHtml(line) || ' '}</span>`;
  }).join('');
  return `<pre class="diff">${lines}</pre>`;
}
