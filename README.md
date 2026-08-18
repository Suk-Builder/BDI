# BDI — Builder Density Instrument

A dual-assessment framework combining **cognitive fluid intelligence testing** with **psychiatric phenotype profiling**, targeting the upper tail of the ability distribution (SD15 >= 130).

## Problem Statement

Standard IQ instruments (Raven, WAIS, Mensa) lose discriminative power beyond +2 SD because their item pools are calibrated around the mean. At 135+, ceiling effects collapse distinct ability levels into a single "pass" bucket. Psychiatric diagnosis, meanwhile, relies on DSM/ICD categorical taxonomies that conflate symptom labels with underlying mechanistic processes.

BDI addresses both gaps with a unified, component-level scoring architecture.

## Architecture

```
BDI Suite
├── GF-Engine (General Fluid Intelligence)
│   ├── 6 dimensions × 6 items = 36-item cognitive matrix
│   ├── Component-separated scoring (reasoning ~70%, execution ~30%)
│   └── AI-generated item bank with SQLite persistence + auto-replenishment
│
└── Psychiatric Phenotype Mapper
    ├── Course trajectory modeling (non-DSM, process-oriented)
    ├── Autodeception detection via response-pattern analysis
    └── Addiction-substance co-evolution profiling
```

## Component-Separated Scoring

Each item is decomposed into **atomic cognitive operations** (components). The examinee must submit a complete reasoning chain; raw answers alone are rejected.

Scoring is per-component:
- **Reasoning components** (~70% weight): logical structure, analogy mapping, pattern extrapolation
- **Execution components** (~30% weight): arithmetic accuracy, spatial manipulation, working-memory fidelity

AI evaluates each component independently, producing a fine-grained profile rather than a single scalar.

## Dynamic Item Bank

Items are generated on-demand via LLM and persisted to SQLite. A background replenishment daemon maintains >= 50 items per dimension, prioritizing under-represented strata.

## Session Management

- 30-minute TTL sessions with server-side state
- History injection prevents context loss in multi-turn interactions
- Leaderboard with within-cohort density distribution

## Quick Start

```bash
npm install
cp .env.example .env   # configure DASHSCOPE_API_KEY, APP_ID, BDI_DB_PATH
npm start              # default port 3000
```

## API

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/gf/start` | POST | — | Initialize a test session |
| `/api/gf/answer` | POST | — | Submit answer + reasoning chain |
| `/api/gf/result/:id` | GET | — | Retrieve session results |
| `/api/leaderboard` | GET | — | Cohort density distribution |

## Scoring Thresholds

| Total Score | SD15 Equivalent | Interpretation |
|-------------|-------------------|----------------|
| ≥ 15 | ≥ 130 | High fluid intelligence band |
| 13–14 | 120–129 | Upper-mid fluid intelligence band |
| < 13 | ≤ 119 | Below BDI applicability threshold |

## License

MIT
