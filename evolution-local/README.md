# Local Evolution API

This folder runs a beginner-safe local stack:

- Evolution API
- PostgreSQL
- Redis

## First run

1. Copy `.env.example` to `.env`
2. Keep the database values as they are
3. Change only `AUTHENTICATION_API_KEY`
4. Use the same key in the app `.env.local` as `WHATSAPP_PLATFORM_EVOLUTION_API_KEY`
5. Start Docker Desktop
6. Run:

```bash
docker compose down -v
docker compose up -d
```

## Check logs

```bash
docker logs --tail 100 evolution_api
```

## Stop

```bash
docker compose down
```
