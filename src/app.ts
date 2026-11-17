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
}

interface AppState {
  user: User | null;
  balanceUsd: number;
  transactions: Transaction[];
}

const PLANNING_RATE = 3750; // UGX per USD
const INTRO_FEE_RATE = 0.035; // 3.5% intro
const MIN_FEE_UGX = 3000;
const MAX_FEE_RATE = 0.05; // 5% ceiling

const STORAGE_KEY = "paybridge_prototype_v1";

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
  balanceUsd: 0,
  transactions: [],
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
  if (typeof state.balanceUsd !== "number") state.balanceUsd = 0;
}

function saveState(): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// ---------- Nav helpers (only on pages with navbar) ----------
function setActiveNav(activeId: string): void {
  document.querySelectorAll(".nav-link").forEach((el) => {
    el.classList.remove("active");
  });
  const el = document.getElementById(activeId);
  if (el) el.classList.add("active");
}

function initNavbar(): void {
  const navUserEl = document.getElementById("nav-user");
  if (!navUserEl) return; // no navbar on this page (e.g. landing)

  if (state.user) {
    navUserEl.textContent = state.user.name;
  } else {
    navUserEl.textContent = "User";
  }

  // Determine which nav link should be active based on current page
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

  // Logout handler
  const logoutBtn = document.getElementById("nav-logout");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", (e) => {
      e.preventDefault();
      state = { user: null, balanceUsd: 0, transactions: [] };
      saveState();
      showToast("Logged out", "info");
      window.location.href = "index.html";
    });
  }
}

// ---------- Auth (only on landing page) ----------
function initAuth(): void {
  const signInForm = document.getElementById("signin-form");
  const signUpForm = document.getElementById("signup-form");
  if (!signInForm && !signUpForm) return;

  // Tab switching
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

  // Sign In
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

  // Sign Up
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
        state.balanceUsd = 120.0;
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
          },
        ];
        saveState();
        showToast("Account created. Welcome to PayBridge.", "success");
        window.location.href = "dashboard.html";
      }, 1200);
    });
  }
}

// ---------- Dashboard (only on dashboard page) ----------
function initDashboard(): void {
  const balanceUsdEl = document.getElementById("balance-usd");
  const balanceUgxEl = document.getElementById("balance-ugx");
  const txListEl = document.getElementById("tx-list");
  if (!balanceUsdEl || !balanceUgxEl || !txListEl) return;

  loadState();

  balanceUsdEl.textContent = fmtUsd(state.balanceUsd);
  balanceUgxEl.textContent = fmtUgx(Math.round(state.balanceUsd * PLANNING_RATE));

  txListEl.innerHTML = "";
  if (state.transactions.length === 0) {
    txListEl.innerHTML = `
      <div class="empty">No transactions yet. Your first cash-out will appear here.</div>
    `;
    return;
  }
  [...state.transactions]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .forEach((tx) => {
      const el = document.createElement("div");
      el.className = `tx-item ${tx.type}`;
      const sign = tx.type === "receive" ? "+" : "-";
      el.innerHTML = `
        <div class="tx-info">
          <div class="tx-title">${tx.type === "receive" ? "Funds Received" : "Cash Out to Mobile Money"}</div>
          <div class="tx-meta">${tx.network}  ·  ${fmtDate(tx.createdAt)}  ·  Ref: ${tx.reference}</div>
        </div>
        <div class="tx-amount ${tx.type === "receive" ? "text-green" : "text-dark"}">
          ${sign} UGX ${fmtUgx(tx.amountUgx)}
        </div>
      `;
      txListEl.appendChild(el);
    });
}

// ---------- Cash Out (only on cashout page) ----------
function initCashout(): void {
  const cashoutAmountEl = document.getElementById("cashout-amount") as HTMLInputElement;
  const feeUsdEl = document.getElementById("fee-usd")!;
  const feeUgxEl = document.getElementById("fee-ugx")!;
  const netUgxEl = document.getElementById("net-ugx")!;
  const confirmBtn = document.getElementById("confirm-cashout") as HTMLButtonElement;
  if (!cashoutAmountEl || !feeUsdEl || !feeUgxEl || !netUgxEl || !confirmBtn) return;

  loadState();

  function updateFeePreview(): void {
    const raw = cashoutAmountEl.value.trim();
    const amount = parseFloat(raw);
    if (!amount || amount <= 0) {
      feeUsdEl.textContent = "–";
      feeUgxEl.textContent = "–";
      netUgxEl.textContent = "–";
      confirmBtn.disabled = true;
      return;
    }
    const { feeUsd, feeUgx, netUgx } = calcFee(amount);
    feeUsdEl.textContent = fmtUsd(feeUsd);
    feeUgxEl.textContent = fmtUgx(Math.round(feeUgx));
    netUgxEl.textContent = fmtUgx(Math.round(netUgx));
    confirmBtn.disabled = amount > state.balanceUsd;
    confirmBtn.title = amount > state.balanceUsd ? "Insufficient balance" : "";
  }

  cashoutAmountEl.addEventListener("input", updateFeePreview);

  confirmBtn.addEventListener("click", () => {
    if (!state.user) return;
    const amount = parseFloat(cashoutAmountEl.value.trim());
    if (!amount || amount <= 0) return;
    const { feeUsd, feeUgx, netUgx } = calcFee(amount);
    if (amount > state.balanceUsd) {
      showToast("Insufficient balance", "error");
      return;
    }

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
      };
      state.balanceUsd -= amount;
      state.transactions.push(tx);
      saveState();
      showToast("Cash out successful", "success");
      window.location.href = "receipt.html";
    }, 1500);
  });
}

// ---------- Invoice (only on invoice page) ----------
function initInvoice(): void {
  const invoiceForm = document.getElementById("invoice-form");
  const invoiceAmountEl = document.getElementById("invoice-amount") as HTMLInputElement | null;
  if (!invoiceForm || !invoiceAmountEl) return;

  loadState();

  invoiceForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const amount = parseFloat(invoiceAmountEl.value.trim());
    if (!amount || amount <= 0) {
      showToast("Enter a valid amount", "error");
      return;
    }
    if (!state.user) {
      showToast("Please sign in first", "error");
      return;
    }
    const user = state.user!;
    showLoading(true);
    setTimeout(() => {
      showLoading(false);
      state.balanceUsd += amount;
      state.transactions.push({
        id: "tx-" + Date.now(),
        type: "receive",
        amountUsd: amount,
        amountUgx: Math.round(amount * PLANNING_RATE),
        feeUsd: 0,
        feeUgx: 0,
        netUgx: Math.round(amount * PLANNING_RATE),
        status: "completed",
        createdAt: new Date().toISOString(),
        reference: generateRef(),
        network: user.network,
      });
      saveState();
      showToast(`Payment of $${fmtUsd(amount)} received`, "success");
      window.location.href = "dashboard.html";
    }, 1500);
  });
}

// ---------- Receipt (only on receipt page) ----------
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
