import { DemoApiError, demoEngine } from "@/mocks/demoEngine";
import type {
  ConnectionMode,
  CreateTransferRequest,
  ErrorResponse,
  FaultRuleDto,
  Institution,
  Network,
  NetworkDirectory,
  RegisterInstitutionRequest,
  TraceResponse,
  TransferResponse,
} from "./types";

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/+$/, "");

function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(path), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  if (res.status === 204) {
    return undefined as T;
  }

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const err = data as ErrorResponse | null;
    throw new ApiClientError(
      res.status,
      err?.code ?? `HTTP_${res.status}`,
      err?.message ?? res.statusText ?? "Request failed",
    );
  }
  return data as T;
}

function wrapDemo<T>(fn: () => T): Promise<T> {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      try {
        resolve(fn());
      } catch (e) {
        if (e instanceof DemoApiError) {
          reject(new ApiClientError(e.status, e.code, e.message));
        } else {
          reject(e);
        }
      }
    }, 90);
  });
}

export function createFinSimApi(mode: ConnectionMode) {
  const isDemo = mode === "demo";

  return {
    listInstitutions(): Promise<Institution[]> {
      return isDemo
        ? wrapDemo(() => demoEngine.listInstitutions())
        : requestJson<Institution[]>("/api/v1/institutions");
    },

    registerInstitution(req: RegisterInstitutionRequest): Promise<Institution> {
      return isDemo
        ? wrapDemo(() => demoEngine.registerInstitution(req))
        : requestJson<Institution>("/api/v1/institutions", {
            method: "POST",
            body: JSON.stringify(req),
          });
    },

    listNetworks(): Promise<Network[]> {
      return isDemo
        ? wrapDemo(() => demoEngine.listNetworks())
        : requestJson<Network[]>("/api/v1/networks");
    },

    getNetworkDirectory(networkId: string): Promise<NetworkDirectory> {
      return isDemo
        ? wrapDemo(() => demoEngine.getNetworkDirectory(networkId))
        : requestJson<NetworkDirectory>(`/api/v1/networks/${encodeURIComponent(networkId)}/directory`);
    },

    addNetworkMember(networkId: string, institutionId: string): Promise<Network> {
      return isDemo
        ? wrapDemo(() => demoEngine.addNetworkMember(networkId, institutionId))
        : requestJson<Network>(`/api/v1/networks/${encodeURIComponent(networkId)}/members`, {
            method: "POST",
            body: JSON.stringify({ institutionId }),
          });
    },

    listFaults(): Promise<FaultRuleDto[]> {
      return isDemo
        ? wrapDemo(() => demoEngine.listFaults())
        : requestJson<FaultRuleDto[]>("/api/v1/faults");
    },

    addFault(rule: FaultRuleDto): Promise<FaultRuleDto> {
      return isDemo
        ? wrapDemo(() => demoEngine.addFault(rule))
        : requestJson<FaultRuleDto>("/api/v1/faults", {
            method: "POST",
            body: JSON.stringify(rule),
          });
    },

    deleteFault(faultId: string): Promise<void> {
      return isDemo
        ? wrapDemo(() => demoEngine.deleteFault(faultId))
        : requestJson<void>(`/api/v1/faults/${encodeURIComponent(faultId)}`, {
            method: "DELETE",
          });
    },

    createTransfer(
      networkId: string,
      idempotencyKey: string,
      body: CreateTransferRequest,
    ): Promise<TransferResponse> {
      return isDemo
        ? wrapDemo(() => demoEngine.createTransfer(networkId, idempotencyKey, body))
        : requestJson<TransferResponse>(
            `/api/v1/networks/${encodeURIComponent(networkId)}/transfers`,
            {
              method: "POST",
              headers: { "Idempotency-Key": idempotencyKey },
              body: JSON.stringify(body),
            },
          );
    },

    getTransfer(transactionId: string): Promise<TransferResponse> {
      return isDemo
        ? wrapDemo(() => demoEngine.getTransfer(transactionId))
        : requestJson<TransferResponse>(`/api/v1/transfers/${encodeURIComponent(transactionId)}`);
    },

    getTrace(transactionId: string): Promise<TraceResponse> {
      return isDemo
        ? wrapDemo(() => demoEngine.getTrace(transactionId))
        : requestJson<TraceResponse>(
            `/api/v1/transfers/${encodeURIComponent(transactionId)}/trace`,
          );
    },

    resolveTransfer(transactionId: string): Promise<TransferResponse> {
      return isDemo
        ? wrapDemo(() => demoEngine.resolveTransfer(transactionId))
        : requestJson<TransferResponse>(
            `/api/v1/transfers/${encodeURIComponent(transactionId)}/resolve`,
            { method: "POST" },
          );
    },
  };
}
