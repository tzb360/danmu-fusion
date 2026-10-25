#!/usr/bin/env python3
"""Sequential movie/TV cache-isolation stress test with a random media pool."""
import json, os, random, runpy, sys, time, urllib.error, urllib.parse, urllib.request

lib = runpy.run_path(os.path.join(os.path.dirname(__file__), 'random-acceptance-test.py'))
movies, tvs = lib['MOVIE_POOL'], lib['TV_POOL']
token = lib['load_token']()
total = int(os.environ.get('STRESS_TOTAL', '500'))
seed = int(os.environ.get('STRESS_SEED', str(int(time.time() * 1000) % 10_000_000)))
base = os.environ.get('STRESS_BASE', f"http://127.0.0.1:9321/{token}/api/forward/danmaku")
rng = random.Random(seed)

movie_sample = rng.sample(movies, min(8, len(movies)))
tv_sample = rng.sample(tvs, min(8, len(tvs)))
sequence = []
for i in range(total):
    # Required interleave: movie → movie → tv → next episode → cross-season/TV → movie → tv
    slot = i % 7
    if slot in (0, 1, 5):
        m = movie_sample[(i // 7 + slot) % len(movie_sample)]
        sequence.append({'type': 'movie', 'title': m['title'], 'tmdb_id': m['tmdb_id'], 'year': m.get('year')})
    else:
        t = tv_sample[(i // 7 + (1 if slot == 4 else 0)) % len(tv_sample)]
        season = rng.choice(list(t['seasons']))
        max_ep = t['seasons'][season]
        episode = min(max_ep, max(2, (i // 7) % max_ep + (2 if slot == 3 else 1)))
        sequence.append({'type': 'tv', 'title': t['title'], 'tmdb_id': t['tmdb_id'], 'year': t.get('year'), 'season': season, 'episode': episode})

failures, cache_hits, traces = [], 0, []
started = time.time()
for i, row in enumerate(sequence, 1):
    q = dict(row, debug='1')
    url = base + '?' + urllib.parse.urlencode(q)
    try:
        try:
            response = urllib.request.urlopen(url, timeout=180)
        except urllib.error.HTTPError as error:
            if error.code != 404: raise
            response = error
        data = json.loads(response.read())
        meta, media = data.get('meta') or {}, data.get('media') or {}
        ps, ds = meta.get('providerStats') or {}, meta.get('danmuStats') or {}
        count = int(data.get('count') or 0)
        positions = sum(int(ds.get(k) or 0) for k in ('normalCount', 'topCount', 'bottomCount'))
        type_ok = (media.get('season') is None and media.get('episode') is None) if row['type'] == 'movie' else (
            int(media.get('season') or -1) == row['season'] and int(media.get('episode') or -1) == row['episode'])
        stats_ok = count == int(ds.get('apiReturnedCount') or 0) == int(ds.get('forwardParsedCount') or 0) == int(ds.get('finalQueueCount') or 0) == positions
        provider_ok = 'moduleProviderCount' not in ps and ps.get('moduleStatus') in ('success', 'empty')
        trace_ok = bool(meta.get('trace_id')) and meta.get('trace_id') == (meta.get('traceContext') or {}).get('trace_id')
        if meta.get('cached'): cache_hits += 1
        traces.append(meta.get('trace_id'))
        if not (type_ok and stats_ok and provider_ok and trace_ok):
            failures.append({'index': i, 'input': row, 'type_ok': type_ok, 'stats_ok': stats_ok, 'provider_ok': provider_ok, 'trace_ok': trace_ok, 'count': count, 'providerStats': ps, 'danmuStats': ds})
            if len(failures) <= 3: print(json.dumps(failures[-1], ensure_ascii=False), flush=True)
    except Exception as error:
        failures.append({'index': i, 'input': row, 'error': str(error)})
        if len(failures) <= 3: print(json.dumps(failures[-1], ensure_ascii=False), flush=True)
    if i % 50 == 0: print(f'{i}/{total} failures={len(failures)}', flush=True)

report = {'seed': seed, 'total': total, 'cache_hits': cache_hits, 'unique_trace_ids': len(set(traces)), 'failures': failures, 'seconds': round(time.time() - started, 2), 'ok': not failures and len(set(traces)) == total}
out = os.environ.get('STRESS_REPORT', '/tmp/sequence_stress.json')
with open(out, 'w', encoding='utf-8') as file: json.dump(report, file, ensure_ascii=False, indent=2)
print(json.dumps({**report, 'failures': failures[:3], 'report': out}, ensure_ascii=False))
sys.exit(0 if report['ok'] else 1)
