package io.github.mhnuk2007.finsim.faults.internal;

import java.time.Instant;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

@Repository
public interface FaultRuleRepository extends JpaRepository<FaultRuleEntity, String> {

  List<FaultRuleEntity> findByTargetInstitutionIgnoreCase(String targetInstitution);

  @Modifying(flushAutomatically = true, clearAutomatically = true)
  @Query(
      "UPDATE FaultRuleEntity f "
          + "SET f.remainingCount = f.remainingCount - 1, f.version = f.version + 1, f.updatedAt = :now "
          + "WHERE f.id = :id AND f.remainingCount IS NOT NULL AND f.remainingCount > 0")
  int decrementRemainingCountIfPositive(@Param("id") String id, @Param("now") Instant now);
}
