#!/usr/bin/env python3
"""
通用随机验收：证明 movie/tv 流程对任意媒体正确，而非固定几部片子。

机制：
  1. 大池分层（国产/欧美/日韩/新老冷门；美/英/日/国产/动漫）
  2. 每层随机抽，合计电影≥10、电视剧≥10
  3. 排除历史上被用作「定点修复」的固定片（007/盗梦/星际）
  4. 每条验证：unionId → type 分流 → provider 链路 → 弹幕数
  5. 连续播放缓存串扰：电影A → 剧S01E01 → 剧S01E02 → 电影B

不写入任何业务规则；本文件仅为验收 harness。
"""
from __future__ import annotations

import json
import os
import random
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone

# 历史上定点验证过的片：从随机池排除，避免「针对性修好几部」假阳性
EXCLUDE_TMDB = {"36557", "27205", "157336"}  # 007 / 盗梦 / 星际

# 分层大池（验收采样源；非业务硬编码）
# 字段: title, tmdb_id, year, original_title?, category, region_hint?
MOVIE_POOL = [
    # 国产
    {"title": "让子弹飞", "tmdb_id": "43074", "year": "2010", "cat": "cn", "era": "old"},
    {"title": "流浪地球", "tmdb_id": "535167", "year": "2019", "cat": "cn", "era": "new"},
    {"title": "流浪地球2", "tmdb_id": "842675", "year": "2023", "cat": "cn", "era": "new"},
    {"title": "哪吒之魔童降世", "tmdb_id": "612647", "year": "2019", "cat": "cn", "era": "new"},
    {"title": "你好李焕英", "tmdb_id": "661991", "year": "2021", "cat": "cn", "era": "new"},
    {"title": "霸王别姬", "tmdb_id": "12493", "year": "1993", "cat": "cn", "era": "old"},
    {"title": "无间道", "tmdb_id": "10757", "year": "2002", "cat": "cn", "era": "old"},
    {"title": "功夫", "tmdb_id": "9470", "year": "2004", "cat": "cn", "era": "old"},
    {"title": "红海行动", "tmdb_id": "504608", "year": "2018", "cat": "cn", "era": "new"},
    {"title": "长津湖", "tmdb_id": "682507", "year": "2021", "cat": "cn", "era": "new"},
    {"title": "满江红", "tmdb_id": "966220", "year": "2023", "cat": "cn", "era": "new"},
    {"title": "封神第一部", "tmdb_id": "575264", "year": "2023", "cat": "cn", "era": "new"},
    {"title": "大话西游之月光宝盒", "tmdb_id": "10494", "year": "1995", "cat": "cn", "era": "old"},
    {"title": "夏洛特烦恼", "tmdb_id": "360814", "year": "2015", "cat": "cn", "era": "mid"},
    # 欧美
    {"title": "泰坦尼克号", "tmdb_id": "597", "year": "1997", "original_title": "Titanic", "cat": "west", "era": "old"},
    {"title": "阿凡达", "tmdb_id": "19995", "year": "2009", "original_title": "Avatar", "cat": "west", "era": "mid"},
    {"title": "复仇者联盟", "tmdb_id": "24428", "year": "2012", "original_title": "The Avengers", "cat": "west", "era": "mid"},
    {"title": "黑暗骑士", "tmdb_id": "155", "year": "2008", "original_title": "The Dark Knight", "cat": "west", "era": "mid"},
    {"title": "教父", "tmdb_id": "238", "year": "1972", "original_title": "The Godfather", "cat": "west", "era": "old"},
    {"title": "肖申克的救赎", "tmdb_id": "278", "year": "1994", "original_title": "The Shawshank Redemption", "cat": "west", "era": "old"},
    {"title": "指环王：护戒使者", "tmdb_id": "120", "year": "2001", "original_title": "The Lord of the Rings: The Fellowship of the Ring", "cat": "west", "era": "old"},
    {"title": "疯狂麦克斯：狂暴之路", "tmdb_id": "76341", "year": "2015", "original_title": "Mad Max: Fury Road", "cat": "west", "era": "mid"},
    {"title": "敦刻尔克", "tmdb_id": "374720", "year": "2017", "original_title": "Dunkirk", "cat": "west", "era": "new"},
    {"title": "奥本海默", "tmdb_id": "872585", "year": "2023", "original_title": "Oppenheimer", "cat": "west", "era": "new"},
    {"title": "芭比", "tmdb_id": "346698", "year": "2023", "original_title": "Barbie", "cat": "west", "era": "new"},
    {"title": "沙丘", "tmdb_id": "438631", "year": "2021", "original_title": "Dune", "cat": "west", "era": "new"},
    {"title": "搏击俱乐部", "tmdb_id": "550", "year": "1999", "original_title": "Fight Club", "cat": "west", "era": "old"},
    {"title": "低俗小说", "tmdb_id": "680", "year": "1994", "original_title": "Pulp Fiction", "cat": "west", "era": "old"},
    # 日韩
    {"title": "千与千寻", "tmdb_id": "129", "year": "2001", "original_title": "Sen to Chihiro no Kamikakushi", "cat": "jk", "era": "old"},
    {"title": "你的名字", "tmdb_id": "372058", "year": "2016", "original_title": "Kimi no Na wa.", "cat": "jk", "era": "mid"},
    {"title": "寄生虫", "tmdb_id": "496243", "year": "2019", "original_title": "Gisaengchung", "cat": "jk", "era": "new"},
    {"title": "釜山行", "tmdb_id": "396535", "year": "2016", "original_title": "Busanhaeng", "cat": "jk", "era": "mid"},
    {"title": "自杀专卖店", "tmdb_id": "290098", "year": "2016", "original_title": "Jisatsutou", "cat": "jk", "era": "mid"},
    {"title": "情书", "tmdb_id": "10404", "year": "1995", "original_title": "Love Letter", "cat": "jk", "era": "old"},
    {"title": "天气之子", "tmdb_id": "568160", "year": "2019", "original_title": "Tenki no Ko", "cat": "jk", "era": "new"},
    {"title": "铃芽之旅", "tmdb_id": "916224", "year": "2022", "original_title": "Suzume no Tojimari", "cat": "jk", "era": "new"},
    {"title": "杀人回忆", "tmdb_id": "455", "year": "2003", "original_title": "Salinui chueok", "cat": "jk", "era": "old"},
    {"title": "燃烧", "tmdb_id": "491584", "year": "2018", "original_title": "Beoning", "cat": "jk", "era": "new"},
    # 相对冷门/小众一些
    {"title": "过春天", "tmdb_id": "554600", "year": "2019", "cat": "niche", "era": "new"},
    {"title": "大象席地而坐", "tmdb_id": "505954", "year": "2018", "cat": "niche", "era": "new"},
    {"title": "一次别离", "tmdb_id": "72976", "year": "2011", "original_title": "Jodaeiye Nader az Simin", "cat": "niche", "era": "mid"},
    {"title": "海上钢琴师", "tmdb_id": "11036", "year": "1998", "original_title": "La leggenda del pianista sull'oceano", "cat": "niche", "era": "old"},
    {"title": "一一", "tmdb_id": "25538", "year": "2000", "cat": "niche", "era": "old"},
]

TV_POOL = [
    # 美剧
    {"title": "绝命毒师", "tmdb_id": "1396", "year": "2008", "cat": "us", "seasons": {1: 7, 2: 13, 5: 16}},
    {"title": "权力的游戏", "tmdb_id": "1399", "year": "2011", "cat": "us", "seasons": {1: 10, 8: 6}},
    {"title": "怪奇物语", "tmdb_id": "66732", "year": "2016", "cat": "us", "seasons": {1: 8, 4: 9}},
    {"title": "生活大爆炸", "tmdb_id": "1418", "year": "2007", "cat": "us", "seasons": {1: 17, 3: 23}},
    {"title": "老友记", "tmdb_id": "1668", "year": "1994", "cat": "us", "seasons": {1: 24, 5: 24}},
    {"title": "西部世界", "tmdb_id": "63247", "year": "2016", "cat": "us", "seasons": {1: 10}},
    {"title": "曼达洛人", "tmdb_id": "82856", "year": "2019", "cat": "us", "seasons": {1: 8, 2: 8}},
    {"title": "黑镜", "tmdb_id": "42009", "year": "2011", "cat": "us", "seasons": {1: 3, 3: 6}},
    # 英剧
    {"title": "神探夏洛克", "tmdb_id": "19885", "year": "2010", "cat": "uk", "seasons": {1: 3, 3: 3}},
    {"title": "唐顿庄园", "tmdb_id": "1413", "year": "2010", "cat": "uk", "seasons": {1: 7}},
    {"title": "王冠", "tmdb_id": "65494", "year": "2016", "cat": "uk", "seasons": {1: 10, 2: 10}},
    {"title": "神秘博士", "tmdb_id": "57243", "year": "2005", "cat": "uk", "seasons": {1: 13}},
    {"title": "黑袍纠察队", "tmdb_id": "76479", "year": "2019", "cat": "us", "seasons": {1: 8, 2: 8}},
    # 日剧
    {"title": "半泽直树", "tmdb_id": "61634", "year": "2013", "cat": "jp", "seasons": {1: 10}},
    {"title": "非自然死亡", "tmdb_id": "71446", "year": "2018", "cat": "jp", "seasons": {1: 10}},
    {"title": "法律之上", "tmdb_id": "203834", "year": "2023", "cat": "jp", "seasons": {1: 10}},
    {"title": "逃避虽可耻但有用", "tmdb_id": "70842", "year": "2016", "cat": "jp", "seasons": {1: 11}},
    # 国产剧
    {"title": "狂飙", "tmdb_id": "203119", "year": "2023", "cat": "cn", "seasons": {1: 39}},
    {"title": "人世间", "tmdb_id": "154300", "year": "2022", "cat": "cn", "seasons": {1: 58}},
    {"title": "三体", "tmdb_id": "87739", "year": "2023", "cat": "cn", "seasons": {1: 30}},
    {"title": "庆余年", "tmdb_id": "93794", "year": "2019", "cat": "cn", "seasons": {1: 46}},
    {"title": "琅琊榜", "tmdb_id": "63174", "year": "2015", "cat": "cn", "seasons": {1: 54}},
    {"title": "觉醒年代", "tmdb_id": "124910", "year": "2021", "cat": "cn", "seasons": {1: 43}},
    {"title": "隐秘的角落", "tmdb_id": "103322", "year": "2020", "cat": "cn", "seasons": {1: 12}},
    {"title": "漫长的季节", "tmdb_id": "209166", "year": "2023", "cat": "cn", "seasons": {1: 12}},
    # 动漫
    {"title": "鬼灭之刃", "tmdb_id": "85937", "year": "2019", "cat": "anime", "seasons": {1: 26}},
    {"title": "进击的巨人", "tmdb_id": "1429", "year": "2013", "cat": "anime", "seasons": {1: 25, 3: 22}},
    {"title": "咒术回战", "tmdb_id": "95479", "year": "2020", "cat": "anime", "seasons": {1: 24}},
    {"title": "间谍过家家", "tmdb_id": "120089", "year": "2022", "cat": "anime", "seasons": {1: 12}},
    {"title": "海贼王", "tmdb_id": "37854", "year": "1999", "cat": "anime", "seasons": {1: 20}},
    {"title": "火影忍者", "tmdb_id": "46260", "year": "2002", "cat": "anime", "seasons": {1: 20}},
    {"title": "钢之炼金术师FA", "tmdb_id": "31911", "year": "2009", "cat": "anime", "seasons": {1: 24}},
    {"title": "辉夜大小姐想让我告白", "tmdb_id": "86831", "year": "2019", "cat": "anime", "seasons": {1: 12}},
]

def load_token() -> str:
    for p in ("/opt/danmu_api/.env", "/opt/danmu_api/config/.env", "config/.env", ".env"):
        if not os.path.isfile(p):
            continue
        with open(p, encoding="utf-8", errors="ignore") as f:
            for line in f:
                if line.startswith("TOKEN="):
                    return line.split("=", 1)[1].strip().strip("\"'")
    return os.environ.get("TOKEN", "")


def parse_union_id(union_id: str):
    """镜像模块规则：{tmdb}_{type}_{season}_{episode}"""
    m = re.match(r"^(?:tmdb_)?(\d+)_(movie|tv|episode|show|series)_(\d+)_(\d+)$", union_id, re.I)
    if not m:
        return None
    typ = m.group(2).lower()
    is_movie = typ == "movie"
    s, e = int(m.group(3)), int(m.group(4))
    return {
        "tmdb_id": m.group(1),
        "type": "movie" if is_movie else "tv",
        "is_movie": is_movie,
        "season": None if is_movie else (s if s > 0 else None),
        "episode": None if is_movie else (e if e > 0 else None),
        "raw": union_id,
    }


def stratified_sample(pool, n, key="cat", seed=None):
    rng = random.Random(seed)
    pool = [x for x in pool if str(x.get("tmdb_id")) not in EXCLUDE_TMDB]
    by = defaultdict(list)
    for x in pool:
        by[x.get(key, "other")].append(x)
    # 每层至少 1（若有），再补满 n
    picked = []
    cats = list(by.keys())
    rng.shuffle(cats)
    for c in cats:
        if len(picked) >= n:
            break
        item = rng.choice(by[c])
        picked.append(item)
        by[c] = [x for x in by[c] if x is not item]
    remain = [x for xs in by.values() for x in xs]
    rng.shuffle(remain)
    for x in remain:
        if len(picked) >= n:
            break
        if x not in picked:
            picked.append(x)
    return picked[:n]


def api_get(base: str, params: dict, timeout=150):
    url = base + "?" + urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
    t0 = time.time()
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            body = r.read().decode("utf-8", errors="replace")
        data = json.loads(body)
        return data, time.time() - t0, None, url
    except urllib.error.HTTPError as e:
        # 404 无弹幕仍可能带 media（通用链路结果）；按 body 解析，不记为硬失败
        try:
            body = e.read().decode("utf-8", errors="replace")
            data = json.loads(body) if body else None
        except Exception:
            data = None
        if e.code == 404 and isinstance(data, dict):
            return data, time.time() - t0, None, url
        return data, time.time() - t0, f"http:{e.code}:{e.reason}", url
    except Exception as e:
        return None, time.time() - t0, str(e), url


def check_movie(item, base, force=False):
    tmdb = str(item["tmdb_id"])
    union = f"{tmdb}_movie_0_0"
    parsed = parse_union_id(union)
    params = {
        "title": item["title"],
        "tmdb_id": tmdb,
        "year": item.get("year") or "",
        "type": "movie",
        "debug": "1",
    }
    if item.get("original_title"):
        params["original_title"] = item["original_title"]
    if force:
        params["force"] = "1"

    chain = {
        "input": {
            "title": item["title"],
            "tmdb_id": tmdb,
            "year": item.get("year"),
            "type": "movie",
            "unionId": union,
            "category": item.get("cat"),
        },
        "unionId_parse": parsed,
        "provider": None,
        "match": None,
        "count": 0,
        "ok": False,
        "errors": [],
        "ms": 0,
        "key": None,
        "display": None,
        "sources": [],
    }

    # 1) unionId
    if not parsed or not parsed["is_movie"] or parsed["tmdb_id"] != tmdb:
        chain["errors"].append("unionId_parse_fail")
        return chain
    if parsed["season"] is not None or parsed["episode"] is not None:
        chain["errors"].append("movie_union_has_se")

    # 2) API
    data, ms, err, url = api_get(base, params)
    chain["ms"] = round(ms, 2)
    chain["request_url_has_type_movie"] = "type=movie" in url or "type%3Dmovie" in url
    if err:
        chain["errors"].append(f"http:{err}")
        return chain

    media = (data or {}).get("media") or {}
    meta = (data or {}).get("meta") or {}
    count = int((data or {}).get("count") or 0)
    sources = meta.get("sources") or meta.get("sources_detail") or []
    if not isinstance(sources, list):
        sources = []

    chain["count"] = count
    chain["key"] = meta.get("key")
    chain["display"] = media.get("display")
    chain["provider"] = {
        "source_count": len(sources),
        "sources": [
            {
                "source": s.get("source") or s.get("provider"),
                "file_name": s.get("file_name") or s.get("fileName"),
                "count_raw": s.get("count_raw"),
                "match_reason": s.get("match_reason"),
            }
            for s in sources[:8]
        ],
    }
    chain["match"] = {
        "display": media.get("display"),
        "type_field": media.get("type"),
        "season": media.get("season"),
        "episode": media.get("episode"),
        "cache_key": meta.get("key"),
    }

    # 3) type isolation：电影返回不得带有效季集
    def _pos_int(v):
        try:
            n = int(v)
            return n if n > 0 else None
        except Exception:
            return None

    if _pos_int(media.get("season")) or _pos_int(media.get("episode")):
        chain["errors"].append(
            f"movie_entered_tv_se s={media.get('season')} e={media.get('episode')}"
        )

    disp = str(media.get("display") or "")
    if re.search(r"S\d{1,2}E\d{1,2}", disp, re.I):
        chain["errors"].append(f"movie_display_has_se:{disp}")

    key = str(meta.get("key") or "")
    if key and ":movie" not in key and not key.endswith("movie"):
        # 允许 tmdb:ID:movie
        if not re.search(r":movie$|_movie$", key):
            chain["errors"].append(f"movie_cache_key_wrong:{key}")

    for s in sources:
        fn = str(s.get("file_name") or s.get("fileName") or "")
        if re.search(r"S\d{1,2}E\d{1,2}", fn, re.I):
            chain["errors"].append(f"movie_source_file_has_se:{fn}")
            break

    # 4) 链路可观测：即使 0 弹幕也应有 media（修复后）
    if not media and count == 0:
        chain["errors"].append("empty_pipeline_no_media")

    # 成功标准：类型正确 + 无 SE 污染 + 请求成功
    # 弹幕>0 记为 danmaku_ok；=0 不单独否决 type pipeline
    type_ok = not any(
        e.startswith("movie_entered")
        or e.startswith("movie_display")
        or e.startswith("movie_source")
        or e.startswith("movie_cache")
        or e.startswith("unionId")
        for e in chain["errors"]
    )
    chain["type_ok"] = type_ok
    chain["danmaku_ok"] = count > 0
    chain["pipeline_ok"] = chain["type_ok"] and not any(str(x).startswith("http:") for x in chain["errors"])
    chain["ok"] = chain["pipeline_ok"]  # 通用流程正确 ≠ 一定有弹幕
    return chain


def check_tv(item, base, season=None, episode=None, force=False):
    tmdb = str(item["tmdb_id"])
    seasons = item.get("seasons") or {1: 6}
    if season is None or episode is None:
        s = random.choice(list(seasons.keys()))
        ep_max = int(seasons[s])
        e = random.randint(1, max(1, min(ep_max, 12)))
    else:
        s, e = int(season), int(episode)

    union = f"{tmdb}_tv_{s}_{e}"
    parsed = parse_union_id(union)
    params = {
        "title": item["title"],
        "tmdb_id": tmdb,
        "year": item.get("year") or "",
        "type": "tv",
        "season": str(s),
        "episode": str(e),
        "debug": "1",
    }
    if force:
        params["force"] = "1"

    chain = {
        "input": {
            "title": item["title"],
            "tmdb_id": tmdb,
            "year": item.get("year"),
            "type": "tv",
            "season": s,
            "episode": e,
            "unionId": union,
            "category": item.get("cat"),
        },
        "unionId_parse": parsed,
        "provider": None,
        "match": None,
        "count": 0,
        "ok": False,
        "errors": [],
        "ms": 0,
        "key": None,
        "display": None,
        "sources": [],
    }

    if not parsed or parsed["is_movie"] or parsed["tmdb_id"] != tmdb:
        chain["errors"].append("unionId_parse_fail")
        return chain
    if parsed["season"] != s or parsed["episode"] != e:
        chain["errors"].append(f"unionId_se_mismatch want={s}x{e} got={parsed}")

    data, ms, err, url = api_get(base, params)
    chain["ms"] = round(ms, 2)
    if err:
        chain["errors"].append(f"http:{err}")
        return chain

    media = (data or {}).get("media") or {}
    meta = (data or {}).get("meta") or {}
    count = int((data or {}).get("count") or 0)
    sources = meta.get("sources") or meta.get("sources_detail") or []
    if not isinstance(sources, list):
        sources = []

    chain["count"] = count
    chain["key"] = meta.get("key")
    chain["display"] = media.get("display")
    chain["provider"] = {
        "source_count": len(sources),
        "sources": [
            {
                "source": s0.get("source") or s0.get("provider"),
                "file_name": s0.get("file_name") or s0.get("fileName"),
                "count_raw": s0.get("count_raw"),
                "match_reason": s0.get("match_reason"),
            }
            for s0 in sources[:8]
        ],
    }
    chain["match"] = {
        "display": media.get("display"),
        "season": media.get("season"),
        "episode": media.get("episode"),
        "cache_key": meta.get("key"),
        "selected_version": (data or {}).get("selected_version"),
    }

    # TV 不得进 movie 键
    key = str(meta.get("key") or "")
    if key.endswith(":movie") or key.endswith("_movie"):
        chain["errors"].append(f"tv_entered_movie_key:{key}")

    # 集数一致性：若返回 episode，必须等于输入
    ret_ep = media.get("episode")
    ret_s = media.get("season")
    if ret_ep is not None and str(ret_ep) not in ("", "None"):
        try:
            if int(ret_ep) != e:
                chain["errors"].append(f"episode_mismatch input={e} got={ret_ep}")
        except Exception:
            pass
    if ret_s is not None and str(ret_s) not in ("", "None"):
        try:
            if int(ret_s) != s:
                chain["errors"].append(f"season_mismatch input={s} got={ret_s}")
        except Exception:
            pass

    # display 不应是纯电影形态且无 SE 当有匹配时最好有 SE；不强求有弹幕
    if not media and count == 0:
        chain["errors"].append("empty_pipeline_no_media")

    chain["type_ok"] = not any(
        e0.startswith("tv_entered")
        or e0.startswith("episode_mismatch")
        or e0.startswith("season_mismatch")
        or e0.startswith("unionId")
        for e0 in chain["errors"]
    )
    chain["danmaku_ok"] = count > 0
    chain["pipeline_ok"] = chain["type_ok"] and not any(str(x).startswith("http:") for x in chain["errors"])
    chain["ok"] = chain["pipeline_ok"]
    return chain


def cache_sequence_test(base, movie_a, movie_b, tv_item):
    """电影A → 剧 S01E01 → 剧 S01E02 → 电影B"""
    results = []
    # pick S1E1 E2 if available
    seasons = tv_item.get("seasons") or {1: 6}
    s = 1 if 1 in seasons else list(seasons.keys())[0]
    # force 仅用于确保串扰测试走完整链路；随机主测默认走缓存以控制时长
    r1 = check_movie(movie_a, base, force=False)
    results.append(("movieA", r1))
    r2 = check_tv(tv_item, base, season=s, episode=1, force=False)
    results.append(("tv_s1e1", r2))
    r3 = check_tv(tv_item, base, season=s, episode=2, force=False)
    results.append(("tv_s1e2", r3))
    r4 = check_movie(movie_b, base, force=False)
    results.append(("movieB", r4))

    errors = []
    # 不串类型：movie/tv 缓存键必须不同
    if r1.get("key") and r2.get("key") and r1["key"] == r2["key"]:
        errors.append("movieA_tv_same_cache_key")
    if r4.get("key") and r2.get("key") and r4["key"] == r2["key"]:
        errors.append("movieB_tv_same_cache_key")
    # 不串电影：两部不同电影 key 不同
    if (
        r1.get("key")
        and r4.get("key")
        and str(movie_a["tmdb_id"]) != str(movie_b["tmdb_id"])
        and r1["key"] == r4["key"]
    ):
        errors.append("movieA_movieB_same_key")
    # 不串集：E1/E2 的 key 或 episode 字段必须区分
    if r2.get("key") and r3.get("key") and r2["key"] == r3["key"]:
        errors.append("e1_e2_same_cache_key")
    ep2 = (r2.get("match") or {}).get("episode")
    ep3 = (r3.get("match") or {}).get("episode")
    if ep2 is not None and ep3 is not None and str(ep2) == str(ep3) and str(ep2) not in ("", "None"):
        if int(r2["input"]["episode"]) != int(r3["input"]["episode"]):
            errors.append(f"episode_fields_collided e={ep2}")

    for name, r in results:
        if r.get("type_ok") is False:
            errors.append(f"{name}_type_fail:{r.get('errors')}")

    return {
        "steps": [
            {
                "step": name,
                "title": r["input"]["title"],
                "type": r["input"]["type"],
                "se": (
                    f"S{r['input'].get('season')}E{r['input'].get('episode')}"
                    if r["input"]["type"] == "tv"
                    else None
                ),
                "count": r.get("count"),
                "key": r.get("key"),
                "display": r.get("display"),
                "type_ok": r.get("type_ok"),
                "errors": r.get("errors"),
            }
            for name, r in results
        ],
        "errors": errors,
        "ok": len(errors) == 0,
    }


def main():
    seed = int(os.environ.get("ACCEPT_SEED") or (time.time() * 1000) % 10_000_000)
    random.seed(seed)
    n_movie = int(os.environ.get("N_MOVIE", "12"))
    n_tv = int(os.environ.get("N_TV", "12"))
    token = load_token()
    if not token:
        print("NO TOKEN", file=sys.stderr)
        sys.exit(2)
    host = os.environ.get("API_HOST", "http://127.0.0.1:9321")
    base = f"{host.rstrip('/')}/{token}/api/forward/danmaku"

    movies = stratified_sample(MOVIE_POOL, n_movie, key="cat", seed=seed)
    tvs = stratified_sample(TV_POOL, n_tv, key="cat", seed=seed + 1)
    use_force = os.environ.get("FORCE", "0") in ("1", "true", "yes")

    print("=" * 72)
    print("RANDOM ACCEPTANCE TEST")
    print(f"seed={seed} n_movie={len(movies)} n_tv={len(tvs)} force={use_force}")
    print(f"excluded_fixed={sorted(EXCLUDE_TMDB)}")
    print(f"started={datetime.now(timezone.utc).isoformat()}")
    print("=" * 72)

    movie_results = []
    for i, m in enumerate(movies, 1):
        print(f"\n[MOVIE {i}/{len(movies)}] {m['title']} tmdb={m['tmdb_id']} cat={m.get('cat')}", flush=True)
        r = check_movie(m, base, force=use_force)
        movie_results.append(r)
        status = "PASS" if r["ok"] else "FAIL"
        print(f"  unionId={r['input']['unionId']} parse={r['unionId_parse']}")
        print(f"  display={r.get('display')} key={r.get('key')} count={r.get('count')} ms={r.get('ms')}")
        print(f"  sources={r.get('provider')}")
        print(f"  errors={r.get('errors')} => {status}")

    tv_results = []
    for i, t in enumerate(tvs, 1):
        print(f"\n[TV {i}/{len(tvs)}] {t['title']} tmdb={t['tmdb_id']} cat={t.get('cat')}", flush=True)
        r = check_tv(t, base, force=use_force)
        tv_results.append(r)
        status = "PASS" if r["ok"] else "FAIL"
        print(f"  unionId={r['input']['unionId']} parse={r['unionId_parse']}")
        print(f"  SE=S{r['input']['season']:02d}E{r['input']['episode']:02d}")
        print(f"  display={r.get('display')} key={r.get('key')} count={r.get('count')} ms={r.get('ms')}")
        print(f"  match={r.get('match')}")
        print(f"  sources={r.get('provider')}")
        print(f"  errors={r.get('errors')} => {status}")

    # 连续缓存串扰
    print("\n[CACHE SEQUENCE]")
    seq_movies = stratified_sample(MOVIE_POOL, 4, key="cat", seed=seed + 99)
    seq_tvs = stratified_sample(TV_POOL, 2, key="cat", seed=seed + 100)
    seq = cache_sequence_test(base, seq_movies[0], seq_movies[1], seq_tvs[0])
    print(json.dumps(seq, ensure_ascii=False, indent=2))

    # 汇总
    def summarize(rows, kind):
        total = len(rows)
        type_ok = sum(1 for r in rows if r.get("type_ok"))
        pipe_ok = sum(1 for r in rows if r.get("pipeline_ok"))
        danmu_ok = sum(1 for r in rows if r.get("danmaku_ok"))
        fails = [r for r in rows if not r.get("ok")]
        return {
            "kind": kind,
            "total": total,
            "type_ok": type_ok,
            "pipeline_ok": pipe_ok,
            "danmaku_gt0": danmu_ok,
            "fail_count": len(fails),
        }

    sm = summarize(movie_results, "movie")
    st = summarize(tv_results, "tv")

    report = {
        "seed": seed,
        "excluded_fixed_tmdb": sorted(EXCLUDE_TMDB),
        "movie_summary": sm,
        "tv_summary": st,
        "cache_sequence": seq,
        "movies": [
            {
                "name": r["input"]["title"],
                "tmdb_id": r["input"]["tmdb_id"],
                "type": "movie",
                "category": r["input"].get("category"),
                "unionId": r["input"]["unionId"],
                "input": r["input"],
                "match": r.get("match"),
                "count": r.get("count"),
                "key": r.get("key"),
                "type_ok": r.get("type_ok"),
                "danmaku_ok": r.get("danmaku_ok"),
                "pipeline_ok": r.get("pipeline_ok"),
                "errors": r.get("errors"),
                "sources": (r.get("provider") or {}).get("sources"),
            }
            for r in movie_results
        ],
        "tvs": [
            {
                "name": r["input"]["title"],
                "tmdb_id": r["input"]["tmdb_id"],
                "type": "tv",
                "category": r["input"].get("category"),
                "unionId": r["input"]["unionId"],
                "season": r["input"]["season"],
                "episode": r["input"]["episode"],
                "input": r["input"],
                "match": r.get("match"),
                "count": r.get("count"),
                "key": r.get("key"),
                "type_ok": r.get("type_ok"),
                "danmaku_ok": r.get("danmaku_ok"),
                "pipeline_ok": r.get("pipeline_ok"),
                "errors": r.get("errors"),
                "sources": (r.get("provider") or {}).get("sources"),
            }
            for r in tv_results
        ],
        "failures": [],
    }

    for r in movie_results + tv_results:
        if not r.get("ok"):
            report["failures"].append(
                {
                    "name": r["input"]["title"],
                    "type": r["input"]["type"],
                    "tmdb_id": r["input"]["tmdb_id"],
                    "errors": r.get("errors"),
                    "match": r.get("match"),
                    "count": r.get("count"),
                }
            )
    if not seq.get("ok"):
        report["failures"].append({"name": "cache_sequence", "errors": seq.get("errors"), "steps": seq.get("steps")})

    out_path = os.environ.get("REPORT_PATH", f"/tmp/random_acceptance_{seed}.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    print("\n" + "=" * 72)
    print("SUMMARY")
    print(json.dumps({"movie": sm, "tv": st, "cache_sequence_ok": seq.get("ok"), "report": out_path}, ensure_ascii=False, indent=2))
    print("=" * 72)

    # 验收：类型隔离与流程必须 100%；弹幕命中率单独报告
    type_fail = sm["type_ok"] < sm["total"] or st["type_ok"] < st["total"]
    seq_fail = not seq.get("ok")
    if type_fail or seq_fail:
        print("ACCEPTANCE: FAIL (type isolation or cache sequence)")
        sys.exit(1)
    print("ACCEPTANCE: PASS (generic type/pipeline isolation)")
    print(
        f"NOTE: danmaku hit rate movie={sm['danmaku_gt0']}/{sm['total']} tv={st['danmaku_gt0']}/{st['total']} "
        "(cold titles may be 0 without failing type pipeline)"
    )
    sys.exit(0)


if __name__ == "__main__":
    main()
