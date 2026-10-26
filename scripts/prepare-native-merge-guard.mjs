/** Apply a small, checked overlay to the official 1.21.7 merge implementation.
 * Usage: node scripts/prepare-native-merge-guard.mjs upstream.js output.js
 */
import fs from 'node:fs';import vm from 'node:vm';
const [input,output]=process.argv.slice(2);if(!input || !output)throw new Error('Input and output paths required');
let source=fs.readFileSync(input,'utf8').replace(/\r\n/g,'\n');
function replaceOnce(before,after){const n=source.split(before).length-1;if(n!==1)throw new Error('Upstream signature changed: expected one match, got '+n);source=source.replace(before,after);}
source="import { strictNativeMergeMatch, strictMergeEpisodeAllowed, strictMergeEpisodePairAllowed, strictNativePools } from '../aggregation/strict-source-match.js';\n"+source;
replaceOnce('export function findSecondaryMatches(primaryAnime, secondaryList, collectionAnimeIds = new Set(), baseSecondaries = []) {',`export function findSecondaryMatches(primaryAnime, secondaryList, collectionAnimeIds = new Set(), baseSecondaries = []) {
    secondaryList = (secondaryList || []).filter(candidate => !collectionAnimeIds.has(primaryAnime.animeId) && !collectionAnimeIds.has(candidate.animeId) && strictNativeMergeMatch(primaryAnime, candidate));`);
replaceOnce('return links.map((link, index) => ({ link, originalIndex: index }));','return links.map((link, index) => ({ link, originalIndex: index })).filter(item => strictMergeEpisodeAllowed(item.link));');
replaceOnce('if (filterRegex.test(title)) {','if (!strictMergeEpisodeAllowed(link) || filterRegex.test(title)) {');
const call='const { url: newMergedUrl, title: newMergedTitle } = mergeLinkEntry(targetLink, sourceLink, secSource, currentPrimarySource);';
const count=source.split(call).length-1;if(count!==2)throw new Error('Upstream episode merge call sites changed: '+count);
source=source.split(call).join('if (!strictMergeEpisodePairAllowed(targetLink, sourceLink, pAnime)) continue;\n                        '+call);
replaceOnce('stitchUnmatchedEpisodes(derivedAnime, orphanedEpisodes, secSource);','// Strict mode: unmatched source episodes stay separate; never infer an insertion index.');
replaceOnce('export async function applyMergeLogic(curAnimes, detailStore = null) {',`export async function applyMergeLogic(curAnimes, detailStore = null) {
    if (Array.isArray(curAnimes) && !(globals.customMergeRules || []).length) {
        const dynamic = strictNativePools(curAnimes, globals.mergeSourcePairs || [],
            anime => globals.animes.find(a => String(a.animeId) === String(anime.animeId) && a.source === anime.source) || anime,
            members => generateSafeMergedId(members[0].animeId, members.slice(1).map(a => a.animeId).join('|'), 'strict-episode-union-v1'));
        log('info', '[merge][strict-episode-union] pools: ' + dynamic.pools.length + '; episodes: ' + dynamic.pools.reduce((n, a) => n + a.links.length, 0));
        for (const anime of dynamic.pools) addAnime(anime, detailStore);
        curAnimes.splice(0, curAnimes.length, ...dynamic.pools, ...dynamic.remaining);
        return;
    }`);
// Parse all code without resolving imports, catching accidental malformed edits.
new vm.Script(source.replace(/^import .*;$/gm,'').replace(/^export /gm,''));
fs.writeFileSync(output,source);console.log('Strict native merge overlay prepared; dynamic per-episode pools enabled; custom-rule path guarded');
