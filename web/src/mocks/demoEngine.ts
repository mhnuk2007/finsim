import type {
  CreateTransferRequest,
  FaultRuleDto,
  Institution,
  Network,
  NetworkDirectory,
  RegisterInstitutionRequest,
  TraceEventDto,
  TraceResponse,
  TransferResponse,
} from "@/api/types";

export class DemoApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

interface DemoState {
  institutions: Institution[];
  networks: Network[];
  faults: FaultRuleDto[];
  transfers: Map<string, TransferResponse>;
  traces: Map<string, TraceEventDto[]>;
  idempotencyIndex: Map<string, { fingerprint: string; transactionId: string }>;
  balances: Map<string, number>;
  seq: number;
  faultSeq: number;
}

function createInitialState(): DemoState {
  const institutions: Institution[] = [
    {
      id: "bank-a",
      name: "Synthetic Bank A",
      type: "BANK",
      baseUrl: "http://localhost:9001",
      capabilities: ["ACCOUNT_DEBIT", "ACCOUNT_CREDIT", "STATUS_QUERY"],
      status: "ACTIVE",
      provenance: "SYNTHETIC",
    },
    {
      id: "bank-b",
      name: "Synthetic Bank B",
      type: "BANK",
      baseUrl: "http://localhost:9002",
      capabilities: ["ACCOUNT_DEBIT", "ACCOUNT_CREDIT", "STATUS_QUERY"],
      status: "ACTIVE",
      provenance: "SYNTHETIC",
    },
  ];

  const networks: Network[] = [
    {
      id: "sandbox",
      name: "FinSim Sandbox Network",
      currencies: ["USD"],
      memberIds: ["bank-a", "bank-b"],
      scheme: { id: "sandbox-v1", workflow: "wf.transfer.v1" },
      provenance: "SYNTHETIC",
    },
  ];

  const balances = new Map<string, number>([
    ["bank-a:ACC-1", 1000.0],
    ["bank-a:ACC-2", 500.0],
    ["bank-b:ACC-1", 1000.0],
    ["bank-b:ACC-2", 500.0],
  ]);

  return {
    institutions,
    networks,
    faults: [],
    transfers: new Map(),
    traces: new Map(),
    idempotencyIndex: new Map(),
    balances,
    seq: 1,
    faultSeq: 1,
  };
}

let state: DemoState = createInitialState();

export function resetDemoEngine(): void {
  state = createInitialState();
}

export function getDemoBalances(): Record<string, number> {
  return Object.fromEntries(state.balances.entries());
}

export function listDemoTransfers(): TransferResponse[] {
  return Array.from(state.transfers.values()).reverse();
}

function accountKey(inst: string, acc: string): string {
  return `${inst}:${acc}`;
}

function nowIso(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

function consumeMatchingFault(target: string): FaultRuleDto | null {
  const idx = state.faults.findIndex((f) => f.target === target);
  if (idx === -1) return null;

  const rule = state.faults[idx];
  const prob = rule.probability ?? 1.0;
  if (prob < 1.0 && Math.random() > prob) {
    return null;
  }

  if (rule.times !== undefined && rule.times !== null) {
    if (rule.times <= 1) {
      state.faults.splice(idx, 1);
    } else {
      state.faults[idx] = { ...rule, times: rule.times - 1 };
    }
  }
  return rule;
}

export const demoEngine = {
  listInstitutions(): Institution[] {
    return [...state.institutions];
  },

  registerInstitution(req: RegisterInstitutionRequest): Institution {
    if (!req.id.trim() || !req.name.trim() || !req.baseUrl.trim()) {
      throw new DemoApiError(400, "BAD_REQUEST", "id, name, and baseUrl are required.");
    }
    const existing = state.institutions.find((i) => i.id === req.id);
    if (existing) {
      if (existing.baseUrl === req.baseUrl && existing.name === req.name) {
        return existing;
      }
      throw new DemoApiError(
        409,
        "INSTITUTION_CONFLICT",
        `Institution '${req.id}' already exists with a different definition.`,
      );
    }
    const created: Institution = {
      id: req.id.trim(),
      name: req.name.trim(),
      type: req.type,
      baseUrl: req.baseUrl.trim(),
      capabilities: req.capabilities,
      status: "ACTIVE",
      provenance: "SYNTHETIC",
    };
    state.institutions.push(created);
    return created;
  },

  listNetworks(): Network[] {
    return [...state.networks];
  },

  getNetworkDirectory(networkId: string): NetworkDirectory {
    const net = state.networks.find((n) => n.id === networkId);
    if (!net) {
      throw new DemoApiError(404, "NOT_FOUND", `Network '${networkId}' not found.`);
    }
    const participants = state.institutions.filter(
      (i) => net.memberIds.includes(i.id) && i.status === "ACTIVE",
    );
    return {
      networkId: net.id,
      name: net.name,
      currencies: net.currencies,
      participants,
    };
  },

  addNetworkMember(networkId: string, institutionId: string): Network {
    const net = state.networks.find((n) => n.id === networkId);
    if (!net) {
      throw new DemoApiError(404, "NOT_FOUND", `Network '${networkId}' not found.`);
    }
    const inst = state.institutions.find((i) => i.id === institutionId);
    if (!inst) {
      throw new DemoApiError(404, "NOT_FOUND", `Institution '${institutionId}' not found.`);
    }
    if (!net.memberIds.includes(institutionId)) {
      net.memberIds = [...net.memberIds, institutionId];
    }
    return { ...net };
  },

  listFaults(): FaultRuleDto[] {
    return [...state.faults];
  },

  addFault(rule: FaultRuleDto): FaultRuleDto {
    if (!rule.target.trim()) {
      throw new DemoApiError(400, "BAD_REQUEST", "target institution is required.");
    }
    const created: FaultRuleDto = {
      ...rule,
      faultId: `flt-${String(state.faultSeq++).padStart(4, "0")}`,
      probability: rule.probability ?? 1.0,
    };
    state.faults.push(created);
    return created;
  },

  deleteFault(faultId: string): void {
    const idx = state.faults.findIndex((f) => f.faultId === faultId);
    if (idx === -1) {
      throw new DemoApiError(404, "NOT_FOUND", `Fault '${faultId}' not found.`);
    }
    state.faults.splice(idx, 1);
  },

  createTransfer(
    networkId: string,
    idempotencyKey: string,
    req: CreateTransferRequest,
  ): TransferResponse {
    if (!idempotencyKey.trim()) {
      throw new DemoApiError(400, "BAD_REQUEST", "Idempotency-Key header is required.");
    }
    if (!req.reference.trim()) {
      throw new DemoApiError(400, "BAD_REQUEST", "reference must not be blank.");
    }
    const amountNum = Number(req.money.amount);
    if (Number.isNaN(amountNum) || amountNum <= 0) {
      throw new DemoApiError(400, "BAD_REQUEST", "amount must be a positive decimal string.");
    }

    const fingerprint = JSON.stringify({ networkId, req });
    const prev = state.idempotencyIndex.get(idempotencyKey);
    if (prev) {
      if (prev.fingerprint !== fingerprint) {
        throw new DemoApiError(
          409,
          "IDEMPOTENCY_CONFLICT",
          `Idempotency-Key '${idempotencyKey}' was already used with a different request body.`,
        );
      }
      const existing = state.transfers.get(prev.transactionId)!;
      if (existing.state === "UNKNOWN") {
        throw new DemoApiError(
          409,
          "RECONCILIATION_REQUIRED",
          `Transfer '${existing.transactionId}' is UNKNOWN and must be resolved before retry.`,
        );
      }
      return existing;
    }

    const txId = `tx-${String(state.seq++).padStart(5, "0")}`;
    const events: TraceEventDto[] = [];
    const stages: TransferResponse["stageHistory"] = [];

    let t = 0;
    const step = (ms: number) => {
      t += ms;
      return nowIso(t);
    };

    events.push({ at: step(0), kind: "STAGE", stage: "VALIDATION" });
    events.push({
      at: step(4),
      kind: "STATE_CHANGE",
      stage: "VALIDATION",
      fromState: "CREATED",
      toState: "ACCEPTED",
    });
    stages.push({
      stage: "VALIDATION",
      outcome: "PASSED",
      at: nowIso(t),
      details: `Verified members on network '${networkId}'`,
    });

    events.push({
      at: step(3),
      kind: "STATE_CHANGE",
      stage: "DEBIT_LEG",
      fromState: "ACCEPTED",
      toState: "IN_PROGRESS",
    });
    events.push({ at: step(2), kind: "STAGE", stage: "DEBIT_LEG" });

    // Evaluate DEBIT fault on source
    const debitFault = consumeMatchingFault(req.from.institutionId);
    const debitReqPayload = {
      transactionId: txId,
      leg: "DEBIT",
      accountReference: req.from.accountReference,
      money: req.money,
      reference: req.reference,
      provenance: "SYNTHETIC",
    };

    if (debitFault) {
      events.push({
        at: step(2),
        kind: "FAULT_INJECTED",
        stage: "DEBIT_LEG",
        target: req.from.institutionId,
        faultId: debitFault.faultId,
      });
    }

    if (debitFault?.type === "TIMEOUT") {
      events.push({
        at: step(120),
        kind: "OUTBOUND_CALL",
        stage: "DEBIT_LEG",
        target: req.from.institutionId,
        request: debitReqPayload,
        response: { error: "SOCKET_TIMEOUT", message: "Injected TIMEOUT fault on DEBIT leg" },
        durationMs: 120,
      });
      events.push({
        at: step(2),
        kind: "STATE_CHANGE",
        stage: "DEBIT_LEG",
        fromState: "IN_PROGRESS",
        toState: "UNKNOWN",
      });
      stages.push({
        stage: "DEBIT_LEG",
        outcome: "UNKNOWN",
        at: nowIso(t),
        details: `Timeout calling ${req.from.institutionId}; reconciliation required`,
      });
      const transfer: TransferResponse = {
        transactionId: txId,
        state: "UNKNOWN",
        currentStage: "DEBIT_LEG",
        reasonCode: null,
        emittedBy: null,
        pendingAction: "NONE",
        needsManualReview: false,
        from: req.from,
        to: req.to,
        money: req.money,
        reference: req.reference,
        stageHistory: stages,
        provenance: "SYNTHETIC",
      };
      state.transfers.set(txId, transfer);
      state.traces.set(txId, events);
      state.idempotencyIndex.set(idempotencyKey, { fingerprint, transactionId: txId });
      return transfer;
    }

    const fromKey = accountKey(req.from.institutionId, req.from.accountReference);
    const fromBal = state.balances.get(fromKey) ?? 1000.0;
    const debitDelay = debitFault?.type === "DELAY" ? debitFault.delayMs ?? 350 : 28;

    if (fromBal < amountNum) {
      events.push({
        at: step(debitDelay),
        kind: "OUTBOUND_CALL",
        stage: "DEBIT_LEG",
        target: req.from.institutionId,
        request: debitReqPayload,
        response: { status: "REJECTED", reasonCode: "AM04", message: "Insufficient funds" },
        durationMs: debitDelay,
      });
      events.push({
        at: step(2),
        kind: "STATE_CHANGE",
        stage: "DEBIT_LEG",
        fromState: "IN_PROGRESS",
        toState: "REJECTED",
      });
      stages.push({
        stage: "DEBIT_LEG",
        outcome: "REJECTED",
        at: nowIso(t),
        details: `Source rejected debit with AM04 (balance ${fromBal.toFixed(2)})`,
      });
      const transfer: TransferResponse = {
        transactionId: txId,
        state: "REJECTED",
        currentStage: "DEBIT_LEG",
        reasonCode: "AM04",
        emittedBy: "SOURCE",
        pendingAction: "NONE",
        needsManualReview: false,
        from: req.from,
        to: req.to,
        money: req.money,
        reference: req.reference,
        stageHistory: stages,
        provenance: "SYNTHETIC",
      };
      state.transfers.set(txId, transfer);
      state.traces.set(txId, events);
      state.idempotencyIndex.set(idempotencyKey, { fingerprint, transactionId: txId });
      return transfer;
    }

    // Apply debit
    state.balances.set(fromKey, Number((fromBal - amountNum).toFixed(2)));
    events.push({
      at: step(debitDelay),
      kind: "OUTBOUND_CALL",
      stage: "DEBIT_LEG",
      target: req.from.institutionId,
      request: debitReqPayload,
      response: { status: "COMPLETED", leg: "DEBIT", idempotentReplay: false },
      durationMs: debitDelay,
    });
    if (debitFault?.type === "DUPLICATE_DELIVERY") {
      events.push({
        at: step(18),
        kind: "OUTBOUND_CALL",
        stage: "DEBIT_LEG",
        target: req.from.institutionId,
        request: debitReqPayload,
        response: { status: "COMPLETED", leg: "DEBIT", idempotentReplay: true },
        durationMs: 18,
      });
    }
    stages.push({
      stage: "DEBIT_LEG",
      outcome: "COMPLETED",
      at: nowIso(t),
      details: `Debited ${req.money.amount} ${req.money.currency} at ${req.from.institutionId}`,
    });

    // CREDIT leg
    events.push({ at: step(3), kind: "STAGE", stage: "CREDIT_LEG" });
    const creditFault = consumeMatchingFault(req.to.institutionId);
    const creditReqPayload = {
      transactionId: txId,
      leg: "CREDIT",
      accountReference: req.to.accountReference,
      money: req.money,
      reference: req.reference,
      provenance: "SYNTHETIC",
    };

    if (creditFault) {
      events.push({
        at: step(2),
        kind: "FAULT_INJECTED",
        stage: "CREDIT_LEG",
        target: req.to.institutionId,
        faultId: creditFault.faultId,
      });
    }

    if (creditFault?.type === "TIMEOUT") {
      events.push({
        at: step(140),
        kind: "OUTBOUND_CALL",
        stage: "CREDIT_LEG",
        target: req.to.institutionId,
        request: creditReqPayload,
        response: { error: "SOCKET_TIMEOUT", message: "Injected TIMEOUT fault on CREDIT leg" },
        durationMs: 140,
      });
      events.push({
        at: step(2),
        kind: "STATE_CHANGE",
        stage: "CREDIT_LEG",
        fromState: "IN_PROGRESS",
        toState: "UNKNOWN",
      });
      stages.push({
        stage: "CREDIT_LEG",
        outcome: "UNKNOWN",
        at: nowIso(t),
        details: `Timeout calling ${req.to.institutionId}; debit applied, credit outcome unknown (ADR 0001)`,
      });
      const transfer: TransferResponse = {
        transactionId: txId,
        state: "UNKNOWN",
        currentStage: "CREDIT_LEG",
        reasonCode: null,
        emittedBy: null,
        pendingAction: "RETRY_CREDIT",
        needsManualReview: false,
        from: req.from,
        to: req.to,
        money: req.money,
        reference: req.reference,
        stageHistory: stages,
        provenance: "SYNTHETIC",
      };
      state.transfers.set(txId, transfer);
      state.traces.set(txId, events);
      state.idempotencyIndex.set(idempotencyKey, { fingerprint, transactionId: txId });
      return transfer;
    }

    const toKey = accountKey(req.to.institutionId, req.to.accountReference);
    const toBal = state.balances.get(toKey) ?? 500.0;
    const creditDelay = creditFault?.type === "DELAY" ? creditFault.delayMs ?? 350 : 32;
    state.balances.set(toKey, Number((toBal + amountNum).toFixed(2)));

    events.push({
      at: step(creditDelay),
      kind: "OUTBOUND_CALL",
      stage: "CREDIT_LEG",
      target: req.to.institutionId,
      request: creditReqPayload,
      response: { status: "COMPLETED", leg: "CREDIT", idempotentReplay: false },
      durationMs: creditDelay,
    });
    if (creditFault?.type === "DUPLICATE_DELIVERY") {
      events.push({
        at: step(16),
        kind: "OUTBOUND_CALL",
        stage: "CREDIT_LEG",
        target: req.to.institutionId,
        request: creditReqPayload,
        response: { status: "COMPLETED", leg: "CREDIT", idempotentReplay: true },
        durationMs: 16,
      });
    }

    events.push({
      at: step(2),
      kind: "STATE_CHANGE",
      stage: "COMPLETION",
      fromState: "IN_PROGRESS",
      toState: "COMPLETED",
    });
    stages.push({
      stage: "CREDIT_LEG",
      outcome: "COMPLETED",
      at: nowIso(t),
      details: `Credited ${req.money.amount} ${req.money.currency} at ${req.to.institutionId}`,
    });

    const transfer: TransferResponse = {
      transactionId: txId,
      state: "COMPLETED",
      currentStage: "COMPLETION",
      reasonCode: null,
      emittedBy: null,
      pendingAction: "NONE",
      needsManualReview: false,
      from: req.from,
      to: req.to,
      money: req.money,
      reference: req.reference,
      stageHistory: stages,
      provenance: "SYNTHETIC",
    };
    state.transfers.set(txId, transfer);
    state.traces.set(txId, events);
    state.idempotencyIndex.set(idempotencyKey, { fingerprint, transactionId: txId });
    return transfer;
  },

  getTransfer(transactionId: string): TransferResponse {
    const tx = state.transfers.get(transactionId);
    if (!tx) {
      throw new DemoApiError(404, "NOT_FOUND", `Transfer '${transactionId}' not found.`);
    }
    return tx;
  },

  getTrace(transactionId: string): TraceResponse {
    const events = state.traces.get(transactionId);
    if (!events) {
      throw new DemoApiError(404, "NOT_FOUND", `Trace for '${transactionId}' not found.`);
    }
    return { transactionId, events: [...events] };
  },

  resolveTransfer(transactionId: string): TransferResponse {
    const tx = state.transfers.get(transactionId);
    if (!tx) {
      throw new DemoApiError(404, "NOT_FOUND", `Transfer '${transactionId}' not found.`);
    }
    if (tx.state !== "UNKNOWN") {
      return tx;
    }

    const events = state.traces.get(transactionId) ?? [];
    let t = 0;
    const step = (ms: number) => {
      t += ms;
      return nowIso(t);
    };

    events.push({ at: step(0), kind: "STAGE", stage: "RESOLUTION" });

    // Case 1: DEBIT leg timed out -> query source -> 404 -> REJECTED FINSIM_TIMEOUT
    if (tx.currentStage === "DEBIT_LEG") {
      const stillFaulted = consumeMatchingFault(tx.from.institutionId);
      if (stillFaulted?.type === "TIMEOUT") {
        events.push({
          at: step(5),
          kind: "FAULT_INJECTED",
          stage: "RESOLUTION",
          target: tx.from.institutionId,
          faultId: stillFaulted.faultId,
        });
        events.push({
          at: step(110),
          kind: "OUTBOUND_CALL",
          stage: "RESOLUTION",
          target: tx.from.institutionId,
          request: { method: "GET", path: `/finsim/v1/payments/${transactionId}?leg=DEBIT` },
          response: { error: "SOCKET_TIMEOUT", message: "Status query timed out; stays UNKNOWN" },
          durationMs: 110,
        });
        return tx;
      }

      events.push({
        at: step(24),
        kind: "OUTBOUND_CALL",
        stage: "RESOLUTION",
        target: tx.from.institutionId,
        request: { method: "GET", path: `/finsim/v1/payments/${transactionId}?leg=DEBIT` },
        response: { status: 404, message: "Leg not found at source; nothing applied" },
        durationMs: 24,
      });
      events.push({
        at: step(3),
        kind: "STATE_CHANGE",
        stage: "RESOLUTION",
        fromState: "UNKNOWN",
        toState: "REJECTED",
      });
      const updated: TransferResponse = {
        ...tx,
        state: "REJECTED",
        currentStage: "RESOLUTION",
        reasonCode: "FINSIM_TIMEOUT",
        emittedBy: "FINSIM",
        pendingAction: "NONE",
        stageHistory: [
          ...tx.stageHistory,
          {
            stage: "RESOLUTION",
            outcome: "REJECTED",
            at: nowIso(t),
            details: "Source confirmed DEBIT not applied (404); marked REJECTED (FINSIM_TIMEOUT)",
          },
        ],
      };
      state.transfers.set(transactionId, updated);
      return updated;
    }

    // Case 2: CREDIT leg timed out -> query destination -> 404 -> forward recovery re-send CREDIT with same Idempotency-Key
    const destFault = consumeMatchingFault(tx.to.institutionId);
    if (destFault?.type === "TIMEOUT") {
      events.push({
        at: step(5),
        kind: "FAULT_INJECTED",
        stage: "RESOLUTION",
        target: tx.to.institutionId,
        faultId: destFault.faultId,
      });
      events.push({
        at: step(120),
        kind: "OUTBOUND_CALL",
        stage: "RESOLUTION",
        target: tx.to.institutionId,
        request: { method: "GET", path: `/finsim/v1/payments/${transactionId}?leg=CREDIT` },
        response: { error: "SOCKET_TIMEOUT", message: "Destination unreachable; remains UNKNOWN" },
        durationMs: 120,
      });
      return tx;
    }

    events.push({
      at: step(22),
      kind: "OUTBOUND_CALL",
      stage: "RESOLUTION",
      target: tx.to.institutionId,
      request: { method: "GET", path: `/finsim/v1/payments/${transactionId}?leg=CREDIT` },
      response: { status: 404, message: "Credit leg never arrived; safe to retry with same Idempotency-Key" },
      durationMs: 22,
    });

    const amountNum = Number(tx.money.amount);
    const toKey = accountKey(tx.to.institutionId, tx.to.accountReference);
    const toBal = state.balances.get(toKey) ?? 500.0;
    state.balances.set(toKey, Number((toBal + amountNum).toFixed(2)));

    events.push({
      at: step(34),
      kind: "OUTBOUND_CALL",
      stage: "RESOLUTION",
      target: tx.to.institutionId,
      request: {
        transactionId,
        leg: "CREDIT",
        accountReference: tx.to.accountReference,
        money: tx.money,
        reference: tx.reference,
        retry: true,
      },
      response: { status: "COMPLETED", leg: "CREDIT", forwardRecovery: true },
      durationMs: 34,
    });
    events.push({
      at: step(3),
      kind: "STATE_CHANGE",
      stage: "RESOLUTION",
      fromState: "UNKNOWN",
      toState: "COMPLETED",
    });

    const updated: TransferResponse = {
      ...tx,
      state: "COMPLETED",
      currentStage: "RESOLUTION",
      pendingAction: "NONE",
      stageHistory: [
        ...tx.stageHistory,
        {
          stage: "RESOLUTION",
          outcome: "COMPLETED",
          at: nowIso(t),
          details: `Forward-recovered CREDIT at ${tx.to.institutionId} per ADR 0001`,
        },
      ],
    };
    state.transfers.set(transactionId, updated);
    return updated;
  },
};
