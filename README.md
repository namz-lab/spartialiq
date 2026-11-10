# SpartialIQ

Vungu Rural District Council planning, finance, and spatial register.

```
backend/     API (Fastify) and PostGIS migrations
frontend/    Vue council portal
mobile/      Field app
pos/         Point of sale
docs/        Manuals, reports, and deployment notes
scripts/     Document and maintenance scripts
installers/  Desktop and Android installers
data/spatial Council master-plan package (the national geopackage stays local)
```

The hosted demo is one web service: `Dockerfile` builds the portal and the API together.
