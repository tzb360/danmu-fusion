# Changelog

## 1.2.3 - 2026-07-13

- Propagate the server `trace_id`, `ProviderStats`, and `DanmuStats` snapshot through Forward parsing.
- Report parsed and final queue counts from the exact player queue, including normal/top/bottom classification.
- Clone module cache values at both boundaries so one request cannot mutate another request's cached object.
- Distinguish module status from queried, candidate, usable, failed, and empty provider counts.

## 1.2.2 - 2026-07-13

- unionId is the authoritative movie/tv and TV season/episode identity.
- Movies never emit synthetic `S01E01`; TV cache keys include season and episode.
- Forward API diagnostics distinguish no-source results from aggregation failures.
- Widget package version is aligned with the module runtime and is hosted at `/widgets/danmu-fusion/widget.fwd` on Node deployments.
