import {stripVTControlCharacters} from 'node:util';
import wrapAnsi from 'wrap-ansi';

/** External text must not emit terminal controls, hyperlinks, or clipboard escape sequences. */
export function clean(text: string): string {
  return stripVTControlCharacters(text).replace(/\r\n?/g, '\n').replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '');
}
export function lines(text: string, width: number): string[] {
  return wrapAnsi(clean(text).replace(/\t/g, '    '), Math.max(1, width), {hard: true, trim: false}).split('\n');
}
