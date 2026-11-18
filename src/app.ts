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
  invoiceId?: string;
  clientName?: string;
}

interface Invoice {
  id: string;
  clientName: string;
  createdByName: string;
  amountUsd: number;
  description: string;
  status: "pending" | "settled";
  createdAt: string;
  settledAt?: string;
  reference?: string;
  paidVia?: string;
}

interface AppState {
  user: User | null;
  paybridgeBalanceUsd: number; // Funds received / available to cash out
  accountBalanceUsd: number;   // Legacy field kept for compatibility with other pages
  transactions: Transaction[];
  invoices: Invoice[];
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

function invoiceCreatorName(inv: Invoice): string {
  return inv.createdByName || state.user?.name || "a PayBridge user";
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
  invoices: [],
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
  if (!Array.isArray(state.invoices)) {
    state.invoices = [];
  }
  // Older invoices may not have the creator name stored on them.
  state.invoices.forEach((inv) => {
    if (!inv.createdByName && state.user) {
      inv.createdByName = state.user.name;
    }
  });
  // Drop legacy pendingInvoices seeded by older prototype versions
  if ((state as any).pendingInvoices) {
    delete (state as any).pendingInvoices;
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
      state = { user: null, paybridgeBalanceUsd: 0, accountBalanceUsd: 0, transactions: [], invoices: [] };
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
        state.accountBalanceUsd = 0.0;
        state.invoices = [];
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

  const deliveredUgx = state.transactions
    .filter((tx) => tx.type === "cash_out" && tx.status === "completed")
    .reduce((sum, tx) => sum + tx.netUgx, 0);
  accUsdEl.textContent = `$${fmtUsd(deliveredUgx / PLANNING_RATE)}`;
  accUgxEl.textContent = `UGX ${fmtUgx(deliveredUgx)}`;

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
      const isCashOut = tx.type === "cash_out";
      const sign = isCashOut ? "-" : "+";
      const title = tx.description || (isCashOut ? "Cash Out to Mobile Money" : "Funds Received");
      const shownUgx = isCashOut ? tx.netUgx : tx.amountUgx;
      const shownUsd = isCashOut ? tx.netUgx / PLANNING_RATE : tx.amountUsd;
      const feeLine =
        isCashOut && tx.amountUsd > 0
          ? `<div class="tx-meta" style="color: #b7791f;">After ${(Math.round((tx.feeUsd / tx.amountUsd) * 1000) / 10).toFixed(1)}% fee (USD ${fmtUsd(tx.feeUsd)})</div>`
          : "";
      el.innerHTML = `
        <div class="tx-info">
          <div class="tx-title">${title}</div>
          <div class="tx-meta">${tx.network}  ·  ${fmtDate(tx.createdAt)}  ·  Ref: ${tx.reference}</div>
          ${feeLine}
        </div>
        <div class="tx-amount ${isCashOut ? "text-dark" : "text-green"}">
          ${sign} UGX ${fmtUgx(shownUgx)} ($${fmtUsd(shownUsd)})
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
let invoiceFilter: "pending" | "settled" | "all" = "pending";
let invoiceSearchTerm = "";

function generateInvoiceId(): string {
  const existing = new Set(state.invoices.map((i) => i.id));
  for (let n = 0; n < 100; n++) {
    const id = `INV-${Math.floor(1000 + Math.random() * 9000)}`;
    if (!existing.has(id)) return id;
  }
  return `INV-${Date.now().toString().slice(-6)}`;
}

function invoicePaymentLink(invoiceId: string): string {
  const base = window.location.href.replace(/[^/]*$/, "client-pay.html");
  return `${base}#inv=${encodeURIComponent(invoiceId)}`;
}

function renderInvoiceList(): void {
  const listEl = document.getElementById("invoice-list");
  if (!listEl) return;

  const term = invoiceSearchTerm.trim().toLowerCase();
  const filtered = state.invoices
    .filter((inv) => invoiceFilter === "all" || inv.status === invoiceFilter)
    .filter((inv) => {
      if (!term) return true;
      return (
        inv.id.toLowerCase().includes(term) ||
        inv.clientName.toLowerCase().includes(term) ||
        inv.description.toLowerCase().includes(term)
      );
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  if (filtered.length === 0) {
    const msg =
      state.invoices.length === 0
        ? "No invoices yet. Generate your first invoice above."
        : "No invoices match this filter.";
    listEl.innerHTML = `<div class="empty">${msg}</div>`;
    return;
  }

  listEl.innerHTML = filtered
    .map((inv) => {
      const statusLabel = inv.status === "pending" ? "Pending" : "Settled";
      const statusColor = inv.status === "pending" ? "#b7791f" : "#00a67d";
      const link = invoicePaymentLink(inv.id);
      const linkBlock =
        inv.status === "pending"
          ? `
            <div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid #e2e8f0;">
              <div style="font-size: 0.8rem; color: #718096; margin-bottom: 4px;">Payment link</div>
              <div style="font-size: 0.85rem; word-break: break-all; color: #1a366a; margin-bottom: 8px;">${link}</div>
              <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                <button type="button" class="btn btn-secondary invoice-copy-btn" data-id="${inv.id}" style="width: auto; padding: 6px 10px; font-size: 0.85rem;">Copy link</button>
                <a href="${link}" target="_blank" rel="noopener" class="btn btn-primary" style="width: auto; padding: 6px 10px; font-size: 0.85rem; display: inline-block; text-align: center;">Open link</a>
              </div>
            </div>
          `
          : `
            <div style="margin-top: 8px; font-size: 0.8rem; color: #718096;">
              Settled ${inv.settledAt ? fmtDate(inv.settledAt) : ""}${inv.reference ? ` · Ref: ${inv.reference}` : ""}
            </div>
          `;

      return `
        <div class="card" style="margin-bottom: 12px;">
          <div style="display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; flex-wrap: wrap;">
            <div>
              <div style="font-weight: 700; font-size: 1rem;">${inv.clientName}</div>
              <div style="font-size: 0.85rem; color: #718096; margin-top: 2px;">${inv.description}</div>
              <div style="font-size: 0.8rem; color: #718096; margin-top: 4px;">${inv.id} · Created ${fmtDate(inv.createdAt)}</div>
            </div>
            <div style="text-align: right;">
              <div style="font-weight: 700;">$${fmtUsd(inv.amountUsd)}</div>
              <div style="font-size: 0.8rem; font-weight: 700; color: ${statusColor}; margin-top: 4px;">${statusLabel}</div>
            </div>
          </div>
          ${linkBlock}
        </div>
      `;
    })
    .join("");

  listEl.querySelectorAll(".invoice-copy-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = (btn as HTMLElement).getAttribute("data-id");
      const inv = state.invoices.find((i) => i.id === id);
      if (!inv) return;
      const link = invoicePaymentLink(inv.id);
      try {
        await navigator.clipboard.writeText(link);
        showToast("Payment link copied", "success");
      } catch {
        const input = document.createElement("input");
        input.value = link;
        document.body.appendChild(input);
        input.select();
        document.execCommand("copy");
        document.body.removeChild(input);
        showToast("Payment link copied", "success");
      }
    });
  });
}

function initInvoice(): void {
  const createForm = document.getElementById("invoice-create-form");
  const listEl = document.getElementById("invoice-list");
  if (!createForm || !listEl) return;

  loadState();

  const resultEl = document.getElementById("invoice-link-result");
  const linkTextEl = document.getElementById("invoice-link-text");
  const copyBtn = document.getElementById("invoice-copy-link") as HTMLButtonElement | null;
  const openLinkEl = document.getElementById("invoice-open-link") as HTMLAnchorElement | null;
  const searchEl = document.getElementById("invoice-search") as HTMLInputElement | null;
  const filterBtns = document.querySelectorAll("[data-filter]");

  createForm.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!state.user) {
      showToast("Please sign in first", "error");
      return;
    }
    const clientEl = document.getElementById("invoice-client") as HTMLInputElement | null;
    const amountEl = document.getElementById("invoice-amount") as HTMLInputElement | null;
    const descEl = document.getElementById("invoice-description") as HTMLInputElement | null;
    const clientName = clientEl?.value.trim() || "";
    const amount = parseFloat(amountEl?.value.trim() || "0");
    const description = descEl?.value.trim() || "";

    if (!clientName || !description || !amount || amount <= 0) {
      showToast("Please fill in all fields with a valid amount", "error");
      return;
    }

    const invoice: Invoice = {
      id: generateInvoiceId(),
      clientName,
      createdByName: state.user.name,
      amountUsd: amount,
      description,
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    state.invoices.push(invoice);
    saveState();

    const link = invoicePaymentLink(invoice.id);
    if (linkTextEl) linkTextEl.textContent = link;
    if (openLinkEl) openLinkEl.href = link;
    if (resultEl) resultEl.classList.remove("hidden");

    (createForm as HTMLFormElement).reset();
    showToast(`Invoice ${invoice.id} created`, "success");
    invoiceFilter = "pending";
    updateInvoiceFilterTabs();
    renderInvoiceList();
  });

  copyBtn?.addEventListener("click", async () => {
    const link = linkTextEl?.textContent || "";
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      showToast("Payment link copied", "success");
    } catch {
      showToast("Copy failed. Select the link and copy it manually.", "error");
    }
  });

  function updateInvoiceFilterTabs(): void {
    filterBtns.forEach((b) => {
      const f = (b as HTMLElement).getAttribute("data-filter");
      b.classList.toggle("active", f === invoiceFilter);
    });
  }

  filterBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const f = (btn as HTMLElement).getAttribute("data-filter") as "pending" | "settled" | "all" | null;
      if (!f) return;
      invoiceFilter = f;
      updateInvoiceFilterTabs();
      renderInvoiceList();
    });
  });

  searchEl?.addEventListener("input", () => {
    invoiceSearchTerm = searchEl.value;
    renderInvoiceList();
  });

  updateInvoiceFilterTabs();
  renderInvoiceList();
}

// ---------- Client pay (payer view) ----------
function initClientPay(): void {
  const container = document.getElementById("client-pay-container") as HTMLElement | null;
  if (!container) return;
  const root: HTMLElement = container;

  loadState();

  const hash = window.location.hash.replace(/^#/, "");
  const invId = new URLSearchParams(hash).get("inv") || "";
  let found = state.invoices.find((i) => i.id === invId);

  // Fallback: if the link id is missing or mangled, open the newest pending invoice.
  if (!found) {
    found = state.invoices
      .filter((i) => i.status === "pending")
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  }

  if (!found) {
    container.innerHTML = `
      <div class="card">
        <h2 style="font-size: 1.1rem; margin-bottom: 8px;">Invoice not found</h2>
        <p style="color: #718096;">This link does not match any PayBridge invoice.</p>
      </div>
    `;
    return;
  }
  const inv: Invoice = found;

  if (inv.status === "settled") {
    renderPaidState(root, inv);
    return;
  }

  const fromName = invoiceCreatorName(inv);

  root.innerHTML = `
    <div class="card">
      <div style="font-size: 0.85rem; color: #718096; margin-bottom: 4px;">Payment request</div>
      <h2 style="font-size: 1.25rem; margin-bottom: 2px;">Invoice ${inv.id}</h2>
      <div style="font-size: 0.85rem; color: #718096; margin-bottom: 20px;">Invoice from <strong>${fromName}</strong> (Uganda)</div>

      <div class="receipt-detail"><span class="label">For</span><span class="value">${inv.description}</span></div>
      <div class="receipt-detail"><span class="label">Amount</span><span class="value">$${fmtUsd(inv.amountUsd)}</span></div>
      <div class="receipt-detail"><span class="label">Rate</span><span class="value">1 USD = UGX ${fmtUgx(PLANNING_RATE)}</span></div>

      <div style="margin-top: 24px; display: flex; gap: 12px; flex-wrap: wrap;">
        <button type="button" class="btn btn-primary" id="client-pay-card" style="width: auto;">Pay by card</button>
        <button type="button" class="btn btn-secondary" id="client-pay-bank" style="width: auto;">Pay by bank transfer</button>
      </div>
      <p class="note" style="margin-top: 16px;">Funds delivered to the recipient's mobile money within 30 minutes of clearing.</p>

      <div id="client-trust" style="margin-top: 20px; padding-top: 16px; border-top: 1px solid #e2e8f0;">
        <div style="font-weight: 700; font-size: 0.9rem; margin-bottom: 6px;">Why is this safe?</div>
        <p style="font-size: 0.85rem; color: #718096; line-height: 1.5;">
          Settlement is handled by a Bank of Uganda-licensed payment service provider. PayBridge acts as its disclosed
          agent under the National Payment Systems Act, 2020. You will receive a receipt.
        </p>
      </div>
      <div style="margin-top: 16px; font-size: 0.8rem; color: #718096;">PayBridge, secure payments to Uganda</div>
    </div>
  `;

  function showConfirm(method: "card" | "bank"): void {
    const label = method === "card" ? "card" : "bank transfer";
    root.innerHTML = `
      <div class="card">
        <div style="font-size: 0.85rem; color: #718096; margin-bottom: 8px;">Confirm payment</div>
        <h2 style="font-size: 1.15rem; margin-bottom: 16px;">Check the details</h2>
        <p style="font-size: 0.95rem; line-height: 1.6; margin-bottom: 24px;">
          You are paying <strong>$${fmtUsd(inv.amountUsd)}</strong> to <strong>${fromName}</strong> for
          <strong>${inv.description}</strong>. Invoice ${inv.id}, by ${label}.
        </p>
        <div style="display: flex; gap: 12px; flex-wrap: wrap;">
          <button type="button" class="btn btn-primary" id="client-confirm" style="width: auto;">Confirm payment</button>
          <button type="button" class="btn btn-secondary" id="client-cancel" style="width: auto;">Cancel</button>
        </div>
      </div>
    `;

    document.getElementById("client-cancel")?.addEventListener("click", () => {
      window.location.reload();
    });

    document.getElementById("client-confirm")?.addEventListener("click", () => {
      showLoading(true);
      setTimeout(() => {
        showLoading(false);
        loadState();
        const target = state.invoices.find((i) => i.id === inv.id);
        if (!target) return;
        if (target.status === "settled") {
          renderPaidState(root, target);
          return;
        }

        const ref = generateRef();
        target.status = "settled";
        target.settledAt = new Date().toISOString();
        target.reference = ref;
        target.paidVia = label;

        state.paybridgeBalanceUsd += target.amountUsd;
        state.transactions.push({
          id: "tx-" + Date.now(),
          type: "receive",
          amountUsd: target.amountUsd,
          amountUgx: Math.round(target.amountUsd * PLANNING_RATE),
          feeUsd: 0,
          feeUgx: 0,
          netUgx: Math.round(target.amountUsd * PLANNING_RATE),
          status: "completed",
          createdAt: new Date().toISOString(),
          reference: ref,
          network: state.user?.network || "MTN",
          description: `Invoice ${target.id} paid by ${target.clientName}`,
          invoiceId: target.id,
          clientName: target.clientName,
        });
        saveState();
        renderPaidState(root, target);
        showToast("Payment sent", "success");
      }, 1200);
    });
  }

  document.getElementById("client-pay-card")?.addEventListener("click", () => showConfirm("card"));
  document.getElementById("client-pay-bank")?.addEventListener("click", () => showConfirm("bank"));
}

function renderPaidState(container: HTMLElement, inv: Invoice): void {
  const fromName = invoiceCreatorName(inv);
  container.innerHTML = `
    <div class="card" id="client-receipt">
      <div style="font-size: 0.85rem; color: #00a67d; font-weight: 700; margin-bottom: 6px;">Payment sent</div>
      <h2 style="font-size: 1.25rem; margin-bottom: 4px;">Receipt</h2>
      <div style="font-size: 0.85rem; color: #718096; margin-bottom: 20px;">Invoice ${inv.id}</div>

      <div class="receipt-detail"><span class="label">Paid to</span><span class="value">${fromName} (Uganda)</span></div>
      <div class="receipt-detail"><span class="label">For</span><span class="value">${inv.description}</span></div>
      <div class="receipt-detail"><span class="label">Paid via</span><span class="value">${inv.paidVia || "card"}</span></div>
      <div class="receipt-detail"><span class="label">Amount</span><span class="value">$${fmtUsd(inv.amountUsd)}</span></div>
      <div class="receipt-detail"><span class="label">Rate</span><span class="value">1 USD = UGX ${fmtUgx(PLANNING_RATE)}</span></div>
      <div class="receipt-detail final"><span class="label">Reference</span><span class="value">${inv.reference || ""}</span></div>

      <p class="note" style="margin-top: 16px;">Keep this reference. Funds are delivered to the recipient's mobile money within 30 minutes of clearing.</p>

      <div style="margin-top: 20px;">
        <button type="button" class="btn btn-secondary" id="client-print" style="width: auto;">Print receipt</button>
      </div>
      <div style="margin-top: 16px; font-size: 0.8rem; color: #718096;">PayBridge, secure payments to Uganda</div>
    </div>
  `;

  document.getElementById("client-print")?.addEventListener("click", () => window.print());
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
initClientPay();
initReceipt();
