# Deploy & Update Guide

This is your step-by-step for putting the app online (free), and for pushing
code updates to it later. Follow the sections in order the first time.

- **Database:** MongoDB Atlas (free 512 MB)
- **Hosting:** Render (free web service, supports the live owner dashboard)
- **All test logins:** live in one file → `credentials.json`

---

## 0. Where do I put my account details?

You only ever paste secrets into **two safe places**:

| Value | Local testing | Deployed on Render |
|-------|---------------|--------------------|
| Admin / owner passwords | `credentials.json` | Render → Environment variables |
| MongoDB connection string | `.env` (`MONGODB_URI=...`) | Render → Environment variables |

`credentials.json` and `.env` are git-ignored, so they are **never pushed** to
GitHub. On Render you set the same values as Environment Variables. That's the
only detail-entry you need to do — nothing is hard-coded.

---

## 1. Create the database (MongoDB Atlas)

1. Go to <https://www.mongodb.com/cloud/atlas/register> and sign up (free).
2. Create a **free M0 cluster** (any cloud/region near you).
3. **Database Access** → *Add New Database User* → create a username + password.
   Write these down. (Avoid special characters in the password to keep the URL
   simple, or URL-encode them.)
4. **Network Access** → *Add IP Address* → **Allow access from anywhere**
   (`0.0.0.0/0`). This lets Render connect.
5. **Clusters** → *Connect* → *Drivers* → copy the connection string. It looks
   like:
   ```
   mongodb+srv://<user>:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
   ```
6. Replace `<user>` and `<password>` with the ones from step 3. **Keep this
   string** — you'll paste it into Render (and optionally `.env` for local use).

> Leaving `MONGODB_URI` blank makes the app store data in a local JSON file
> instead. That's fine for local testing but data won't persist on Render's free
> tier (its disk resets on redeploy), so use Atlas for the deployed site.

---

## 2. Put the code on GitHub

Render deploys from a Git repo, so the code needs to live on GitHub.

```powershell
# from the project folder
git init
git add .
git commit -m "Initial commit"
# create an empty repo on github.com first, then:
git remote add origin https://github.com/<your-username>/food-order-app.git
git branch -M main
git push -u origin main
```

`credentials.json`, `.env`, and `data/db.json` are git-ignored, so your
passwords do **not** get uploaded. Good.

---

## 3. Deploy on Render

1. Go to <https://render.com> and sign up (you can log in with GitHub).
2. **New +** → **Web Service** → connect your GitHub repo.
3. Render auto-detects Node. Confirm:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free
4. Before the first deploy, open **Environment** and add these variables:

   | Key | Value |
   |-----|-------|
   | `MONGODB_URI` | the Atlas string from step 1 |
   | `MONGODB_DB` | `foodorder` |
   | `ADMIN_PASSWORD` | your admin password (e.g. `admin123`) |
   | `JWT_SECRET` | any long random string |
   | `CURRENCY` | `INR` |

   (Leave the two `RAZORPAY_*` blank to keep payments in free mock mode.)
5. Click **Create Web Service**. First build takes a few minutes.
6. When it's live you get a URL like `https://food-order-app.onrender.com`:
   - Customer app → `/`
   - Owner login → `/owner.html`
   - Admin panel → `/admin.html`

> **Cold start:** the free tier sleeps after ~15 min idle; the first request
> then takes ~30 sec to wake. Normal for free hosting.

*(Alternative: this repo includes `render.yaml`, so you can instead use
**New + → Blueprint** and Render will create the service from that file. You
still fill in the secret env vars in the dashboard.)*

---

## 4. Your test logins

All in **`credentials.json`** (copy from `credentials.example.json` if missing):

- **Admin** → `/admin.html` with `admin.password`
- **Owner** → `/owner.html` with a `code` + `password` from the `owners` list
- **Customers** → do **not** log in. They open `/`, enter a restaurant code, and
  must be within that restaurant's location radius to order. The `customers`
  list in the file is just a note-pad for your own testing.

To change seeded owners/passwords: edit `credentials.json`, then reset the data
(see below) so the seed re-runs. On Render, change `ADMIN_PASSWORD` in the
Environment tab instead of the file.

---

## 5. Updating the deployed code (your update workflow)

Render **auto-deploys every time you push to the `main` branch.** So the loop is:

```powershell
# 1. edit code locally
# 2. commit and push
git add .
git commit -m "Describe what you changed"
git push
```

That's it — Render sees the push and rebuilds/redeploys automatically (watch the
**Events**/**Logs** tab in the Render dashboard). No manual upload.

**Redeploy without a code change** (e.g. after changing an env var): Render
dashboard → your service → **Manual Deploy** → *Deploy latest commit*.

**Roll back a bad update:** Render dashboard → **Events** → pick a previous
successful deploy → *Rollback*.

---

## 6. Resetting test data

- **Local (JSON mode):** delete `data/db.json` and restart — the demo seed runs
  again from `credentials.json`.
- **MongoDB Atlas:** in Atlas → *Browse Collections* → database `foodorder` →
  collection `appdata` → delete the single document, then restart the service.
  The seed re-creates the demo restaurant + menu.

---

## Quick reference

| I want to… | Do this |
|------------|---------|
| Change admin password (local) | edit `credentials.json` → `admin.password` |
| Change admin password (Render) | Render → Environment → `ADMIN_PASSWORD` |
| Change an owner login | edit `credentials.json` → `owners`, reset data |
| Point at a different database | change `MONGODB_URI` |
| Ship a code change | `git push` (Render auto-deploys) |
| Undo a bad deploy | Render → Events → Rollback |
