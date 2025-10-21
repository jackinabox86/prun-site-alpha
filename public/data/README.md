# Data Directory

This directory contains both static data files and generated data files for the application.

## Static Files (Committed)

- `recipes.csv` - Recipe data from the game
- `prices.csv` - Market price data

## Generated Files (Auto-updated)

- `best-recipes.json` - Pre-computed best recipe analysis
- `best-recipes-meta.json` - Metadata about the generation (timestamp, duration, etc.)

### How Best Recipes Data is Generated

The `best-recipes.json` file is automatically generated in two scenarios:

1. **Build Time** - During deployment, the `postbuild` script runs to generate fresh data
2. **Hourly Updates** - A GitHub Action runs every hour to refresh the data and commit changes

This approach ensures:
- ✅ Fast loading (static JSON files)
- ✅ Always up-to-date (hourly refresh)
- ✅ Reliable (GitHub Actions are free and guaranteed)
- ✅ Version controlled (can see history of changes)
- ✅ No dependency on Vercel paid plans

### Manual Generation

To manually generate or update the best recipes data:

```bash
npm run generate-best-recipes
```

This will create/update `best-recipes.json` and `best-recipes-meta.json` in this directory.
