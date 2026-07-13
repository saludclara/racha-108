# Racha 108

Web app de **apuestas ficticias en dinero** (bankroll simulado) sobre **partidos reales** vía ESPN scoreboards.

- 1 pick/hora · stake base **11.11 AUD**
- Objetivo: **108** aciertos seguidos
- HotStack / Vault
- Liquidación con **marcador real** (no RNG)

## Datos

Fuente: `site.api.espn.com` (fixtures + forma + resultados). No se inventan equipos ni partidos.

## Desarrollo

```bash
npm install
npm run dev
```

## Deploy

Push a `main` → Vercel. Endpoint: `/api/hourly`
