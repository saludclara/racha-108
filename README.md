# Racha 108

Web app de **apuestas ficticias** (bankroll simulado) sobre **partidos reales**.

- 1 pick cada **1h 11m 11s** · stake base **11.11 AUD**
- Objetivo: **108** aciertos seguidos
- HotStack / Vault
- Liquidación con **marcador real** (no RNG)

## Datos (free tiers)

| Fuente | Key | Rol |
|--------|-----|-----|
| **ESPN** | ninguna | Fixtures + scores fútbol (60+ ligas) — base |
| **API-Football** | `API_FOOTBALL_KEY` | Más ligas / scores (100 req/día) |
| **The Odds API** | `ODDS_API_KEY` | Cuotas bookmaker reales |
| **PandaScore** | `PANDASCORE_TOKEN` | Esports (LoL/CS2/Dota/Valorant) |

Copiá `.env.example` → `.env.local` y pegá las keys free. Sin keys, ESPN sigue funcionando solo.

## Desarrollo

```bash
npm install
cp .env.example .env.local
npm run dev
```

## Deploy (nube)

Push a `main` → Vercel auto-deploy.

- Producción: https://racha-108.vercel.app
- ESPN funciona **sin keys** en la nube
- Keys free opcionales en Vercel → Project → Settings → Environment Variables:
  - `API_FOOTBALL_KEY`
  - `ODDS_API_KEY`
  - `PANDASCORE_TOKEN`

Endpoint: `/api/hourly` (serverless, `maxDuration` 60s)
