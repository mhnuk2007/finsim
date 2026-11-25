package io.github.mhnuk2007.finsim.transfer.internal;

import io.github.mhnuk2007.finsim.core.AccountRef;
import io.github.mhnuk2007.finsim.core.Emitter;
import io.github.mhnuk2007.finsim.core.Money;
import io.github.mhnuk2007.finsim.core.PendingAction;
import io.github.mhnuk2007.finsim.core.ReasonCode;
import io.github.mhnuk2007.finsim.core.StageOutcome;
import io.github.mhnuk2007.finsim.core.Transfer;
import io.github.mhnuk2007.finsim.core.TransferState;
import io.github.mhnuk2007.finsim.faults.FaultService;
import io.github.mhnuk2007.finsim.registry.Capability;
import io.github.mhnuk2007.finsim.registry.Institution;
import io.github.mhnuk2007.finsim.registry.Network;
import io.github.mhnuk2007.finsim.registry.Registry;
import io.github.mhnuk2007.finsim.registry.RegistryException;
import io.github.mhnuk2007.finsim.registry.RegistryExceptions;
import io.github.mhnuk2007.finsim.sim.FaultDecision;
import io.github.mhnuk2007.finsim.sim.FaultType;
import io.github.mhnuk2007.finsim.transfer.TransferDtos.CreateTransferRequest;
import io.github.mhnuk2007.finsim.transfer.internal.ParticipantClient.LegRequestPayload;
import io.github.mhnuk2007.finsim.transfer.internal.ParticipantClient.MoneyPayload;
import io.github.mhnuk2007.finsim.transfer.internal.ParticipantClient.PaymentCallOutcome;
import java.time.Clock;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

@Component
public class TransferOrchestrator {

  private final Registry registry;
  private final ParticipantClient participantClient;
  private final TransferPersistenceHelper persistenceHelper;
  private final TransferTraceRecorder traceRecorder;
  private final FaultService faultService;
  private final Clock clock;

  @Autowired
  public TransferOrchestrator(
      Registry registry,
      ParticipantClient participantClient,
      TransferPersistenceHelper persistenceHelper,
      TransferTraceRecorder traceRecorder,
      FaultService faultService,
      Clock clock) {
    this.registry = registry;
    this.participantClient = participantClient;
    this.persistenceHelper = persistenceHelper;
    this.traceRecorder = traceRecorder;
    this.faultService = faultService;
    this.clock = clock;
  }

  public TransferOrchestrator(
      Registry registry,
      ParticipantClient participantClient,
      TransferPersistenceHelper persistenceHelper,
      FaultService faultService,
      Clock clock) {
    this(registry, participantClient, persistenceHelper, null, faultService, clock);
  }

  public TransferOrchestrator(
      Registry registry,
      ParticipantClient participantClient,
      TransferPersistenceHelper persistenceHelper,
      Clock clock) {
    this(registry, participantClient, persistenceHelper, null, null, clock);
  }

  public TransferOrchestrator(
      Registry registry,
      ParticipantClient participantClient,
      TransferRepository transferRepository,
      TransferStageRepository stageRepository,
      FaultService faultService,
      Clock clock) {
    this(
        registry,
        participantClient,
        new TransferPersistenceHelper(transferRepository, stageRepository),
        null,
        faultService,
        clock);
  }

  public TransferOrchestrator(
      Registry registry,
      ParticipantClient participantClient,
      TransferRepository transferRepository,
      TransferStageRepository stageRepository,
      Clock clock) {
    this(
        registry,
        participantClient,
        new TransferPersistenceHelper(transferRepository, stageRepository),
        null,
        null,
        clock);
  }

  public Transfer orchestrate(
      String transactionId,
      String networkId,
      String idempotencyKey,
      CreateTransferRequest request) {

    AccountRef from =
        new AccountRef(request.from().institutionId(), request.from().accountReference());
    AccountRef to = new AccountRef(request.to().institutionId(), request.to().accountReference());
    Money money = Money.of(request.money().amount(), request.money().currency());

    // 1. Validate routability and network membership
    Institution fromInst;
    Institution toInst;
    try {
      fromInst =
          registry.requireRoutable(networkId, from.institutionId(), Capability.ACCOUNT_DEBIT);
      toInst = registry.requireRoutable(networkId, to.institutionId(), Capability.ACCOUNT_CREDIT);
      Network net = registry.network(networkId);
      if (!net.currencies().contains(money.currency())) {
        return createAndReject(
            transactionId,
            networkId,
            idempotencyKey,
            from,
            to,
            money,
            request.reference(),
            ReasonCode.ROUTING_ERROR.code(),
            Emitter.FINSIM,
            "Currency " + money.currency() + " not supported on network " + networkId);
      }
    } catch (RegistryExceptions.NetworkNotFound ex) {
      throw ex;
    } catch (RegistryExceptions.CapabilityNotSupported ex) {
      return createAndReject(
          transactionId,
          networkId,
          idempotencyKey,
          from,
          to,
          money,
          request.reference(),
          ReasonCode.CAPABILITY_NOT_SUPPORTED.code(),
          Emitter.FINSIM,
          ex.getMessage());
    } catch (RegistryException ex) {
      return createAndReject(
          transactionId,
          networkId,
          idempotencyKey,
          from,
          to,
          money,
          request.reference(),
          ReasonCode.ROUTING_ERROR.code(),
          Emitter.FINSIM,
          ex.getMessage());
    }

    // 2. Initialize Transfer aggregate in CREATED state, transition to ACCEPTED, then IN_PROGRESS
    Instant now = clock.instant();
    Transfer transfer =
        Transfer.create(
            transactionId, networkId, idempotencyKey, from, to, money, request.reference(), now);
    transfer.accept("accepted", clock.instant());
    transfer.startProcessing("debit_source", clock.instant());
    persistTransfer(transfer);

    if (traceRecorder != null) {
      traceRecorder.recordStage(transactionId, "created", now);
      traceRecorder.recordStateChange(transactionId, "created", null, TransferState.CREATED, now);
      traceRecorder.recordStage(transactionId, "accepted", clock.instant());
      traceRecorder.recordStateChange(
          transactionId,
          "accepted",
          TransferState.CREATED,
          TransferState.ACCEPTED,
          clock.instant());
      traceRecorder.recordStage(transactionId, "debit_source", clock.instant());
      traceRecorder.recordStateChange(
          transactionId,
          "debit_source",
          TransferState.ACCEPTED,
          TransferState.IN_PROGRESS,
          clock.instant());
    }

    // 3. Execute Step 1: Outbound DEBIT to source institution
    String debitKey = transactionId + "-debit";
    LegRequestPayload debitPayload =
        new LegRequestPayload(
            transactionId,
            "DEBIT",
            from.accountReference(),
            new MoneyPayload(money.amount().toPlainString(), money.currency()),
            request.reference(),
            null,
            "SYNTHETIC");

    PaymentCallOutcome debitOutcome =
        sendLeg(
            transactionId,
            "debit_source",
            fromInst.id(),
            fromInst.baseUrl(),
            debitKey,
            debitPayload);

    switch (debitOutcome.status()) {
      case REJECTED -> {
        transfer.reject(
            "debit_source",
            debitOutcome.reasonCode(),
            Emitter.SOURCE,
            debitOutcome.errorMessage(),
            clock.instant());
        if (traceRecorder != null) {
          traceRecorder.recordStateChange(
              transactionId,
              "debit_source",
              TransferState.IN_PROGRESS,
              TransferState.REJECTED,
              clock.instant());
        }
        persistTransfer(transfer);
        return transfer;
      }
      case TIMED_OUT -> {
        transfer.markUnknown(
            "debit_source",
            PendingAction.NONE,
            false,
            debitOutcome.errorMessage(),
            clock.instant());
        if (traceRecorder != null) {
          traceRecorder.recordStateChange(
              transactionId,
              "debit_source",
              TransferState.IN_PROGRESS,
              TransferState.UNKNOWN,
              clock.instant());
        }
        persistTransfer(transfer);
        return transfer;
      }
      case COMPLETED -> {
        // Debit succeeded; proceed to CREDIT
      }
    }

    // 4. Execute Step 2: Outbound CREDIT to destination institution
    if (traceRecorder != null) {
      traceRecorder.recordStage(transactionId, "credit_destination", clock.instant());
    }
    String creditKey = transactionId + "-credit";
    LegRequestPayload creditPayload =
        new LegRequestPayload(
            transactionId,
            "CREDIT",
            to.accountReference(),
            new MoneyPayload(money.amount().toPlainString(), money.currency()),
            request.reference(),
            null,
            "SYNTHETIC");

    PaymentCallOutcome creditOutcome =
        sendLeg(
            transactionId,
            "credit_destination",
            toInst.id(),
            toInst.baseUrl(),
            creditKey,
            creditPayload);

    switch (creditOutcome.status()) {
      case COMPLETED -> {
        transfer.complete("credit_destination", clock.instant());
        if (traceRecorder != null) {
          traceRecorder.recordStateChange(
              transactionId,
              "credit_destination",
              TransferState.IN_PROGRESS,
              TransferState.COMPLETED,
              clock.instant());
        }
      }
      case TIMED_OUT -> {
        // A timeout on credit moves the transfer to UNKNOWN (never REJECTED!)
        transfer.markUnknown(
            "credit_destination",
            PendingAction.RETRY_CREDIT,
            false,
            creditOutcome.errorMessage(),
            clock.instant());
        if (traceRecorder != null) {
          traceRecorder.recordStateChange(
              transactionId,
              "credit_destination",
              TransferState.IN_PROGRESS,
              TransferState.UNKNOWN,
              clock.instant());
        }
      }
      case REJECTED -> {
        // Destination definitively rejected credit after debit succeeded.
        // Move to UNKNOWN with REVERSE_DEBIT so compensating reversal can be safely executed.
        String destReason = normalizeRejectionReason(creditOutcome.reasonCode());
        transfer.markUnknown(
            "credit_destination",
            PendingAction.REVERSE_DEBIT,
            false,
            formatRejectionContext(destReason, creditOutcome.errorMessage()),
            clock.instant());
        if (traceRecorder != null) {
          traceRecorder.recordStateChange(
              transactionId,
              "credit_destination",
              TransferState.IN_PROGRESS,
              TransferState.UNKNOWN,
              clock.instant());
        }
        persistTransfer(transfer);
        return executeReversal(transfer, fromInst, destReason);
      }
    }

    persistTransfer(transfer);
    return transfer;
  }

  public Transfer resolve(Transfer transfer) {
    if (transfer.getState() != TransferState.UNKNOWN) {
      return transfer;
    }

    Institution fromInst;
    try {
      fromInst = registry.institution(transfer.getFrom().institutionId());
    } catch (Exception ex) {
      transfer.recordStage(
          "resolve",
          StageOutcome.UNKNOWN,
          "Failed to look up institutions in registry: " + ex.getMessage(),
          clock.instant());
      persistTransfer(transfer);
      return transfer;
    }

    // ADR 0001: Once destination credit was definitively rejected (PendingAction.REVERSE_DEBIT),
    // never query or re-send destination CREDIT; resolve the compensating reversal leg instead.
    if (transfer.getPendingAction() == PendingAction.REVERSE_DEBIT) {
      return resolvePendingReversal(transfer, fromInst);
    }

    Institution toInst;
    try {
      toInst = registry.institution(transfer.getTo().institutionId());
    } catch (Exception ex) {
      transfer.recordStage(
          "resolve",
          StageOutcome.UNKNOWN,
          "Failed to look up institutions in registry: " + ex.getMessage(),
          clock.instant());
      persistTransfer(transfer);
      return transfer;
    }

    // 1. Query debit leg at source institution
    if (traceRecorder != null) {
      traceRecorder.recordStage(transfer.getId(), "query_debit", clock.instant());
    }
    long debitStart = System.currentTimeMillis();
    Instant debitCallAt = clock.instant();
    Optional<ParticipantClient.LegResponsePayload> debitLegOpt;
    try {
      debitLegOpt = participantClient.queryLegStatus(fromInst.baseUrl(), transfer.getId(), "DEBIT");
      if (traceRecorder != null) {
        traceRecorder.recordOutboundCall(
            transfer.getId(),
            "query_debit",
            fromInst.id(),
            Map.of("transactionId", transfer.getId(), "leg", "DEBIT"),
            debitLegOpt.orElse(null),
            System.currentTimeMillis() - debitStart,
            debitCallAt);
      }
    } catch (Exception ex) {
      if (traceRecorder != null) {
        traceRecorder.recordOutboundCall(
            transfer.getId(),
            "query_debit",
            fromInst.id(),
            Map.of("transactionId", transfer.getId(), "leg", "DEBIT"),
            Map.of("error", String.valueOf(ex.getMessage())),
            System.currentTimeMillis() - debitStart,
            debitCallAt);
      }
      // Row 7: Query timed out or errored -> stays UNKNOWN
      transfer.recordStage(
          "query_debit",
          StageOutcome.UNKNOWN,
          "Failed to query debit leg at source: " + ex.getMessage(),
          clock.instant());
      persistTransfer(transfer);
      return transfer;
    }

    // Row 1: Debit leg not found (404) -> Nothing was applied -> REJECTED (FINSIM_TIMEOUT, FINSIM)
    if (debitLegOpt.isEmpty()) {
      transfer.reject(
          "resolve",
          ReasonCode.FINSIM_TIMEOUT.code(),
          Emitter.FINSIM,
          "Debit leg was not found at source institution",
          clock.instant());
      if (traceRecorder != null) {
        traceRecorder.recordStage(transfer.getId(), "resolve", clock.instant());
        traceRecorder.recordStateChange(
            transfer.getId(),
            "resolve",
            TransferState.UNKNOWN,
            TransferState.REJECTED,
            clock.instant());
      }
      persistTransfer(transfer);
      return transfer;
    }

    ParticipantClient.LegResponsePayload debitLeg = debitLegOpt.get();

    // Row 2: Debit leg was REJECTED by source -> REJECTED (source code, SOURCE)
    if ("REJECTED".equalsIgnoreCase(debitLeg.status())) {
      String code =
          debitLeg.reasonCode() != null && !debitLeg.reasonCode().isBlank()
              ? debitLeg.reasonCode()
              : "REJECTED";
      transfer.reject(
          "resolve",
          code,
          Emitter.SOURCE,
          "Debit leg was rejected by source institution",
          clock.instant());
      if (traceRecorder != null) {
        traceRecorder.recordStage(transfer.getId(), "resolve", clock.instant());
        traceRecorder.recordStateChange(
            transfer.getId(),
            "resolve",
            TransferState.UNKNOWN,
            TransferState.REJECTED,
            clock.instant());
      }
      persistTransfer(transfer);
      return transfer;
    }

    // If debit is not COMPLETED, cannot decide -> stays UNKNOWN
    if (!"COMPLETED".equalsIgnoreCase(debitLeg.status())) {
      transfer.recordStage(
          "query_debit",
          StageOutcome.UNKNOWN,
          "Source reported debit status " + debitLeg.status(),
          clock.instant());
      persistTransfer(transfer);
      return transfer;
    }

    // 2. Debit is COMPLETED. Query credit leg at destination institution
    if (traceRecorder != null) {
      traceRecorder.recordStage(transfer.getId(), "query_credit", clock.instant());
    }
    long creditStart = System.currentTimeMillis();
    Instant creditCallAt = clock.instant();
    Optional<ParticipantClient.LegResponsePayload> creditLegOpt;
    try {
      creditLegOpt = participantClient.queryLegStatus(toInst.baseUrl(), transfer.getId(), "CREDIT");
      if (traceRecorder != null) {
        traceRecorder.recordOutboundCall(
            transfer.getId(),
            "query_credit",
            toInst.id(),
            Map.of("transactionId", transfer.getId(), "leg", "CREDIT"),
            creditLegOpt.orElse(null),
            System.currentTimeMillis() - creditStart,
            creditCallAt);
      }
    } catch (Exception ex) {
      if (traceRecorder != null) {
        traceRecorder.recordOutboundCall(
            transfer.getId(),
            "query_credit",
            toInst.id(),
            Map.of("transactionId", transfer.getId(), "leg", "CREDIT"),
            Map.of("error", String.valueOf(ex.getMessage())),
            System.currentTimeMillis() - creditStart,
            creditCallAt);
      }
      // Row 7: Credit query timed out or errored -> stays UNKNOWN
      transfer.recordStage(
          "query_credit",
          StageOutcome.UNKNOWN,
          "Failed to query credit leg at destination: " + ex.getMessage(),
          clock.instant());
      persistTransfer(transfer);
      return transfer;
    }

    // Row 3: Destination credit is COMPLETED -> Both legs applied -> COMPLETED
    if (creditLegOpt.isPresent() && "COMPLETED".equalsIgnoreCase(creditLegOpt.get().status())) {
      transfer.complete("resolve", clock.instant());
      if (traceRecorder != null) {
        traceRecorder.recordStage(transfer.getId(), "resolve", clock.instant());
        traceRecorder.recordStateChange(
            transfer.getId(),
            "resolve",
            TransferState.UNKNOWN,
            TransferState.COMPLETED,
            clock.instant());
      }
      persistTransfer(transfer);
      return transfer;
    }

    // Row 6: Destination credit is ACCEPTED (not yet COMPLETED) -> Destination is still processing
    // -> stays UNKNOWN
    if (creditLegOpt.isPresent() && "ACCEPTED".equalsIgnoreCase(creditLegOpt.get().status())) {
      transfer.updateResolutionStatus(PendingAction.RETRY_CREDIT, false, clock.instant());
      transfer.recordStage(
          "query_credit",
          StageOutcome.UNKNOWN,
          "Destination reported credit status ACCEPTED",
          clock.instant());
      persistTransfer(transfer);
      return transfer;
    }

    // Row 4: Credit not found (404) at destination -> Re-send credit once with the SAME idempotency
    // key
    if (creditLegOpt.isEmpty()) {
      if (traceRecorder != null) {
        traceRecorder.recordStage(transfer.getId(), "resolve_credit", clock.instant());
      }
      String creditKey = transfer.getId() + "-credit";
      LegRequestPayload creditPayload =
          new LegRequestPayload(
              transfer.getId(),
              "CREDIT",
              transfer.getTo().accountReference(),
              new MoneyPayload(
                  transfer.getMoney().amount().toPlainString(), transfer.getMoney().currency()),
              transfer.getReference(),
              null,
              "SYNTHETIC");

      PaymentCallOutcome creditOutcome =
          sendLeg(
              transfer.getId(),
              "resolve_credit",
              toInst.id(),
              toInst.baseUrl(),
              creditKey,
              creditPayload);

      switch (creditOutcome.status()) {
        case COMPLETED -> {
          transfer.complete("resolve_credit", clock.instant());
          if (traceRecorder != null) {
            traceRecorder.recordStateChange(
                transfer.getId(),
                "resolve_credit",
                TransferState.UNKNOWN,
                TransferState.COMPLETED,
                clock.instant());
          }
          persistTransfer(transfer);
          return transfer;
        }
        case TIMED_OUT -> {
          transfer.updateResolutionStatus(PendingAction.RETRY_CREDIT, false, clock.instant());
          transfer.recordStage(
              "resolve_credit",
              StageOutcome.UNKNOWN,
              "Re-sending credit timed out: " + creditOutcome.errorMessage(),
              clock.instant());
          persistTransfer(transfer);
          return transfer;
        }
        case REJECTED -> {
          // Re-send resulted in definitive rejection -> proceed to Row 5 (reversal)
          return executeReversal(transfer, fromInst, creditOutcome.reasonCode());
        }
      }
    }

    // Row 5: Credit was definitively REJECTED by destination -> Reverse debit
    ParticipantClient.LegResponsePayload creditLeg = creditLegOpt.get();
    if ("REJECTED".equalsIgnoreCase(creditLeg.status())) {
      return executeReversal(transfer, fromInst, creditLeg.reasonCode());
    }

    // Any other unexpected state -> stays UNKNOWN
    transfer.recordStage(
        "resolve",
        StageOutcome.UNKNOWN,
        "Ambiguous participant state during resolution",
        clock.instant());
    persistTransfer(transfer);
    return transfer;
  }

  private Transfer resolvePendingReversal(Transfer transfer, Institution fromInst) {
    String destReason = extractPendingReversalReason(transfer);
    String revTxId = transfer.getId() + "-rev";

    if (traceRecorder != null) {
      traceRecorder.recordStage(transfer.getId(), "query_reversal", clock.instant());
    }
    long revStart = System.currentTimeMillis();
    Instant revCallAt = clock.instant();
    Optional<ParticipantClient.LegResponsePayload> revLegOpt;
    try {
      revLegOpt = participantClient.queryLegStatus(fromInst.baseUrl(), revTxId, "CREDIT");
      if (traceRecorder != null) {
        traceRecorder.recordOutboundCall(
            transfer.getId(),
            "query_reversal",
            fromInst.id(),
            Map.of("transactionId", revTxId, "leg", "CREDIT"),
            revLegOpt.orElse(null),
            System.currentTimeMillis() - revStart,
            revCallAt);
      }
    } catch (Exception ex) {
      if (traceRecorder != null) {
        traceRecorder.recordOutboundCall(
            transfer.getId(),
            "query_reversal",
            fromInst.id(),
            Map.of("transactionId", revTxId, "leg", "CREDIT"),
            Map.of("error", String.valueOf(ex.getMessage())),
            System.currentTimeMillis() - revStart,
            revCallAt);
      }
      transfer.recordStage(
          "query_reversal",
          StageOutcome.UNKNOWN,
          formatRejectionContext(
              destReason, "Failed to query reversal leg at source: " + ex.getMessage()),
          clock.instant());
      persistTransfer(transfer);
      return transfer;
    }

    if (revLegOpt.isPresent()) {
      ParticipantClient.LegResponsePayload revLeg = revLegOpt.get();
      if ("COMPLETED".equalsIgnoreCase(revLeg.status())) {
        transfer.reject(
            "resolve_reversal",
            destReason,
            Emitter.DESTINATION,
            "Reversal completed after destination rejection",
            clock.instant());
        if (traceRecorder != null) {
          traceRecorder.recordStage(transfer.getId(), "resolve_reversal", clock.instant());
          traceRecorder.recordStateChange(
              transfer.getId(),
              "resolve_reversal",
              TransferState.UNKNOWN,
              TransferState.REJECTED,
              clock.instant());
        }
        persistTransfer(transfer);
        return transfer;
      }
      if ("REJECTED".equalsIgnoreCase(revLeg.status())) {
        transfer.updateResolutionStatus(PendingAction.REVERSE_DEBIT, true, clock.instant());
        transfer.recordStage(
            "resolve_reversal",
            StageOutcome.FAILED,
            formatRejectionContext(
                destReason, "Reversal was rejected by source: " + revLeg.reasonCode()),
            clock.instant());
        persistTransfer(transfer);
        return transfer;
      }
      transfer.updateResolutionStatus(PendingAction.REVERSE_DEBIT, false, clock.instant());
      transfer.recordStage(
          "query_reversal",
          StageOutcome.UNKNOWN,
          formatRejectionContext(destReason, "Source reported reversal status " + revLeg.status()),
          clock.instant());
      persistTransfer(transfer);
      return transfer;
    }

    return executeReversal(transfer, fromInst, destReason);
  }

  private Transfer executeReversal(
      Transfer transfer, Institution fromInst, String rejectionReason) {
    if (traceRecorder != null) {
      traceRecorder.recordStage(transfer.getId(), "resolve_reversal", clock.instant());
    }
    String destReason = normalizeRejectionReason(rejectionReason);
    String revTxId = transfer.getId() + "-rev";
    String revKey = transfer.getId() + "-rev";
    LegRequestPayload revPayload =
        new LegRequestPayload(
            revTxId,
            "CREDIT",
            transfer.getFrom().accountReference(),
            new MoneyPayload(
                transfer.getMoney().amount().toPlainString(), transfer.getMoney().currency()),
            "Reversal of " + transfer.getId(),
            transfer.getId(),
            "SYNTHETIC");

    PaymentCallOutcome revOutcome =
        sendLeg(
            transfer.getId(),
            "resolve_reversal",
            fromInst.id(),
            fromInst.baseUrl(),
            revKey,
            revPayload);

    switch (revOutcome.status()) {
      case COMPLETED -> {
        // Reversal succeeded: terminal REJECTED state with destination's reason code
        transfer.reject(
            "resolve_reversal",
            destReason,
            Emitter.DESTINATION,
            "Reversal completed after destination rejection",
            clock.instant());
        if (traceRecorder != null) {
          traceRecorder.recordStateChange(
              transfer.getId(),
              "resolve_reversal",
              TransferState.UNKNOWN,
              TransferState.REJECTED,
              clock.instant());
        }
        persistTransfer(transfer);
        return transfer;
      }
      case TIMED_OUT -> {
        // Reversal call timed out: stays UNKNOWN with pendingAction: REVERSE_DEBIT,
        // needsManualReview: false
        transfer.updateResolutionStatus(PendingAction.REVERSE_DEBIT, false, clock.instant());
        transfer.recordStage(
            "resolve_reversal",
            StageOutcome.UNKNOWN,
            formatRejectionContext(
                destReason, "Reversal leg timed out: " + revOutcome.errorMessage()),
            clock.instant());
        persistTransfer(transfer);
        return transfer;
      }
      case REJECTED -> {
        // Reversal rejected by source: stays UNKNOWN, pendingAction: REVERSE_DEBIT,
        // needsManualReview: true
        transfer.updateResolutionStatus(PendingAction.REVERSE_DEBIT, true, clock.instant());
        transfer.recordStage(
            "resolve_reversal",
            StageOutcome.FAILED,
            formatRejectionContext(
                destReason, "Reversal was rejected by source: " + revOutcome.errorMessage()),
            clock.instant());
        persistTransfer(transfer);
        return transfer;
      }
    }
    return transfer;
  }

  private static String normalizeRejectionReason(String rejectionReason) {
    return rejectionReason != null && !rejectionReason.isBlank() ? rejectionReason : "REJECTED";
  }

  private static String formatRejectionContext(String reasonCode, String message) {
    String prefix = "[reasonCode=" + normalizeRejectionReason(reasonCode) + "]";
    return message != null && !message.isBlank() ? prefix + " " + message : prefix;
  }

  private static String extractPendingReversalReason(Transfer transfer) {
    var history = transfer.getStageHistory();
    for (int i = history.size() - 1; i >= 0; i--) {
      String details = history.get(i).details();
      if (details != null) {
        int start = details.indexOf("[reasonCode=");
        if (start >= 0) {
          int codeStart = start + "[reasonCode=".length();
          int end = details.indexOf(']', codeStart);
          if (end > codeStart) {
            String extracted = details.substring(codeStart, end).trim();
            if (!extracted.isBlank()) {
              return extracted;
            }
          }
        }
      }
    }
    return "REJECTED";
  }

  private PaymentCallOutcome sendLeg(
      String transactionId,
      String stage,
      String targetInstitutionId,
      String baseUrl,
      String idempotencyKey,
      LegRequestPayload payload) {
    long start = System.currentTimeMillis();
    Instant callAt = clock.instant();

    if (faultService != null) {
      FaultDecision decision = faultService.evaluateOutboundCall(targetInstitutionId);
      if (decision.triggered()) {
        if (traceRecorder != null) {
          String faultId =
              decision.matchedRule() != null
                  ? decision.matchedRule().faultId()
                  : decision.faultType().name();
          traceRecorder.recordFaultInjected(
              transactionId, stage, targetInstitutionId, faultId, clock.instant());
        }
        if (decision.faultType() == FaultType.TIMEOUT) {
          long durationMs = System.currentTimeMillis() - start;
          PaymentCallOutcome outcome =
              PaymentCallOutcome.timedOut(
                  "Simulated timeout via fault injection on target " + targetInstitutionId);
          if (traceRecorder != null) {
            traceRecorder.recordOutboundCall(
                transactionId, stage, targetInstitutionId, payload, outcome, durationMs, callAt);
          }
          return outcome;
        } else if (decision.faultType() == FaultType.DELAY) {
          if (decision.delayMs() > 0) {
            try {
              Thread.sleep(decision.delayMs());
            } catch (InterruptedException e) {
              Thread.currentThread().interrupt();
            }
          }
        } else if (decision.faultType() == FaultType.DUPLICATE_DELIVERY) {
          participantClient.applyLeg(baseUrl, idempotencyKey, payload);
        }
      }
    }

    PaymentCallOutcome outcome = participantClient.applyLeg(baseUrl, idempotencyKey, payload);
    long durationMs = System.currentTimeMillis() - start;
    if (traceRecorder != null) {
      traceRecorder.recordOutboundCall(
          transactionId, stage, targetInstitutionId, payload, outcome, durationMs, callAt);
    }
    return outcome;
  }

  private Transfer createAndReject(
      String transactionId,
      String networkId,
      String idempotencyKey,
      AccountRef from,
      AccountRef to,
      Money money,
      String reference,
      String reasonCode,
      Emitter emitter,
      String details) {
    Instant now = clock.instant();
    Transfer transfer =
        Transfer.create(transactionId, networkId, idempotencyKey, from, to, money, reference, now);
    transfer.reject("validate_routing", reasonCode, emitter, details, now);
    persistTransfer(transfer);

    if (traceRecorder != null) {
      traceRecorder.recordStage(transactionId, "created", now);
      traceRecorder.recordStateChange(transactionId, "created", null, TransferState.CREATED, now);
      traceRecorder.recordStage(transactionId, "validate_routing", now);
      traceRecorder.recordStateChange(
          transactionId, "validate_routing", TransferState.CREATED, TransferState.REJECTED, now);
    }
    return transfer;
  }

  public void persistTransfer(Transfer transfer) {
    persistenceHelper.persistTransfer(transfer);
  }
}
