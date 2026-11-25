package io.github.mhnuk2007.finsim.transfer.internal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import io.github.mhnuk2007.finsim.core.AccountRef;
import io.github.mhnuk2007.finsim.core.Money;
import io.github.mhnuk2007.finsim.core.StageOutcome;
import io.github.mhnuk2007.finsim.core.Transfer;
import io.github.mhnuk2007.finsim.registry.Registry;
import java.lang.reflect.Method;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

class TransferPersistenceHelperTest {

  private TransferRepository transferRepository;
  private TransferStageRepository stageRepository;
  private TransferPersistenceHelper persistenceHelper;

  @BeforeEach
  void setUp() {
    transferRepository = mock(TransferRepository.class);
    stageRepository = mock(TransferStageRepository.class);
    persistenceHelper = new TransferPersistenceHelper(transferRepository, stageRepository);
  }

  @Test
  @DisplayName(
      "Issue #48: TransferPersistenceHelper is a Spring @Component and persistTransfer is @Transactional")
  void helperHasTransactionalAnnotation() throws NoSuchMethodException {
    assertThat(TransferPersistenceHelper.class.isAnnotationPresent(Component.class)).isTrue();

    Method method = TransferPersistenceHelper.class.getMethod("persistTransfer", Transfer.class);
    assertThat(method.isAnnotationPresent(Transactional.class)).isTrue();
  }

  @Test
  @DisplayName(
      "Issue #48: TransferOrchestrator does not self-invoke @Transactional persistTransfer directly")
  void orchestratorPersistTransferDoesNotCarryTransactionalAnnotation()
      throws NoSuchMethodException {
    Method method = TransferOrchestrator.class.getMethod("persistTransfer", Transfer.class);
    assertThat(method.isAnnotationPresent(Transactional.class))
        .as(
            "TransferOrchestrator.persistTransfer must not have @Transactional to avoid self-invocation proxy bypass")
        .isFalse();
  }

  @Test
  @DisplayName("persistTransfer saves new TransferEntity and appends newly recorded stages")
  void persistTransferSavesEntityAndStages() {
    Instant now = Instant.parse("2026-11-21T10:00:00Z");
    Transfer transfer =
        Transfer.create(
            "tx-12345",
            "net-1",
            "idemp-12345",
            new AccountRef("bank-a", "acc-1"),
            new AccountRef("bank-b", "acc-2"),
            Money.of("100.00", "USD"),
            "ref-1",
            now);
    transfer.accept("accepted", now);
    transfer.startProcessing("debit_source", now);

    when(transferRepository.findById("tx-12345")).thenReturn(Optional.empty());
    when(stageRepository.findByTransferIdOrderByIdAsc("tx-12345")).thenReturn(List.of());

    persistenceHelper.persistTransfer(transfer);

    verify(transferRepository, times(1)).save(any(TransferEntity.class));
    verify(stageRepository, times(transfer.getStageHistory().size()))
        .save(any(TransferStageEntity.class));
  }

  @Test
  @DisplayName("persistTransfer updates existing entity and only saves newly added stages")
  void persistTransferUpdatesExistingAndAppendsOnlyNewStages() {
    Instant now = Instant.parse("2026-11-21T10:00:00Z");
    Transfer transfer =
        Transfer.create(
            "tx-12345",
            "net-1",
            "idemp-12345",
            new AccountRef("bank-a", "acc-1"),
            new AccountRef("bank-b", "acc-2"),
            Money.of("100.00", "USD"),
            "ref-1",
            now);
    transfer.accept("accepted", now);
    transfer.startProcessing("debit_source", now);

    TransferEntity existingEntity = TransferEntity.from(transfer);
    when(transferRepository.findById("tx-12345")).thenReturn(Optional.of(existingEntity));

    TransferStageEntity stage1 =
        TransferStageEntity.of("tx-12345", "created", StageOutcome.PASSED.name(), "details", now);
    TransferStageEntity stage2 =
        TransferStageEntity.of("tx-12345", "accepted", StageOutcome.PASSED.name(), "details", now);
    when(stageRepository.findByTransferIdOrderByIdAsc("tx-12345"))
        .thenReturn(List.of(stage1, stage2));

    persistenceHelper.persistTransfer(transfer);

    verify(transferRepository, times(1)).save(existingEntity);
    // transfer has 3 stages (created, accepted, debit_source). 2 existing stages -> saves exactly 1
    // new stage
    verify(stageRepository, times(1)).save(any(TransferStageEntity.class));
  }

  @Test
  @DisplayName("TransferOrchestrator delegates persistTransfer to TransferPersistenceHelper")
  void orchestratorDelegatesToPersistenceHelper() {
    TransferPersistenceHelper mockHelper = mock(TransferPersistenceHelper.class);
    Registry registry = mock(Registry.class);
    ParticipantClient participantClient = mock(ParticipantClient.class);
    Clock clock = Clock.systemUTC();

    TransferOrchestrator orchestrator =
        new TransferOrchestrator(registry, participantClient, mockHelper, clock);

    Transfer transfer =
        Transfer.create(
            "tx-99999",
            "net-1",
            "idemp-99999",
            new AccountRef("bank-a", "acc-1"),
            new AccountRef("bank-b", "acc-2"),
            Money.of("50.00", "EUR"),
            "ref-2",
            Instant.now());

    orchestrator.persistTransfer(transfer);

    verify(mockHelper, times(1)).persistTransfer(transfer);
  }

  @Test
  @DisplayName(
      "Issue #144: persistTransfer throws ObjectOptimisticLockingFailureException when DB version differs from Transfer version")
  void persistTransferThrowsOnStaleVersionMismatch() {
    Instant now = Instant.parse("2026-11-21T10:00:00Z");
    Transfer staleTransfer =
        Transfer.reconstitute(
            "tx-stale-1",
            "sandbox",
            "idemp-stale-1",
            io.github.mhnuk2007.finsim.core.TransferState.UNKNOWN,
            "credit_destination",
            new AccountRef("bank-a", "acc-1"),
            new AccountRef("bank-b", "acc-2"),
            Money.of("100.00", "USD"),
            "ref-1",
            null,
            null,
            io.github.mhnuk2007.finsim.core.PendingAction.RETRY_CREDIT,
            false,
            io.github.mhnuk2007.finsim.core.Provenance.SYNTHETIC,
            List.of(),
            now,
            now,
            0L);
    staleTransfer.complete("resolve", now.plusSeconds(1));

    TransferEntity dbEntity = org.mockito.Mockito.spy(TransferEntity.from(staleTransfer));
    when(dbEntity.getVersion()).thenReturn(1L);
    when(transferRepository.findById("tx-stale-1")).thenReturn(Optional.of(dbEntity));

    org.assertj.core.api.Assertions.assertThatThrownBy(
            () -> persistenceHelper.persistTransfer(staleTransfer))
        .isInstanceOf(org.springframework.orm.ObjectOptimisticLockingFailureException.class);
    verify(transferRepository, org.mockito.Mockito.never()).save(any());
  }

  @Test
  @DisplayName(
      "Issue #144: persistTransfer increments in-memory Transfer version after updating a persisted entity")
  void persistTransferIncrementsVersionOnChangedPersistedEntity() {
    Instant now = Instant.parse("2026-11-21T10:00:00Z");
    Transfer transfer =
        Transfer.reconstitute(
            "tx-ver-1",
            "sandbox",
            "idemp-ver-1",
            io.github.mhnuk2007.finsim.core.TransferState.IN_PROGRESS,
            "debit_source",
            new AccountRef("bank-a", "acc-1"),
            new AccountRef("bank-b", "acc-2"),
            Money.of("100.00", "USD"),
            "ref-1",
            null,
            null,
            io.github.mhnuk2007.finsim.core.PendingAction.NONE,
            false,
            io.github.mhnuk2007.finsim.core.Provenance.SYNTHETIC,
            List.of(),
            now,
            now,
            0L);

    TransferEntity dbEntity = org.mockito.Mockito.spy(TransferEntity.from(transfer));
    when(dbEntity.getVersion()).thenReturn(0L);
    when(transferRepository.findById("tx-ver-1")).thenReturn(Optional.of(dbEntity));
    when(stageRepository.findByTransferIdOrderByIdAsc("tx-ver-1")).thenReturn(List.of());

    transfer.markUnknown(
        "credit_destination",
        io.github.mhnuk2007.finsim.core.PendingAction.REVERSE_DEBIT,
        false,
        "Rejected",
        now.plusSeconds(1));

    persistenceHelper.persistTransfer(transfer);

    verify(transferRepository, times(1)).save(dbEntity);
    assertThat(transfer.getVersion()).isEqualTo(1L);
  }
}
