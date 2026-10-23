import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../Utils.js', import.meta.url), 'utf8');
const start = source.indexOf('  getTrackArtwork(track) {');
export const artworkUtils = vm.runInNewContext(`({ isLocalTrackUri: uri => uri?.startsWith('spotify:local:'), ${source.slice(start, source.indexOf('\n  /**', start))} })`);
