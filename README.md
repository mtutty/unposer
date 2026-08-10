# AI-Powered Career Profile Platform

> **You're more than your resume.**

This platform builds a career profile from a candidate's own stories rather than a form: async logistics by chat or email, live storytelling prompts for the parts that need real-time follow-up, an AI-generated narrative profile the candidate reviews and corrects, a sandbox to practice the "virtual interview," and a time-boxed link that gives recruiters that same interactive experience. See [docs/onboarding-ux-flow-spec.md](docs/onboarding-ux-flow-spec.md) for the full design spec.

## Quick Start

1. **Copy environment file:**
   ```bash
   cp .env.example .env
   ```

2. **Configure your LLM API key in `.env`:**
   ```
   LLM_API_KEY=sk-your-actual-api-key
   ```

3. **Start all services:**
   ```bash
   docker-compose up -d
   ```

   Migrations run automatically on backend startup.

4. **Access the application:**
   - Application: http://localhost (nginx reverse proxy)
   - Dev mode also exposes:
     - Frontend dev server: http://localhost:4200
     - API: http://localhost:3000
     - Database: localhost:5432

## Development Login

Dev auth is enabled by default:
- Username: `devuser`
- Password: `devpass`

## Documentation

- [docs/onboarding-ux-flow-spec.md](docs/onboarding-ux-flow-spec.md) - The design-locked UX flow spec this app implements
- [CLAUDE.md](CLAUDE.md) - Architecture, data model, and conventions for working in this codebase

## Common Commands

### View logs
```bash
docker-compose logs -f             # All services
docker-compose logs -f nginx       # Nginx
docker-compose logs -f api         # API
docker-compose logs -f frontend    # Frontend (dev mode only)
```

### Production build
```bash
# Build and run in production mode (no dev overrides)
docker-compose -f docker-compose.yml build
docker-compose -f docker-compose.yml up -d
```

### Database operations
```bash
# Create a new migration
docker-compose exec api npx knex migrate:make migration_name

# Run migrations
docker-compose exec api npx knex migrate:latest

# Rollback migrations
docker-compose exec api npx knex migrate:rollback

# Access database
docker-compose exec postgres psql -U appuser -d appdb
```

### Rebuild services
```bash
docker-compose build --no-cache api
docker-compose up -d api
```

### Full reset
```bash
docker-compose down -v
docker-compose up -d
# Migrations run automatically on startup
```

## Tech Stack

- **Frontend:** Angular 22, TypeScript, custom design system (no CSS framework)
- **Backend:** Express 5, TypeScript, Node 24
- **Database:** PostgreSQL 18 (Alpine), Knex.js
- **AI:** `@langchain/openai` / `@langchain/anthropic` (provider-agnostic, configurable)
- **Reverse Proxy:** Nginx
- **Infrastructure:** Docker Compose

## Architecture

### Development Mode (default)
- Nginx proxies requests to Angular dev server (hot-reload) and API
- All services exposed on individual ports for debugging
- Uses `docker-compose.override.yml` automatically

### Production Mode
- Nginx serves built Angular static files directly
- API requests proxied through nginx
- Only port 80 exposed externally
- Run with: `docker-compose -f docker-compose.yml up -d`

## MVP Scope

The current MVP implements the full candidate-side flow end to end:
- ✅ User authentication (OIDC stub + dev bypass)
- ✅ Resume upload with AI parsing, or a career-changer manual-entry path — either way gated by a confirmation screen
- ✅ Logistics/goals conversation, candidate's choice of live chat or a simulated email thread
- ✅ Live-chat-only deep prompts for personality/collaboration signal (never self-scored)
- ✅ AI-generated narrative profile with a flag → targeted re-ask correction loop
- ✅ Sandbox practice interview against the candidate's own profile, with gaps routed back into the profile
- ✅ Time-boxed recruiter share links backed by the same live chat experience

Explicitly out of scope for v1 (see the spec's Future Features section):
- Employer-side onboarding flow
- Matching/discovery beyond the passive share-link model
- Full "why did the AI conclude this" transparency view
- Granular share-link controls and link analytics
- Real SMTP/IMAP delivery for the email channel (currently simulated in-app — see CLAUDE.md)
