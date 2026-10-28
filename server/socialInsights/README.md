# 社媒洞察报告

`POST /api/overseas/strategy/social-insight-reports` accepts exactly `{ keyword, requestId }` after the application keyword confirmation. `GET /api/overseas/strategy/social-insight-reports/:id` reads the tenant-owned job. The same tenant/requestId never starts another Actor, including after interruption or unknown submission. A new requestId is a new confirmed operation, not a retry.

Server configuration is closed by default:

- `SOCIAL_INSIGHTS_ENABLED=1`
- `SOCIAL_INSIGHTS_APIFY_ACTOR_ID=clockworks~tiktok-scraper`
- `SOCIAL_INSIGHTS_APIFY_MAX_USD`: approved per-run cap, greater than zero and at most 0.50 USD; sent to Apify `maxTotalChargeUsd` with `restartOnError=false`.
- `SOCIAL_INSIGHTS_APIFY_DATASET_MAX_USD`: separately approved maximum for the single bounded dataset read, greater than zero and at most 0.05 USD. This is a local authorization budget, not an Apify-enforced transfer-cost cap; operator must verify the current dataset tariff before enabling.
- `APIFY_TOKEN` or `APIFY_API_TOKEN`; Qwen credentials reuse `dashscopeApiKey()` resolution (`DASHSCOPE_API_KEY`, `DASHSCOPE_API_KEY_FILE`, or the existing default local secret file); optional `QWEN_NEWS_ANALYSIS_MODEL`.

No environment values or credentials are changed by implementation. Missing prerequisites produce a persisted `blocked` task and zero provider calls. No live paid verification has been run. Production schema migration and provider readiness require separate validation. `ensureDeliveryCollections` defines the admin-only `social_insight_reports` collection with its unique tenant/request index; this change does not execute a production migration.

Data is limited to 30 keyword-search results, filtered to the latest seven Shanghai calendar dates and the query-start time. Invalid/missing dates, non-video formats and duplicates are excluded. Unknown metrics stay null; program code creates charts. The model only interprets supplied public captions with exact sample links. No video/audio/subtitle inspection, country-audience proof, growth, sales, or full-platform ranking is established.

Job phase and raw provider responses are persisted before interpretation. Submitted-but-unconfirmed operations remain unknown. Known-run failures/observation timeouts retain runId/datasetId. This version deliberately does not automatically resume or re-submit interrupted jobs. The GET endpoint marks abandoned running jobs unknown after five minutes. A failed interpretation returns partial real data, not a successful invented report.


## B2B/B2C material classification

New reports optionally carry `merchantContext` (default B2B identity, AI-authorized industry and product categories only) and `materials`. No enterprise contacts, customers, knowledge documents, prices, qualifications or supplier commitments are sent to the classification model. If profile access is disabled/unavailable, only the keyword and public captions are used, without guessing the industry.

The same single interpretation call returns strict JSON assignments for every sampled video exactly once, with audience category, confidence, caption-based reason, merchant production help, suggested content angle and evidence to obtain. Incomplete/invalid output leaves the report partial with no invented assignments. B2B suggestions consider supply stability, factory capabilities, quality control, certification, delivery and OEM as topics requiring real enterprise evidence, never as established company capabilities. B2C observations concern caption language only: comment counts do not provide comment text, customer feedback or verified consumer demand. Program code ranks known-view samples within each category; null-view videos remain classified but are excluded from ranked IDs. A single snapshot is not growth or an assured inquiry outcome.

An explicit persisted actor-submit HTTP 403 `platform-feature-disabled` / `Monthly usage hard limit exceeded` receipt with no run ID is a proven provider refusal. The task is blocked and no materials were obtained; GET may repair an older unknown presentation using that receipt, while preserving the original receipt and submission phase. No provider request is reissued. Other 403s, malformed responses or known runs do not receive this special mapping.


The social insight scene omits Actor `videoSearchDateFilter` by default: a live 2026-10-28 test using `proxyCountryCode=US` and no search date filter returned 16 locally verified seven-day samples. This is an observed configuration, not proof of reliability or US audience. The separate Actor date bounds and strict local seven-day validation remain. `SOCIAL_INSIGHTS_APIFY_SEARCH_DATE_FILTER=1` explicitly restores `PAST_WEEK`; other Apify workflows are unaffected.

A single confirmed keyword is expanded into four queries (original, OEM, private label, manufacturer) with a 7-result per-query limit and a bounded 30-item dataset read. Matching supplier searchQuery values are retained as provenance, not used as audience labels. Duplicates, missing dates and out-of-window items are excluded; absent searchQuery is unassigned.
