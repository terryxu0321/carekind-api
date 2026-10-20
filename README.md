# carekind-api

Backend API and AI pipeline worker — part of **CareKind AI**.

- Stack: Node.js + TypeScript, NestJS
- Requirements, boundaries and module guidance: [src/api](https://github.com/terryxu0321/JRAgedCareProject/tree/main/company-os/06-app-development/src/api)
- **All documentation lives in the meta repo** [terryxu0321/JRAgedCareProject](https://github.com/terryxu0321/JRAgedCareProject) (PRD, specs, rules, decisions, changelog). This repo holds only code, tests and config.
- Before working here (people or AI agents), read the meta repo's root `AGENTS.md` and the module guidance linked above.

Formatting follows `.editorconfig` (tabs, width 4). Never commit secrets or real resident / personal data — this repo is public.

## Development

Requires Node.js ≥ 22.12 and the meta repo checkout (`@carekind/shared` is linked from `../../packages/carekind-shared`; run `npm run build` there first if its `dist/` is missing). No Docker: the database is PGlite, stored in the gitignored `.data/` folder.

```sh
cp .env.example .env    # then fill JWT_SECRET (≥ 32 chars) and SEED_PASSWORD (≥ 14 chars)
npm install
npm run seed            # synthetic data only; prints the sign-in emails
npm run start           # http://localhost:3000/api/v1 — stop with Ctrl+C
```

| Command | Purpose |
|---|---|
| `npm run build` | Compile to `dist/` |
| `npm run typecheck` | Type-check source and tests |
| `npm run lint` | ESLint + Prettier check |
| `npm test` | Vitest; each test file uses its own in-memory database |
| `npm run db:generate` | Generate a migration after changing `src/db/schema.ts` |

Stop the server with Ctrl+C so the database folder is closed cleanly. If it ever fails to open, stop the API, delete `.data/` and run `npm run seed` again.
