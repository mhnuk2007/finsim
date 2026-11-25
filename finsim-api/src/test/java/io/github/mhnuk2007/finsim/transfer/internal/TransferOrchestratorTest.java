package io.github.mhnuk2007.finsim.transfer.internal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import io.github.mhnuk2007.finsim.core.AccountRef;
import io.github.mhnuk2007.finsim.core.Emitter;
import io.github.mhnuk2007.finsim.core.Money;
import io.github.mhnuk2007.finsim.core.PendingAction;
import io.github.mhnuk2007.finsim.core.Provenance;
import io.github.mhnuk2007.finsim.core.StageEntry;
import io.github.mhnuk2007.finsim.core.StageOutcome;
import io.github.mhnuk2007.finsim.core.Transfer;
import io.github.mhnuk2007.finsim.core.TransferState;
import io.github.mhnuk2007.finsim.registry.Capability;
import io.github.mhnuk2007.finsim.registry.Institution;
import io.github.mhnuk2007.finsim.registry.InstitutionStatus;
import io.github.mhnuk2007.finsim.registry.InstitutionType;
import io.github.mhnuk2007.finsim.registry.Registry;
import io.github.mhnuk2007.finsim.transfer.internal.ParticipantClient.LegResponsePayload;
import io.github.mhnuk2007.finsim.transfer.internal.ParticipantClient.PaymentCallOutcome;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

class TransferOrchestratorTest {

  private static final Instant NOW = Instant.parse("2026-11-25T10:00:00Z");

  private Registry registry;
  private ParticipantClient participantClient;
  private TransferPersistenceHelper persistenceHelper;
  private TransferOrchestrator orchestrator;

  @BeforeEach
  void setUp() {
    registry = mock(Registry.class);
    participantClient = mock(ParticipantClient.class);
    persistenceHelper = mock(TransferPersistenceHelper.class);
    orchestrator =
        new TransferOrchestrator(
            registry, participantClient, persistenceHelper, Clock.fixed(NOW, ZoneOffset.UTC));

    Institution bankA =
        new Institution(
            "bank-a",
            "Bank A",
            InstitutionType.BANK,
            "http://bank-a:9001",
            Set.of(Capability.ACCOUNT_DEBIT, Capability.ACCOUNT_CREDIT, Capability.STATUS_QUERY),
            InstitutionStatus.ACTIVE,
            "SYNTHETIC");
    Institution bankB =
        new Institution(
            "bank-b",
            "Bank B",
            InstitutionType.BANK,
            "http://bank-b:9002",
            Set.of(Capability.ACCOUNT_DEBIT, Capability.ACCOUNT_CREDIT, Capability.STATUS_QUERY),
            InstitutionStatus.ACTIVE,
            "SYNTHETIC");
    when(registry.institution("bank-a")).thenReturn(bankA);
    when(registry.institution("bank-b")).thenReturn(bankB);
  }

  @Test
  @DisplayName(
      "Issue #145: resolve() with PendingAction.REVERSE_DEBIT resolves completed reversal without querying or re-sending destination credit")
  void resolveWithPendingReverseDebitCompletesRejectionWhenReversalCompleted() {
    Transfer transfer =
        reconstituteUnknown(
            "tx-145-done",
            PendingAction.REVERSE_DEBIT,
            "[reasonCode=AC04] Reversal leg timed out: Read timed out");

    when(participantClient.queryLegStatus("http://bank-a:9001", "tx-145-done-rev", "CREDIT"))
        .thenReturn(
            Optional.of(
                new LegResponsePayload(
                    "tx-145-done-rev", "CREDIT", "COMPLETED", null, "rev-ok", "SYNTHETIC")));

    Transfer resolved = orchestrator.resolve(transfer);

    assertThat(resolved.getState()).isEqualTo(TransferState.REJECTED);
    assertThat(resolved.getReasonCode()).isEqualTo("AC04");
    assertThat(resolved.getEmittedBy()).isEqualTo(Emitter.DESTINATION);
    assertThat(resolved.getPendingAction()).isEqualTo(PendingAction.NONE);
    verify(participantClient, never()).queryLegStatus(eq("http://bank-b:9002"), any(), any());
    verify(participantClient, never()).applyLeg(eq("http://bank-b:9002"), any(), any());
    verify(persistenceHelper, times(1)).persistTransfer(transfer);
  }

  @Test
  @DisplayName(
      "Issue #145: resolve() with PendingAction.REVERSE_DEBIT flags manual review when source rejected reversal")
  void resolveWithPendingReverseDebitFlagsManualReviewWhenReversalRejected() {
    Transfer transfer =
        reconstituteUnknown(
            "tx-145-rej",
            PendingAction.REVERSE_DEBIT,
            "[reasonCode=AC04] Reversal leg timed out: Read timed out");

    when(participantClient.queryLegStatus("http://bank-a:9001", "tx-145-rej-rev", "CREDIT"))
        .thenReturn(
            Optional.of(
                new LegResponsePayload(
                    "tx-145-rej-rev", "CREDIT", "REJECTED", "BE04", null, "SYNTHETIC")));

    Transfer resolved = orchestrator.resolve(transfer);

    assertThat(resolved.getState()).isEqualTo(TransferState.UNKNOWN);
    assertThat(resolved.getPendingAction()).isEqualTo(PendingAction.REVERSE_DEBIT);
    assertThat(resolved.isNeedsManualReview()).isTrue();
    assertThat(resolved.getReasonCode()).isNull();
    verify(participantClient, never()).queryLegStatus(eq("http://bank-b:9002"), any(), any());
    verify(participantClient, never()).applyLeg(any(), any(), any());
    verify(persistenceHelper, times(1)).persistTransfer(transfer);
  }

  @Test
  @DisplayName(
      "Issue #145: resolve() with PendingAction.REVERSE_DEBIT re-sends reversal when source returns 404")
  void resolveWithPendingReverseDebitResendsReversalWhen404() {
    Transfer transfer =
        reconstituteUnknown(
            "tx-145-404",
            PendingAction.REVERSE_DEBIT,
            "[reasonCode=AC04] Reversal leg timed out: Read timed out");

    when(participantClient.queryLegStatus("http://bank-a:9001", "tx-145-404-rev", "CREDIT"))
        .thenReturn(Optional.empty());
    when(participantClient.applyLeg(
            eq("http://bank-a:9001"),
            eq("tx-145-404-rev"),
            argThat(req -> "tx-145-404".equals(req.reversalOf()))))
        .thenReturn(PaymentCallOutcome.completed("rev-ok-2"));

    Transfer resolved = orchestrator.resolve(transfer);

    assertThat(resolved.getState()).isEqualTo(TransferState.REJECTED);
    assertThat(resolved.getReasonCode()).isEqualTo("AC04");
    assertThat(resolved.getEmittedBy()).isEqualTo(Emitter.DESTINATION);
    verify(participantClient, never()).queryLegStatus(eq("http://bank-b:9002"), any(), any());
    verify(participantClient, never()).applyLeg(eq("http://bank-b:9002"), any(), any());
  }

  @Test
  @DisplayName(
      "Issue #146: resolve() keeps transfer in UNKNOWN when queryLegStatus throws SecurityException (SSRF)")
  void resolveKeepsTransferUnknownWhenQueryThrowsSecurityException() {
    Transfer transfer =
        reconstituteUnknown(
            "tx-146-ssrf", PendingAction.NONE, "Debit leg timed out at source institution");

    when(participantClient.queryLegStatus("http://bank-a:9001", "tx-146-ssrf", "DEBIT"))
        .thenThrow(new SecurityException("Private address blocked"));

    Transfer resolved = orchestrator.resolve(transfer);

    assertThat(resolved.getState()).isEqualTo(TransferState.UNKNOWN);
    assertThat(resolved.getReasonCode()).isNull();
    verify(persistenceHelper, times(1)).persistTransfer(transfer);
  }

  private static Transfer reconstituteUnknown(
      String txId, PendingAction pendingAction, String details) {
    return Transfer.reconstitute(
        txId,
        "sandbox",
        "idemp-" + txId,
        TransferState.UNKNOWN,
        "resolve_reversal",
        new AccountRef("bank-a", "ACC-1"),
        new AccountRef("bank-b", "ACC-2"),
        Money.of("100.00", "USD"),
        "REF-" + txId,
        null,
        null,
        pendingAction,
        false,
        Provenance.SYNTHETIC,
        List.of(StageEntry.of("resolve_reversal", StageOutcome.UNKNOWN, NOW, details)),
        NOW,
        NOW,
        1L);
  }
}
