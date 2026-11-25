/**
 * TypeScript contracts mirroring FinSim backend DTOs 1:1:
 * - finsim-api: TransferDtos, FaultRuleDto
 * - finsim-registry: Institution, Network, NetworkDirectory
 * - finsim-core: TransferState, PendingAction
 * - finsim-sim: FaultType
 */

export type TransferState =
  | "CREATED"
  | "ACCEPTED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "REJECTED"
  | "UNKNOWN";

export type PendingAction = "NONE" | "RETRY_CREDIT" | "REVERSE_DEBIT";

export type FaultType = "DELAY" | "TIMEOUT" | "DUPLICATE_DELIVERY";

export type Capability = "ACCOUNT_DEBIT" | "ACCOUNT_CREDIT" | "STATUS_QUERY";

export type InstitutionType = "BANK" | "MERCHANT" | "PAYMENT_GATEWAY" | "CUSTOM";

export type InstitutionStatus = "ACTIVE" | "SUSPENDED";

export type TraceEventKind =
  | "STAGE"
  | "STATE_CHANGE"
  | "FAULT_INJECTED"
  | "OUTBOUND_CALL";

export interface AccountRefDto {
  institutionId: string;
  accountReference: string;
}

export interface MoneyDto {
  amount: string;
  currency: string;
}

export interface CreateTransferRequest {
  from: AccountRefDto;
  to: AccountRefDto;
  money: MoneyDto;
  reference: string;
}

export interface StageEntryDto {
  stage: string;
  outcome: string;
  at: string;
  details: string | null;
}

export interface TransferResponse {
  transactionId: string;
  state: TransferState;
  currentStage: string;
  reasonCode: string | null;
  emittedBy: string | null;
  pendingAction: PendingAction;
  needsManualReview: boolean;
  from: AccountRefDto;
  to: AccountRefDto;
  money: MoneyDto;
  reference: string;
  stageHistory: StageEntryDto[];
  provenance: string;
}

export interface TraceEventDto {
  at: string;
  kind: TraceEventKind;
  stage: string;
  target?: string;
  request?: unknown;
  response?: unknown;
  durationMs?: number;
  faultId?: string;
  fromState?: TransferState;
  toState?: TransferState;
}

export interface TraceResponse {
  transactionId: string;
  events: TraceEventDto[];
}

export interface ErrorResponse {
  code: string;
  message: string;
  stage?: string;
  emittedBy?: string;
  traceId?: string;
}

export interface FaultRuleDto {
  faultId?: string;
  target: string;
  type: FaultType;
  delayMs?: number;
  probability?: number;
  times?: number;
  seed?: number;
}

export interface Institution {
  id: string;
  name: string;
  type: InstitutionType;
  baseUrl: string;
  capabilities: Capability[];
  status: InstitutionStatus;
  provenance: string;
}

export interface RegisterInstitutionRequest {
  id: string;
  name: string;
  type: InstitutionType;
  baseUrl: string;
  capabilities: Capability[];
}

export interface Scheme {
  id: string;
  workflow: string;
}

export interface Network {
  id: string;
  name: string;
  currencies: string[];
  memberIds: string[];
  scheme: Scheme;
  provenance: string;
}

export interface NetworkDirectory {
  networkId: string;
  name: string;
  currencies: string[];
  participants: Institution[];
}

export type ConnectionMode = "demo" | "live";
