# Food Ordering App (web-first, multi-restaurant) 
 
One codebase serving many restaurants. A customer opens the app, types a 
**3-digit code** on a keypad, sees that restaurant's menu, and can order **only 
if they are within ~100 m** of the restaurant. Each restaurant owner logs into a 
dashboard and sees orders **in real time** with a sound alert. You (the company 
owner) manage every restaurant, code, location and menu from an admin panel. 
 
Built to run **free** for testing, and designed so the database and payment 
gateway can be swapped for production later **without rewriting the app**. 
 
--- 
 
## Quick start 
 
### Option A â€” automated (recommended) 
 
Run the one-time setup script. It installs Node.js (via winget) if missing, 
installs all dependencies, and creates your `.env`: 
 
```powershell 
powershell -ExecutionPolicy Bypass -File .\setup.ps1 
``` 
 
Then start the app: 
 
```powershell 
npm start 
``` 
 
### Option B â€” manual (3 steps) 
 
> Prerequisite: **Node.js 18+** installed (see [REQUIREMENTS.md](REQUIREMENTS.md)). 
 
```powershell 
# 1. Install dependencies 
npm install 
 
# 2. (optional) create your config file 
copy .env.example .env 
 
# 3. Start the server 
npm start 
``` 
 
Then open: 
 
| Page | URL | Who | 
|------|-----|-----| 
| Customer app | http://localhost:3000/ | Customers | 
| Owner dashboard | http://localhost:3000/owner.html | Restaurant owners | 
| Admin panel | http://localhost:3000/admin.html | You (company owner) | 
 
A **demo restaurant is seeded automatically** on first run: 
 
- Customer keypad code: **`481`** 
- Owner login: code **`481`**, password **`owner123`** 
- Admin password: **`admin123`** (change via `.env`) 
 
> The demo restaurant's location is set to Bangalore. To actually place a test 
> order you must be within its radius â€” so open the **Admin panel**, open the 
> restaurant, and either create your own restaurant with **"ðŸ“ Use my current 
> location"**, or edit the seeded one to your location. 
 
--- 
 
## How to test the full flow 
 
1. **Admin (you):** go to `/admin.html`, log in with `admin123`. Click 
   **"ðŸ“ Use my current location"**, fill code/name/owner-password, **Create 
   restaurant**. Open its **Menu** and add a few items. 
2. **Customer:** open `/`, type the 3-digit code. Allow location when asked. 
   You'll see "you can order" if you're within range. Add items â†’ checkout â†’ 
   pay. (In free mode the payment is auto-confirmed instantly.) 
3. **Owner:** open `/owner.html`, log in with the code + owner password. The 
   order appears **instantly** with a beep. Advance it: Confirm â†’ Preparing â†’ 
   Ready â†’ Completed. 
 
--- 
 
## Turning on real payments (Razorpay UPI) 
 
The app runs in a free **mock** payment mode until you add keys. To enable real 
Razorpay UPI checkout: 
 
1. Create a free Razorpay account and open **Settings â†’ API Keys** (use **Test 
   Mode** keys while developing). 
2. In your `.env` file set: 
   ``` 
   RAZORPAY_KEY_ID=rzp_test_xxxxxxxx 
   RAZORPAY_KEY_SECRET=xxxxxxxxxxxxxxxx 
   ``` 
3. Restart: `npm start`. The startup log will show `Payment mode : razorpay`. 
 
Nothing else changes â€” the payment code is isolated in 
`src/services/payment/`, so the customer/owner/admin flows are untouched. 
 
--- 
 
## How the project is implemented (architecture) 
 
``` 
Proejct/ 
â”œâ”€ server.js                  # App entry: express + socket.io + static files 
â”œâ”€ package.json               # Dependencies & scripts (the "requirements" file) 
â”œâ”€ .env.example               # Config template (copy to .env) 
â”œâ”€ REQUIREMENTS.md            # What to install 
â”‚ 
â”œâ”€ src/ 
â”‚  â”œâ”€ config/                 # All env/config in one place 
â”‚  â”œâ”€ data/ 
â”‚  â”‚  â”œâ”€ store.js             # JSON-file persistence (SWAP THIS for a real DB) 
â”‚  â”‚  â””â”€ seed.js              # Seeds the demo restaurant on first run 
â”‚  â”œâ”€ repositories/           # Data access (restaurant / menu / order) 
â”‚  â”œâ”€ services/ 
â”‚  â”‚  â”œâ”€ geoService.js        # 100m geofence (Haversine distance) 
â”‚  â”‚  â”œâ”€ authService.js       # bcrypt + JWT 
â”‚  â”‚  â”œâ”€ orderService.js      # Order rules: geofence + server-side pricing 
â”‚  â”‚  â””â”€ payment/             # Payment providers (mock + razorpay) behind one interface 
â”‚  â”œâ”€ middleware/             # auth guards + error handling 
â”‚  â”œâ”€ routes/                 # REST API: /public, /owner, /admin 
â”‚  â””â”€ realtime/socket.js      # Socket.IO rooms per restaurant 
â”‚ 
â”œâ”€ public/                    # Zero-build frontend 
â”‚  â”œâ”€ index.html + js/customer.js   # Keypad â†’ menu â†’ geofence â†’ checkout 
â”‚  â”œâ”€ owner.html + js/owner.js      # Live orders + sound 
â”‚  â”œâ”€ admin.html + js/admin.js      # Manage restaurants + menus 
â”‚  â”œâ”€ js/api.js               # Shared fetch + geolocation helpers 
â”‚  â””â”€ css/styles.css 
â”‚ 
â””â”€ data/db.json               # Local database file (auto-created, git-ignored) 
``` 
 
### Key design choices (so production swap is painless) 
- **Data access is isolated** in `src/repositories/` + `src/data/store.js`. To 
  move to Postgres/MongoDB, reimplement those files against the DB driver â€” the 
  services, routes and frontend do not change. 
- **Payments are isolated** in `src/services/payment/`. Add a provider file and 
  extend the factory in `index.js`; nothing else changes. 
- **Security is enforced on the server, not the browser:** the 100 m geofence 
  check and the order total are both recomputed server-side, so a tampered 
  client cannot order out of range or pay a wrong price. 
 
### Security notes before going live 
- Change `JWT_SECRET` and `ADMIN_PASSWORD` in `.env`. 
- Serve over **HTTPS** â€” browser geolocation only works on `https://` (or 
  `localhost`), which is required for the 100 m check. 
- The JSON file store is for testing only; move to a real database for 
  production. 
 
--- 
 
## Scripts 
 
| Command | What it does | 
|---------|--------------| 
| `npm start` | Start the server | 
| `npm run dev` | Start with auto-restart on file changes (Node `--watch`) | 
 

 
