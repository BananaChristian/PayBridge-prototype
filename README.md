# PayBridge Prototype

A clickable prototype for our IST2106 venture — PayBridge, a mobile-money payout bridge for Ugandan freelancers.

## What's in this folder

- `index.html` — landing page (sign in / create account)
- `dashboard.html` — wallet balance and recent transactions
- `cashout.html` — cash out to MTN MoMo or Airtel Money with fee breakdown
- `invoice.html` — payer side: clients pay by card or bank transfer
- `receipt.html` — confirmation screen after a cash out
- `src/app.ts` — TypeScript source (logic)
- `src/style.css` — styles
- `dist/app.js` — compiled JavaScript (what actually runs in the browser)
- Mock-up PNGs and the marketing asset are in the parent folder

## How to run it

Just open `index.html` in your browser. No server, no install, no build step needed.

If you make changes to `src/app.ts`, recompile with:
```
npx tsc
```
from inside the `paybridge-prototype/` folder.

## How to use it

**1. Create an account**
Open `index.html`, click "Create Account", fill in your details and pick MTN or Airtel Money. Password must be at least 6 characters.

**2. Sign in**
Use the same phone/email, password, and network you signed up with. Your balance and transactions are saved in the browser, so they stick around if you refresh.

**3. Cash out**
Go to Cash Out, enter a USD amount, and watch the fee calculate live (3.5% intro, min UGX 3,000, never above 5%). Confirm and you'll get a receipt with a reference number.

**4. Receive money (payer side)**
Go to Invoice, enter a USD amount, and pay by card or bank transfer. The money lands on the dashboard instantly — this simulates a foreign client paying you.

**5. Sign out**
Clears your session and sends you back to the landing page. Your account stays saved, so you can sign back in later.

## Demo tips for Thursday

- Lead with the story: freelancers lose money on slow, opaque payouts (we used the "$13 lost on $150" quote from our interviews).
- Show the live fee calculator — people respond to seeing numbers update as they type.
- The receipt with a reference number makes it feel real.
- Everything is browser-based, so it works on a laptop or phone during the presentation.

This is a prototype — it simulates payments in the browser. It doesn't connect to real banks or mobile money yet.
