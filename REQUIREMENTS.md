# Requirements â€” what must be installed to run this project 
 
## 1. System software (install once on your machine) 
 
| Software | Version | Why | Download | 
|----------|---------|-----|----------| 
| **Node.js** | 18 or newer (LTS recommended) | Runs the server + comes with `npm` | https://nodejs.org | 
 
That's the *only* system-level install. Everything else is installed automatically by `npm install` (below). There is **no database to install** in the testing phase â€” data is stored in a local `data/db.json` file. 
 
To confirm Node is installed, open PowerShell and run: 
 
```powershell 
node -v 
npm -v 
``` 
 
## 2. Project dependencies (installed by `npm install`) 
 
These come from `package.json` â€” you do **not** install them by hand. 
 
| Package | Purpose | 
|---------|---------| 
| `express` | Web server + REST API | 
| `socket.io` | Real-time push of new orders to the owner dashboard | 
| `razorpay` | Payment gateway SDK (UPI is free). Only used when you add keys. | 
| `jsonwebtoken` | Secure login tokens for owner + admin | 
| `bcryptjs` | Hashes owner/admin passwords (pure JS â€” no build tools needed on Windows) | 
| `dotenv` | Loads config from a `.env` file | 
| `helmet` | Security HTTP headers | 
| `express-rate-limit` | Basic protection against request floods | 
 
## 3. Accounts (only when you leave testing) 
 
| Service | Needed for | Free tier? | 
|---------|-----------|------------| 
| **Razorpay** | Real UPI/card payments (test keys work for free while developing) | Yes â€” UPI has 0% fee | 
| A host (Render / Railway / Fly.io / a VPS) | Putting it online | Free tiers available | 
| A real database (Postgres / MongoDB) | Production data instead of the JSON file | Free tiers available | 
 
None of these are required to run and test locally. 
 

 
