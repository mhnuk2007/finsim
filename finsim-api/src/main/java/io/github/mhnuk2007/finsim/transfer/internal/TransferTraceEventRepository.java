package io.github.mhnuk2007.finsim.transfer.internal;

import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

@Repository
public interface TransferTraceEventRepository
    extends JpaRepository<TransferTraceEventEntity, Long> {

  List<TransferTraceEventEntity> findByTransferIdOrderByIdAsc(String transferId);
}
