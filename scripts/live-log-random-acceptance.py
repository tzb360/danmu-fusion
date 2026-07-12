#!/usr/bin/env python3
"""从真实 Forward 日志动态发现媒体并随机验收；脚本内不含片名/TMDB 样本。"""
import argparse, json, random, re, sys, time, urllib.error, urllib.parse, urllib.request

RECV = re.compile(r'\[ForwardAdapter\] recv type=(movie|tv) title="([^"]*)" tmdb=([^ ]+) year=([^ ]+) season=([^ ]+) episode=([^ ]+)')

def discover(text):
    rows, seen = [], set()
    for m in RECV.finditer(text):
        typ, title, tmdb, year, season, episode = m.groups()
        if not title or tmdb == '-': continue
        row = {'type': typ, 'title': title, 'tmdb_id': tmdb, 'year': None if year == '-' else year}
        if typ == 'tv':
            if not season.isdigit() or not episode.isdigit(): continue
            row.update(season=int(season), episode=int(episode))
        key = (typ, tmdb, row.get('season'), row.get('episode'))
        if key not in seen: seen.add(key); rows.append(row)
    return rows

def call(base, row, force=False):
    q = dict(row, debug='1')
    if force: q['force'] = '1'
    url = base + '?' + urllib.parse.urlencode({k:v for k,v in q.items() if v is not None})
    started = time.time()
    try:
        with urllib.request.urlopen(url, timeout=180) as r: body = r.read()
    except urllib.error.HTTPError as e:
        body = e.read()
        if e.code != 404: raise
    data = json.loads(body)
    meta, media = data.get('meta') or {}, data.get('media') or {}
    want_movie = row['type'] == 'movie'
    type_ok = media.get('season') is None and media.get('episode') is None if want_movie else (
        int(media.get('season') or -1) == row['season'] and int(media.get('episode') or -1) == row['episode'])
    sources = meta.get('sources_detail') or meta.get('sources') or []
    return {
        'input': row, 'unionId': f"{row['tmdb_id']}_{row['type']}_{row.get('season',0)}_{row.get('episode',0)}",
        'search_keywords': meta.get('search_keywords') or [row['title']],
        'provider_candidate_count': meta.get('anime_count'), 'source_count': meta.get('source_count', len(sources)),
        'matched': media, 'key': meta.get('key'), 'cached': meta.get('cached', False),
        'empty_cache_hit': meta.get('empty_cache_hit', False), 'before': (meta.get('stats') or {}).get('total_before', 0),
        'final': data.get('count', 0), 'type_episode_ok': type_ok,
        'classification': 'A_no_source' if not sources else ('A_provider_empty' if data.get('count',0) == 0 else 'OK'),
        'sources': [{k:s.get(k) for k in ('source','file_name','matched_title','count_raw','count_used','status','error')} for s in sources],
        'seconds': round(time.time()-started, 2)
    }

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--log', required=True); ap.add_argument('--base', required=True)
    ap.add_argument('--movies', type=int, default=10); ap.add_argument('--tv', type=int, default=10); ap.add_argument('--seed', type=int, default=int(time.time()))
    ap.add_argument('--out', required=True); args=ap.parse_args(); rng=random.Random(args.seed)
    rows=discover(open(args.log, encoding='utf-8', errors='ignore').read())
    movies=[x for x in rows if x['type']=='movie']; tv=[x for x in rows if x['type']=='tv' and x['episode']>1]
    if len(movies)<args.movies or len(tv)<args.tv:
        raise SystemExit(f'insufficient live samples movies={len(movies)} tv_nonfirst={len(tv)}')
    rng.shuffle(movies); rng.shuffle(tv); selected=movies[:args.movies]+tv[:args.tv]
    results=[]
    for i,row in enumerate(selected,1):
        print(f"[{i}/{len(selected)}] {row['type']} {row['title']} {row['tmdb_id']}", flush=True)
        try: results.append(call(args.base,row))
        except Exception as e: results.append({'input':row,'error':str(e),'type_episode_ok':False})
    # 状态切换：电影A → TV非首集 → 下一集 → 另一季/另一TV → 电影C
    a,c=movies[0],movies[1]; b=tv[0]
    adjacent=dict(b, episode=b['episode']+1)
    other=next((x for x in tv[1:] if x['tmdb_id']!=b['tmdb_id'] or x['season']!=b['season']), tv[1])
    sequence=[call(args.base,x) for x in (a,b,adjacent,other,c)]
    report={'seed':args.seed,'discovered':{'movie':len(movies),'tv_nonfirst':len(tv)},'results':results,'sequence':sequence,
            'ok':all(x.get('type_episode_ok') for x in results+sequence)}
    with open(args.out,'w',encoding='utf-8') as f: json.dump(report,f,ensure_ascii=False,indent=2)
    print(json.dumps({'out':args.out,'ok':report['ok'],'discovered':report['discovered']},ensure_ascii=False))
    sys.exit(0 if report['ok'] else 1)
if __name__=='__main__': main()
