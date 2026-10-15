# SetFluence

Agentic, evidence-backed festival sponsorship planning: lineup + brief → Qloo cultural evidence → deterministic constraint solver → stage-by-stage partnership proposal.

## Repository layout

```
.
├── backend/            Node + TS API: QlooService, solver, agent (Phases 1–3)
├── frontend/           React + Vite UI (Phase 1.1+)
├── shared/             Domain types shared by both (Phase 1.2)
├── scripts/phase0/     Phase 0 live Qloo technical test
├── fixtures/           Captured live Qloo responses (+ synthetic test data later)
└── docs/phase0/        Generated Phase 0 report + summary
```

## Setup

Requires Node ≥ 22.18 (Node 24 recommended; TS runs natively, no build step for scripts).

```bash
cp .env.example .env      # add your Qloo hackathon key
npm install
npm run phase0            # live Qloo test → docs/phase0/phase0-report.md
```

## License

MIT — see [LICENSE](LICENSE). Brand names and external data retain their own terms.
