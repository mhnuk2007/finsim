package io.github.mhnuk2007.finsim.transfer.internal;

import io.github.mhnuk2007.finsim.core.StageEntry;
import io.github.mhnuk2007.finsim.core.Transfer;
import java.util.Optional;
import org.springframework.orm.ObjectOptimisticLockingFailureException;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * Dedicated transactional helper bean for persisting transfer state and stage transitions.
 *
 * <p>Separating persistence onto this independent Spring bean ensures that invocations from {@link
 * TransferOrchestrator} pass through Spring's AOP transaction proxy, eliminating internal
 * self-invocation proxy bypass.
 */
@Component
public class TransferPersistenceHelper {

  private final TransferRepository transferRepository;
  private final TransferStageRepository stageRepository;

  public TransferPersistenceHelper(
      TransferRepository transferRepository, TransferStageRepository stageRepository) {
    this.transferRepository = transferRepository;
    this.stageRepository = stageRepository;
  }

  @Transactional
  public void persistTransfer(Transfer transfer) {
    Optional<TransferEntity> existingOpt = transferRepository.findById(transfer.getId());
    TransferEntity entity;
    boolean shouldIncrementVersion = false;
    if (existingOpt.isPresent()) {
      TransferEntity existing = existingOpt.get();
      if (existing.getVersion() != null && !existing.getVersion().equals(transfer.getVersion())) {
        throw new ObjectOptimisticLockingFailureException(TransferEntity.class, transfer.getId());
      }
      boolean changed = existing.updateFrom(transfer);
      shouldIncrementVersion = existing.getVersion() != null && changed;
      entity = existing;
    } else {
      entity = TransferEntity.from(transfer);
    }

    transferRepository.save(entity);
    if (shouldIncrementVersion) {
      transfer.incrementVersion();
    }

    // Save any newly appended stages
    long existingCount = stageRepository.findByTransferIdOrderByIdAsc(transfer.getId()).size();
    if (transfer.getStageHistory().size() > existingCount) {
      for (int i = (int) existingCount; i < transfer.getStageHistory().size(); i++) {
        StageEntry entry = transfer.getStageHistory().get(i);
        TransferStageEntity stageEntity =
            TransferStageEntity.of(
                transfer.getId(),
                entry.stage(),
                entry.outcome().name(),
                entry.details(),
                entry.at());
        stageRepository.save(stageEntity);
      }
    }
  }
}
