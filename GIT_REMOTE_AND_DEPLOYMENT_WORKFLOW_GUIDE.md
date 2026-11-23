# Multi-Environment Git Remote & Deployment Workflow Guide

> **Target Audience:** Antigravity AI Agents & Developers working across local machines, laptops, and developer environments.  
> **Purpose:** Standardize repository remotes across all machines, define exact commands to configure missing remotes, and establish strict rules on **WHEN** and **WHERE** to push code.

---

## 1. System Repository Architecture

The SaafAI / Daily-Dash ecosystem consists of **two codebases** (Backend and Frontend), each tied to **Development** and **Production** remotes hosted on GitHub and automatically deployed via Vercel.

### A. Backend Repositories (`dash-backend` / `Daily-Dash-Backend-Development`)

| Environment | Repository Remote Name | GitHub URL | Deployed Service / Domain |
| :--- | :--- | :--- | :--- |
| **Development** | `development` (or `origin` on laptop) | `https://github.com/Bald-Duck294/Daily-Dash-Backend-Development.git` | `https://daily-dash-backend-development.vercel.app` |
| **Production** | `production` (or `origin` on main PC) | `https://github.com/Bald-Duck294/dash-backend.git` | Live Production Backend API |

---

### B. Frontend Repositories (`daily-dash`)

| Environment | Repository Remote Name | GitHub URL | Deployed Service / Domain |
| :--- | :--- | :--- | :--- |
| **Dev Work / Main** | `origin` | `https://github.com/Bald-Duck294/daily-dash.git` | Main dashboard dev / staging sync |
| **Dev Mirror** | `development` | `https://github.com/Bald-Duck294/Daily-Dash-Development.git` | Development mirror repository |
| **Production** | `production` | `https://github.com/pugarchdev/safai_index.git` | Live Production Frontend Dashboard |

---

## 2. Laptop Current State vs. Required Setup

### What Your Laptop Currently Has:
```bash
# In Backend: C:\daily-dash-main\Daily-Dash-Backend-Development
origin  https://github.com/Bald-Duck294/Daily-Dash-Backend-Development.git (fetch & push)
# Missing: Production remote (dash-backend.git)

# In Frontend: C:\daily-dash-main\daily-dash
origin  https://github.com/Bald-Duck294/daily-dash.git (fetch & push)
# Missing: Production remote (safai_index.git)
```

---

## 3. One-Time Setup Commands for Laptop

Run these commands in PowerShell on your laptop to configure all remotes consistently:

### Step 1: Configure Backend Remotes
Open PowerShell in `C:\daily-dash-main\Daily-Dash-Backend-Development`:

```powershell
cd C:\daily-dash-main\Daily-Dash-Backend-Development

# 1. Add production backend remote
git remote add production https://github.com/Bald-Duck294/dash-backend.git

# 2. (Recommended) Add development alias for clarity if needed
git remote add development https://github.com/Bald-Duck294/Daily-Dash-Backend-Development.git -ErrorAction SilentlyContinue

# 3. Verify configuration
git remote -v
```

**Expected output for Backend:**
```text
development  https://github.com/Bald-Duck294/Daily-Dash-Backend-Development.git (fetch)
development  https://github.com/Bald-Duck294/Daily-Dash-Backend-Development.git (push)
origin       https://github.com/Bald-Duck294/Daily-Dash-Backend-Development.git (fetch)
origin       https://github.com/Bald-Duck294/Daily-Dash-Backend-Development.git (push)
production   https://github.com/Bald-Duck294/dash-backend.git (fetch)
production   https://github.com/Bald-Duck294/dash-backend.git (push)
```

---

### Step 2: Configure Frontend Remotes
Open PowerShell in `C:\daily-dash-main\daily-dash`:

```powershell
cd C:\daily-dash-main\daily-dash

# 1. Add production frontend remote
git remote add production https://github.com/pugarchdev/safai_index.git

# 2. Add development mirror remote
git remote add development https://github.com/Bald-Duck294/Daily-Dash-Development.git -ErrorAction SilentlyContinue

# 3. Verify configuration
git remote -v
```

**Expected output for Frontend:**
```text
development  https://github.com/Bald-Duck294/Daily-Dash-Development.git (fetch)
development  https://github.com/Bald-Duck294/Daily-Dash-Development.git (push)
origin       https://github.com/Bald-Duck294/daily-dash.git (fetch)
origin       https://github.com/Bald-Duck294/daily-dash.git (push)
production   https://github.com/pugarchdev/safai_index.git (fetch)
production   https://github.com/pugarchdev/safai_index.git (push)
```

---

## 4. When to Push & Where to Push (Deployment Protocol)

```
                            [ CODE CHANGES READY ]
                                       │
                      ┌────────────────┴────────────────┐
                      ▼                                 ▼
             PHASE 1: DEV PUSH                  PHASE 2: PROD PUSH
         (Testing / Feature Work)             (User Approval Granted)
                      │                                 │
         ┌────────────┴────────────┐       ┌────────────┴────────────┐
         ▼                         ▼       ▼                         ▼
   Backend Dev Repo        Frontend Dev    Backend Prod Repo     Frontend Prod
 (Daily-Dash-Backend-        (origin)      (dash-backend.git)    (safai_index.git)
   Development.git)
```

### Scenario A: Push to DEV
* **When to push:**
  - After completing feature implementations, bug fixes, or report additions.
  - When you need to test the feature on the live dev environment (`daily-dash-backend-development.vercel.app`).
  - When the user asks to "push to dev".
* **Where to push:**
  - **Backend:** `Daily-Dash-Backend-Development.git` (`origin` on laptop or `development` on PC).
  - **Frontend:** `daily-dash.git` (`origin`).

### Scenario B: Push to PROD
* **When to push:**
  - **ONLY** when the user explicitly requests: *"push them to dev and prod"* or *"deploy to production"*.
  - **NEVER** push to production during ongoing debugging or unverified experiments.
  - After running the **Pre-Push Quality Checklist** below.
* **Where to push:**
  - **Backend:** `dash-backend.git` (`production` remote).
  - **Frontend:** `safai_index.git` (`production` remote) AND `daily-dash.git` (`origin`).

---

## 5. Mandatory Pre-Push Quality Checklist

Before running any `git push` command, the Antigravity agent or developer MUST perform these 4 checks:

### Checklist 1: Backend Syntax & Prisma Validation
```powershell
cd C:\daily-dash-main\Daily-Dash-Backend-Development

# Check syntax of entry file
node -c index.mjs

# Validate Prisma schema
npx prisma validate

# Ensure Prisma client generates cleanly
npx prisma generate
```
*Rule:* If `npx prisma validate` reports duplicate fields or missing back-relations, resolve them before committing.

### Checklist 2: Frontend Production Build Check
```powershell
cd C:\daily-dash-main\daily-dash

# Must compile all routes with 0 errors
npm run build
```
*Rule:* Turbopack / Next.js build must generate all static and dynamic pages with exit code 0.

### Checklist 3: Frontend API Base URL Verification
Inspect [`daily-dash/shared/constants/Constant.js`](file:///d:/Dash-saafAi/Daily-Dash-Main/daily-dash/shared/constants/Constant.js):
```javascript
// MUST NOT point to localhost when pushing to GitHub!
const API_BASE_URL = "https://daily-dash-backend-development.vercel.app/api";
// const API_BASE_URL = "http://localhost:8001/api";

export default API_BASE_URL;
```
*Rule:* **Never** push `http://localhost:8001` or `http://localhost:8000` to remote repositories. It will break the application for all users in staging and production.

### Checklist 4: Git Status Check
Make sure untracked files are intentionally staged or ignored. Do not commit temporary test files like `test_*.js` or `test_*.xlsx`.

---

## 6. Execution Command Playbook

### Workflow 1: Pushing to Development Only
Use this when you are iterating on features or the user asks to push to dev:

```powershell
# 1. Push Backend to Development
cd C:\daily-dash-main\Daily-Dash-Backend-Development
git add .
git commit -m "feat: <feature description>"
# On laptop (where origin is Daily-Dash-Backend-Development.git):
git push origin main
# If development remote alias is added:
# git push development main

# 2. Push Frontend to Development
cd C:\daily-dash-main\daily-dash
git add .
git commit -m "feat: <feature description>"
git push origin main
```

---

### Workflow 2: Pushing to BOTH Dev and Production
Use this when user gives explicit permission: *"push to dev and prod"*:

```powershell
# ==========================================
# STEP 1: BACKEND (Dev & Prod)
# ==========================================
cd C:\daily-dash-main\Daily-Dash-Backend-Development
git add .
git commit -m "feat: <feature description>"

# Push to Dev
git push origin main

# Push to Production
git push production main


# ==========================================
# STEP 2: FRONTEND (Dev & Prod)
# ==========================================
cd C:\daily-dash-main\daily-dash
git add .
git commit -m "feat: <feature description>"

# Push to Dev (origin)
git push origin main

# Sync & Push to Production (safai_index.git)
git fetch production
# If production has minor remote updates (e.g. README.md), merge cleanly:
git merge production/main -m "merge: integrate production updates"
git push production main
```

---

## 7. Common Issues & Quick Fixes

### 1. Merge Conflict in `prisma/schema.prisma`
* **Symptoms:** `Field "cleaner_penalties" is already defined on model "companies"` or missing relation on `users`.
* **Fix:**
  - Open `prisma/schema.prisma`.
  - Search for duplicate field names within each `model`.
  - Check that all relations have opposite matching relation fields on target models.
  - Run `npx prisma validate` until you see: `The schema at prisma\schema.prisma is valid 🚀`.

### 2. `git push production main (rejected - non-fast-forward)`
* **Cause:** `production` (`safai_index.git`) received a README or commit directly.
* **Fix:**
  ```powershell
  git fetch production
  git merge production/main -m "merge: integrate production updates"
  git push production main
  ```

### 3. Git Credential Manager Prompts / Freezes
* **Cause:** `credential.https://github.com.usehttppath` requires authentication per distinct GitHub repository URL.
* **Fix:**
  - If a Git Credential Manager browser window opens, log in with the designated GitHub account (`Bald-Duck294` / `pugarchdev`).
  - Once signed in, Windows stores the credential in Windows Credential Manager permanently.
