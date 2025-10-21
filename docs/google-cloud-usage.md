# Using Google Cloud Storage for Best Recipes

## Overview

This setup allows you to store best recipes data in Google Cloud Storage and fetch it dynamically without rebuilding your app.

## Advantages vs Git-based Approach

| Feature | Git + Auto-deploy | Google Cloud Storage |
|---------|-------------------|---------------------|
| **Update Speed** | 2-5 min (rebuild) | Instant (no rebuild) |
| **Cost** | Free (GitHub + Vercel) | ~$0.026/month for 1GB |
| **Rebuilds** | 24/day if data changes | Zero |
| **Build Minutes** | Consumed on each change | Not consumed |
| **CDN Support** | Via Vercel Edge | Via Cloud CDN |
| **Version History** | Git commits | GCS versioning (optional) |

## Setup Steps

### 1. Follow setup guide
See `docs/google-cloud-setup.md` for detailed GCS bucket and service account setup.

### 2. Activate the GCS workflow

```bash
# Disable the current git-based workflow
mv .github/workflows/refresh-best-recipes.yml .github/workflows/refresh-best-recipes.yml.disabled

# The GCS workflow is already in place
# .github/workflows/refresh-best-recipes-gcs.yml
```

### 3. Set environment variable (optional)

If you want to use a custom GCS URL:

```bash
# In Vercel dashboard, add:
GCS_BEST_RECIPES_URL=https://storage.googleapis.com/your-bucket/best-recipes.json
```

Default is: `https://storage.googleapis.com/prun-best-recipes/best-recipes.json`

## How It Works

### Data Loading Priority (Cascade)

1. **Try Google Cloud Storage** (if URL starts with http)
   - Fast, always fresh
   - No rebuild needed

2. **Try local static file** (build-time generated)
   - Fallback for local development
   - Also used if GCS fetch fails

3. **Generate at runtime** (slowest)
   - Last resort
   - Takes ~7 seconds

### Workflow Behavior

Every hour (or when triggered):
1. ✅ Generate best recipes data
2. ✅ Upload to GCS with 5-minute cache headers
3. ✅ **No git commit**
4. ✅ **No rebuild triggered**
5. ✅ Data available instantly

### Cache Control

Files are uploaded with:
```
Cache-Control: public, max-age=300
```

This means:
- Browsers/CDN cache for 5 minutes
- Fresh data propagates within 5 minutes
- Balance between freshness and performance

## Monitoring

Check GitHub Actions tab to see:
- When data was last generated
- Upload success/failure
- Public URLs for the data

## Switching Back to Git-based

```bash
# Re-enable git workflow
mv .github/workflows/refresh-best-recipes.yml.disabled .github/workflows/refresh-best-recipes.yml

# Disable GCS workflow
mv .github/workflows/refresh-best-recipes-gcs.yml .github/workflows/refresh-best-recipes-gcs.yml.disabled
```

## Cost Estimate

For a 400KB file updated hourly:
- Storage: 0.0004 GB × $0.020/GB = $0.000008/month
- Operations: 720 writes/month × $0.05/10k = $0.0036/month
- Network: 720 reads/month × 400KB = ~0.3 GB × $0.12/GB = $0.036/month
- **Total: ~$0.04/month** (essentially free)

With Cloud CDN (optional):
- Adds ~$0.08/GB for cache fills
- Reduces direct GCS reads
- Faster global access
