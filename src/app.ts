type Network = "MTN" | "Airtel";

interface User {
  name: string;
  email: string;
  phone: string;
  network: Network;
  password: string;
  verified: boolean;
}

interface Transaction {
  id: string;
  type: "cash_out" | "receive";
  amountUsd: number;
  amountUgx: number;
  feeUsd: number;
  feeUgx: number;
  netUgx: number;
  status: "completed" | "pending";
  createdAt: string;
  reference: string;
  network: string;
  description?: string;
}

interface PendingInvoice {
  id: string;
  client: string;
  amountUsd: number;
  dueDate: string;
}

interface AppState {
  user: User | null;
  paybridgeBalanceUsd: number; // Funds received / cashable
  accountBalanceUsd: number;     // Actual account balance after cash out
  transactions: Transaction[];
  pendingInvoices: PendingInvoice[];
}

const PLANNING_RATE = 3750; // UGX per USD
const INTRO_FEE_RATE = 0.035; // 3.5% intro
const MIN_FEE_UGX = 3000;
const MAX_FEE_RATE = 0.05; // 5% ceiling

const STORAGE_KEY = "paybridge_prototype_v1";

const DEFAULT_INVOICES: PendingInvoice[] = [
  { id: "INV-101", client: "Acme Corp (Design Retainer)", amountUsd: 150.00, dueDate: "2026-11-25" },
  { id: "INV-102", client: "Globex Ltd (Bug Fixes)", amountUsd: 85.00, dueDate: "2026-11-28" },
  { id: "INV-103", client: "Nile Tech (API Integration)", amountUsd: 220.00, dueDate: "2026-12-02" },
];

// ---------- Helpers ----------
function fmtUsd(v: number): string {
  return v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtUgx(v: number): string {
  return v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString("en-UG", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function generateRef(): string {
  return "PB-" + Math.floor(1000 + Math.random() * 9000);
}

function calcFee(amountUsd: number): { feeUsd: number; feeUgx: number; netUgx: number } {
  let feeUsd = amountUsd * INTRO_FEE_RATE;
  let feeUgx = feeUsd * PLANNING_RATE;
  const minFeeUsd = MIN_FEE_UGX / PLANNING_RATE;
  if (feeUgx < MIN_FEE_UGX) {
    feeUgx = MIN_FEE_UGX;
    feeUsd = minFeeUsd;
  }
  const maxFeeUsd = amountUsd * MAX_FEE_RATE;
  if (feeUsd > maxFeeUsd) {
    feeUsd = maxFeeUsd;
    feeUgx = feeUsd * PLANNING_RATE;
  }
  const netUgx = amountUsd * PLANNING_RATE - feeUgx;
  return { feeUsd, feeUgx, netUgx };
}

function showToast(message: string, type: "success" | "error" | "info" = "info"): void {
  const container = document.getElementById("toast-container");
  if (!container) return;
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.textContent = message;
  container.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 300);
  }, 3000);
}

function showLoading(show: boolean): void {
  const overlay = document.getElementById("loading-overlay");
  if (!overlay) return;
  overlay.style.display = show ? "flex" : "none";
}

// ---------- State ----------
let state: AppState = {
  user: null,
  paybridgeBalanceUsd: 0,
  accountBalanceUsd: 0,
  transactions: [],
  pendingInvoices: [...DEFAULT_INVOICES],
};

function loadState(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      state = JSON.parse(raw);
    }
  } catch {
    // ignore, use defaults
  }
  if (!state.user) state.user = null;
  if (!state.transactions) state.transactions = [];
  if (typeof state.paybridgeBalanceUsd !== "number") state.paybridgeBalanceUsd = 0;
  if (typeof state.accountBalanceUsd !== "number") state.accountBalanceUsd = 0;
  if (!Array.isArray(state.pendingInvoices)) {
    state.pendingInvoices = [...DEFAULT_INVOICES];
  }
}

function saveState(): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// ---------- Nav helpers ----------
function setActiveNav(activeId: string): void {
  document.querySelectorAll(".nav-link").forEach((el) => {
    el.classList.remove("active");
  });
  const el = document.getElementById(activeId);
  if (el) el.classList.add("active");
}

function initNavbar(): void {
  const navUserEl = document.getElementById("nav-user");
  if (!navUserEl) return;

  if (state.user) {
    navUserEl.textContent = state.user.name;
  } else {
    navUserEl.textContent = "User";
  }

  const path = window.location.pathname;
  const file = path.split("/").pop() || "index.html";

  const linkMap: Record<string, string | null> = {
    "dashboard.html": "nav-dashboard",
    "cashout.html": "nav-cashout",
    "invoice.html": "nav-invoice",
    "index.html": null,
    "signin-out.html": null,
    "receipt.html": null,
  };

  const activeId = linkMap[file];
  if (activeId) setActiveNav(activeId);

  const logoutBtn = document.getElementById("nav-logout");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", (e) => {
      e.preventDefault();
      state = { user: null, paybridgeBalanceUsd: 0, accountBalanceUsd: 0, transactions: [], pendingInvoices: [...DEFAULT_INVOICES] };
      saveState();
      showToast("Logged out", "info");
      window.location.href = "index.html";
    });
  }
}

// ---------- Auth ----------
function initAuth(): void {
  const signInForm = document.getElementById("signin-form");
  const signUpForm = document.getElementById("signup-form");
  if (!signInForm && !signUpForm) return;

  const tabSignIn = document.getElementById("tab-signin");
  const tabSignUp = document.getElementById("tab-signup");
  const formSignIn = document.getElementById("form-signin");
  const formSignUp = document.getElementById("form-signup");

  if (tabSignIn && tabSignUp && formSignIn && formSignUp) {
    tabSignIn.addEventListener("click", () => {
      tabSignIn.classList.add("active");
      tabSignUp.classList.remove("active");
      formSignIn.classList.add("active");
      formSignIn.classList.remove("hidden");
      formSignUp.classList.remove("active");
      formSignUp.classList.add("hidden");
    });
    tabSignUp.addEventListener("click", () => {
      tabSignUp.classList.add("active");
      tabSignIn.classList.remove("active");
      formSignUp.classList.add("active");
      formSignUp.classList.remove("hidden");
      formSignIn.classList.remove("active");
      formSignIn.classList.add("hidden");
    });
  }

  if (signInForm) {
    signInForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const identifier = (document.getElementById("signin-identifier") as HTMLInputElement).value.trim();
      const password = (document.getElementById("signin-password") as HTMLInputElement).value.trim();
      const network = (document.getElementById("signin-network") as HTMLSelectElement).value as Network;

      if (!identifier || !password) {
        showToast("Please enter your phone/email and password", "error");
        return;
      }

      showLoading(true);
      setTimeout(() => {
        showLoading(false);
        loadState();
        const user = state.user;
        const match =
          user &&
          (user.phone === identifier || user.email === identifier) &&
          user.network === network &&
          user.password === password;
        if (match) {
          showToast(`Welcome back, ${user.name}.`, "success");
          saveState();
          window.location.href = "dashboard.html";
        } else {
          showToast("Invalid phone/email, password, or network. Create an account below.", "error");
        }
      }, 800);
    });
  }

  if (signUpForm) {
    signUpForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const name = (document.getElementById("signup-name") as HTMLInputElement).value.trim();
      const email = (document.getElementById("signup-email") as HTMLInputElement).value.trim();
      const phone = (document.getElementById("signup-phone") as HTMLInputElement).value.trim();
      const password = (document.getElementById("signup-password") as HTMLInputElement).value.trim();
      const network = (document.getElementById("signup-network") as HTMLSelectElement).value as Network;

      if (!name || !email || !phone || !password) {
        showToast("Please fill in all fields", "error");
        return;
      }

      if (password.length < 6) {
        showToast("Password must be at least 6 characters", "error");
        return;
      }

      showLoading(true);
      setTimeout(() => {
        showLoading(false);
        state.user = { name, email, phone, network, password, verified: true };
        state.paybridgeBalanceUsd = 120.0; // Initial cashable balance
        state.accountBalanceUsd = 0.0;   // Actual account balance starts at 0
        state.pendingInvoices = [...DEFAULT_INVOICES];
        state.transactions = [
          {
            id: "tx-001",
            type: "receive",
            amountUsd: 120,
            amountUgx: 450000,
            feeUsd: 4.2,
            feeUgx: 15750,
            netUgx: 434250,
            status: "completed",
            createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
            reference: "PB-1041",
            network: "MTN",
            description: "Received funds",
          },
        ];
        saveState();
        showToast("Account created. Welcome to PayBridge.", "success");
        window.location.href = "dashboard.html";
      }, 1200);
    });
  }
}

// ---------- Dashboard ----------
function initDashboard(): void {
  const pbUsdEl = document.getElementById("paybridge-balance-usd");
  const pbUgxEl = document.getElementById("paybridge-balance-ugx");
  const accUsdEl = document.getElementById("account-balance-usd");
  const accUgxEl = document.getElementById("account-balance-ugx");
  const txListEl = document.getElementById("tx-list");
  if (!pbUsdEl || !pbUgxEl || !accUsdEl || !accUgxEl || !txListEl) return;

  loadState();

  pbUsdEl.textContent = `$${fmtUsd(state.paybridgeBalanceUsd)}`;
  pbUgxEl.textContent = `UGX ${fmtUgx(Math.round(state.paybridgeBalanceUsd * PLANNING_RATE))}`;

  accUsdEl.textContent = `$${fmtUsd(state.accountBalanceUsd)}`;
  accUgxEl.textContent = `UGX ${fmtUgx(Math.round(state.accountBalanceUsd * PLANNING_RATE))}`;

  txListEl.innerHTML = "";
  if (state.transactions.length === 0) {
    txListEl.innerHTML = `
      <div class="empty">No transactions yet.</div>
    `;
    return;
  }
  [...state.transactions]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .forEach((tx) => {
      const el = document.createElement("div");
      el.className = `tx-item ${tx.type}`;
      const sign = tx.type === "receive" ? "+" : "-";
      const title = tx.description || (tx.type === "receive" ? "Funds Received" : "Cash Out to Mobile Money");
      el.innerHTML = `
        <div class="tx-info">
          <div class="tx-title">${title}</div>
          <div class="tx-meta">${tx.network}  ·  ${fmtDate(tx.createdAt)}  ·  Ref: ${tx.reference}</div>
        </div>
        <div class="tx-amount ${tx.type === "receive" ? "text-green" : "text-dark"}">
          ${sign} UGX ${fmtUgx(tx.amountUgx)} ($${fmtUsd(tx.amountUsd)})
        </div>
      `;
      txListEl.appendChild(el);
    });
}

// ---------- Cash Out ----------
function initCashout(): void {
  const cashoutAmountEl = document.getElementById("cashout-amount") as HTMLInputElement;
  const previewAmountEl = document.getElementById("preview-amount");
  const feeUsdEl = document.getElementById("fee-usd")!;
  const netUgxEl = document.getElementById("net-ugx")!;
  const confirmBtn = document.getElementById("confirm-cashout") as HTMLButtonElement;
  if (!cashoutAmountEl || !feeUsdEl || !netUgxEl || !confirmBtn) return;

  loadState();

  function updateFeePreview(): void {
    const raw = cashoutAmountEl.value.trim();
    const amount = parseFloat(raw);
    if (!amount || amount <= 0) {
      if (previewAmountEl) previewAmountEl.textContent = "$0.00";
      feeUsdEl.textContent = "–";
      netUgxEl.textContent = "–";
      confirmBtn.disabled = true;
      return;
    }
    const { feeUsd, netUgx } = calcFee(amount);
    if (previewAmountEl) previewAmountEl.textContent = `$${fmtUsd(amount)}`;
    feeUsdEl.textContent = `$${fmtUsd(feeUsd)}`;
    netUgxEl.textContent = `UGX ${fmtUgx(Math.round(netUgx))}`;
    
    // Check against PayBridge cashable balance
    if (amount > state.paybridgeBalanceUsd) {
      confirmBtn.disabled = true;
      confirmBtn.title = "Exceeds PayBridge cashable balance";
    } else {
      confirmBtn.disabled = false;
      confirmBtn.title = "";
    }
  }

  cashoutAmountEl.addEventListener("input", updateFeePreview);

  confirmBtn.addEventListener("click", () => {
    if (!state.user) return;
    const amount = parseFloat(cashoutAmountEl.value.trim());
    if (!amount || amount <= 0) return;

    if (amount > state.paybridgeBalanceUsd) {
      showToast("Insufficient PayBridge cashable balance", "error");
      return;
    }

    const { feeUsd, feeUgx, netUgx } = calcFee(amount);

    showLoading(true);
    setTimeout(() => {
      showLoading(false);
      const tx: Transaction = {
        id: "tx-" + Date.now(),
        type: "cash_out",
        amountUsd: amount,
        amountUgx: Math.round(amount * PLANNING_RATE),
        feeUsd,
        feeUgx: Math.round(feeUgx),
        netUgx: Math.round(netUgx),
        status: "completed",
        createdAt: new Date().toISOString(),
        reference: generateRef(),
        network: state.user!.network,
        description: "Cash Out to Mobile Money",
      };

      // Reduce PayBridge cashable balance and add to actual account balance
      state.paybridgeBalanceUsd -= amount;
      state.accountBalanceUsd += amount;
      state.transactions.push(tx);
      saveState();

      showToast("Cash out successful", "success");
      window.location.href = "receipt.html";
    }, 1500);
  });
}

// ---------- Invoice ----------
function initInvoice(): void {
  const invoiceContainer = document.getElementById("invoice-container") || document.querySelector(".invoice-card");
  if (!invoiceContainer) return;

  loadState();

  invoiceContainer.innerHTML = `
    <h3>Pending Service Buyer Invoices</h3>
    <div class="invoice-tabs" style="display: flex; gap: 10px; margin-bottom: 16px;">
      <button class="tab active" style="padding: 6px 12px; font-weight: 600;">Pending (${state.pendingInvoices.length})</button>
    </div>
    <div id="invoice-list-container">
      ${state.pendingInvoices.length === 0 ? '<p class="empty">No pending invoices.</p>' : ''}
      <div id="pending-invoices">
        ${state.pendingInvoices.map(inv => `
          <div class="tx-item" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; padding: 12px; border: 1px solid #e2e8f0; border-radius: 12px;">
            <div>
              <div style="font-weight: 700;">${inv.client}</div>
              <div style="font-size: 0.8rem; color: #718096;">ID: ${inv.id} · Due: ${inv.dueDate}</div>
            </div>
            <div style="text-align: right;">
              <div style="font-weight: 700; margin-bottom: 6px;">$${fmtUsd(inv.amountUsd)}</div>
              <button class="btn btn-primary pay-invoice-btn" data-id="${inv.id}" style="padding: 6px 12px; font-size: 0.85rem; width: auto;">Pay Now</button>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
    <div style="margin-top: 24px; border-top: 1px solid #e2e8f0; padding-top: 16px;">
      <h4 style="font-size: 0.95rem; margin-bottom: 8px;">Pay Custom Invoice Amount</h4>
      <form id="invoice-form">
        <div class="form-group">
          <label for="invoice-amount">Amount (USD)</label>
          <input type="number" id="invoice-amount" name="amount" step="0.01" min="0" placeholder="100.00" required />
        </div>
        <button type="submit" class="btn pay-btn pay-card" style="background: #00a67d; color: #fff;">Pay Custom Amount</button>
      </form>
    </div>
    <p class="note">PayBridge Cashable Balance: $${fmtUsd(state.paybridgeBalanceUsd)}</p>
  `;

  document.querySelectorAll(".pay-invoice-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const invId = (e.currentTarget as HTMLElement).getAttribute("data-id");
      const invIndex = state.pendingInvoices.findIndex(i => i.id === invId);
      if (invIndex === -1) return;

      const inv = state.pendingInvoices[invIndex];
      if (!state.user) {
        showToast("Please sign in first", "error");
        return;
      }

      if (inv.amountUsd > state.paybridgeBalanceUsd) {
        showToast(`Insufficient PayBridge balance. You need $${fmtUsd(inv.amountUsd)} but have $${fmtUsd(state.paybridgeBalanceUsd)}.`, "error");
        return;
      }

      showLoading(true);
      setTimeout(() => {
        showLoading(false);

        state.paybridgeBalanceUsd -= inv.amountUsd;
        state.transactions.push({
          id: "tx-" + Date.now(),
          type: "cash_out",
          amountUsd: inv.amountUsd,
          amountUgx: Math.round(inv.amountUsd * PLANNING_RATE),
          feeUsd: 0,
          feeUgx: 0,
          netUgx: Math.round(inv.amountUsd * PLANNING_RATE),
          status: "completed",
          createdAt: new Date().toISOString(),
          reference: generateRef(),
          network: state.user!.network,
          description: `Invoice Paid: ${inv.id}`,
        });

        state.pendingInvoices.splice(invIndex, 1);
        saveState();
        showToast(`Invoice ${inv.id} paid successfully ($${fmtUsd(inv.amountUsd)})`, "success");
        initInvoice();
      }, 1000);
    });
  });

  const invoiceForm = document.getElementById("invoice-form");
  invoiceForm?.addEventListener("submit", (e) => {
    e.preventDefault();
    const invoiceAmountEl = document.getElementById("invoice-amount") as HTMLInputElement | null;
    const amount = parseFloat(invoiceAmountEl?.value.trim() || "0");

    if (!amount || amount <= 0) {
      showToast("Enter a valid amount", "error");
      return;
    }
    if (!state.user) {
      showToast("Please sign in first", "error");
      return;
    }

    if (amount > state.paybridgeBalanceUsd) {
      showToast(`Insufficient PayBridge balance to pay $${fmtUsd(amount)}.`, "error");
      return;
    }

    const user = state.user!;
    showLoading(true);
    setTimeout(() => {
      showLoading(false);

      state.paybridgeBalanceUsd -= amount;
      state.transactions.push({
        id: "tx-" + Date.now(),
        type: "cash_out",
        amountUsd: amount,
        amountUgx: Math.round(amount * PLANNING_RATE),
        feeUsd: 0,
        feeUgx: 0,
        netUgx: Math.round(amount * PLANNING_RATE),
        status: "completed",
        createdAt: new Date().toISOString(),
        reference: generateRef(),
        network: user.network,
        description: "Custom Invoice Payment",
      });

      saveState();
      showToast(`Invoice payment of $${fmtUsd(amount)} processed`, "success");
      window.location.href = "dashboard.html";
    }, 1200);
  });
}

// ---------- Receipt ----------
function initReceipt(): void {
  const receiptRefEl = document.getElementById("receipt-ref");
  const receiptAmountEl = document.getElementById("receipt-amount");
  const receiptFeeEl = document.getElementById("receipt-fee");
  const receiptNetEl = document.getElementById("receipt-net");
  const receiptNetworkEl = document.getElementById("receipt-network");
  if (!receiptRefEl || !receiptAmountEl || !receiptFeeEl || !receiptNetEl || !receiptNetworkEl) return;

  loadState();

  const last = state.transactions[state.transactions.length - 1];
  if (!last) return;
  receiptRefEl.textContent = last.reference;
  receiptAmountEl.textContent = `UGX ${fmtUgx(last.amountUgx)}`;
  receiptFeeEl.textContent = `UGX ${fmtUgx(last.feeUgx)}`;
  receiptNetEl.textContent = `UGX ${fmtUgx(last.netUgx)}`;
  receiptNetworkEl.textContent = last.network;
}

// ---------- Init ----------
loadState();
initNavbar();
initAuth();
initDashboard();
initCashout();
initInvoice();
initReceipt();
