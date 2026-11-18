# PayBridge Prototype

A clickable browser prototype for IST2106 Group 10. PayBridge is a mobile-money payout bridge for Ugandan freelancers. It never holds funds: it connects work earnings to MTN MoMo and Airtel Money through a Bank of Uganda-licensed payment service provider.

Questionnaire (live form): https://docs.google.com/forms/d/e/1FAIpQLSef8jSscHlQiz0xxyk0ZfawLL2P7AQriyOwusrpqmvYeW6sYw/viewform

## What's in this folder

- `index.html` - landing page with sign in and create account
- `dashboard.html` - available balance, delivered total, and recent transactions (click one for its receipt)
- `cashout.html` - cash out to MTN MoMo or Airtel Money with a live fee breakdown
- `invoice.html` - generate direct-client payment links, then search and filter invoices
- `client-pay.html` - standalone payer page. Mary sends the link; the client does not need an account
- `receipt.html` - receipt detail plus a searchable receipt history
- `src/app.ts` - TypeScript source for all the logic
- `src/style.css` - styles
- `dist/app.js` - compiled JavaScript that actually runs in the browser
- Mock-up PNGs and the marketing asset are in the parent folder

## How to run it

Open `index.html` in a browser. No server, install, or build step is needed.

If you change `src/app.ts`, recompile from inside `paybridge-prototype/`:

```
npx tsc
```

## How to use it

1. Create an account
   Open `index.html`, choose Create Account, enter a name, email, phone and password (at least 6 characters), and pick MTN or Airtel Money.

2. Sign in
   Use the same phone or email, password and network. State is saved in the browser, so it survives a refresh.

3. Generate a direct-client invoice
   Go to Invoices, enter the client name, amount in USD and what the payment is for. PayBridge creates an `INV-####` reference and a payment link. Copy it or open it in a new tab. Use Pending / Settled / All and the search box to find invoices later.

4. Receive the payment
   On `client-pay.html` the client sees the invoice, the amount and who it is from. They choose card or bank transfer, confirm, and get a receipt with a reference. The invoice moves to Settled, Mary's available balance increases, and the payment appears in Recent Transactions and Receipt history. Mary's settled invoice carries the same reference. Invoices are for direct clients only; Fiverr and Upwork payouts do not use them.

5. Cash out
   Go to Cash Out, enter a USD amount and watch the fee calculate live. The fee is 3.5% intro, minimum UGX 3,000, never above 5%. Confirm to deliver UGX to the selected mobile money network and get a receipt. The fee is charged here only: the client pays the full invoiced amount.

6. Find old receipts
   Open Receipts from the navbar. Search by reference, invoice ID, client, amount, date or month, or use the period dropdown. Click a card to see that receipt in detail and print it. You can also reach a receipt by clicking a transaction on the Dashboard or "View receipt" on a settled invoice.

7. Sign out
   Clears the session and returns to the landing page.

## Notes for a presentation

- The story: freelancers lose time and money on slow, opaque payouts. Fees and exchange-rate loss are often unclear until after the money arrives.
- Show the live fee calculator, then the receipt with a reference number.
- Receipt history makes the "every payout carries a receipt" claim visible: cash-outs and invoice payments sit side by side, and each opens in detail.
- The platform rail (Upwork or Fiverr through Payoneer) is in the written proposal but cannot be acted out here without bank and platform APIs. The direct-client invoice rail is the part this prototype demonstrates.

This is a browser-only simulation. There is no backend, no real payment and no email delivery. All state lives in this browser's localStorage, so a link opened in another browser or device will not see the current user's  data.
