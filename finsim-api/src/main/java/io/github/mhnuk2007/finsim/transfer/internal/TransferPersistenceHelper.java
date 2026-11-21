package io.github.mhnuk2007.finsim.transfer.internal;

import io.github.mhnuk2007.finsim.core.StageEntry;
import io.github.mhnuk2007.finsim.core.Transfer;
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
    TransferEntity entity =
        transferRepository
            .findById(transfer.getId())
            .map(
                existing -> {
                  existing.updateFrom(transfer);
                  return existing;
                })
            .orElseGet(() -> TransferEntity.from(transfer));

    transferRepository.save(entity);

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
