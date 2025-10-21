# Google Cloud Storage Setup for Best Recipes

## Prerequisites

1. Google Cloud account
2. gcloud CLI installed (or use Cloud Console)

## Steps

### 1. Create a GCS Bucket

```bash
# Set your project ID
export PROJECT_ID="your-project-id"
gcloud config set project $PROJECT_ID

# Create a bucket (must be globally unique name)
gsutil mb -p $PROJECT_ID -c STANDARD -l US gs://prun-best-recipes/

# Make bucket publicly readable (optional, for public access)
gsutil iam ch allUsers:objectViewer gs://prun-best-recipes/
```

### 2. Create a Service Account for GitHub Actions

```bash
# Create service account
gcloud iam service-accounts create github-actions-uploader \
    --display-name="GitHub Actions Uploader" \
    --project=$PROJECT_ID

# Grant Storage Object Admin role
gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:github-actions-uploader@${PROJECT_ID}.iam.gserviceaccount.com" \
    --role="roles/storage.objectAdmin"

# Create and download key
gcloud iam service-accounts keys create gcs-key.json \
    --iam-account=github-actions-uploader@${PROJECT_ID}.iam.gserviceaccount.com

# Show the key content (copy this to GitHub Secrets)
cat gcs-key.json
```

### 3. Add GitHub Secret

1. Go to your GitHub repo → Settings → Secrets and variables → Actions
2. Click "New repository secret"
3. Name: `GCP_SA_KEY`
4. Value: Paste the entire content of `gcs-key.json`

### 4. Your Public URL

After upload, your file will be available at:
```
https://storage.googleapis.com/prun-best-recipes/best-recipes.json
```

Or with Cloud CDN (recommended for better performance):
```
https://cdn.yourproject.com/best-recipes.json
```

## Security Options

### Option A: Public Bucket (Simplest)
- Anyone can read
- No authentication needed
- Good for public data

### Option B: Signed URLs (More Secure)
- Generate temporary signed URLs
- Set expiration time
- Control access programmatically

### Option C: Private with IAM (Most Secure)
- Only authenticated users/services
- Fine-grained access control
- Requires authentication in your app
