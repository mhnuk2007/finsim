package io.github.mhnuk2007.finsim.faults;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import io.github.mhnuk2007.finsim.faults.internal.FaultRuleEntity;
import io.github.mhnuk2007.finsim.faults.internal.FaultRuleRepository;
import io.github.mhnuk2007.finsim.sim.FaultDecision;
import io.github.mhnuk2007.finsim.sim.FaultType;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.dao.OptimisticLockingFailureException;

class FaultServiceTest {

  private static final Instant NOW = Instant.parse("2026-11-25T10:00:00Z");

  private FaultRuleRepository repository;
  private FaultService faultService;

  @BeforeEach
  void setUp() {
    repository = mock(FaultRuleRepository.class);
    faultService = new FaultService(repository, Clock.fixed(NOW, ZoneOffset.UTC), null);
  }

  @Test
  @DisplayName(
      "Issue #147: evaluateOutboundCall retries when atomic remaining_count decrement contends")
  void evaluateOutboundCallRetriesOnAtomicDecrementContention() {
    FaultRuleEntity rule =
        new FaultRuleEntity("f-1", "bank-b", FaultType.TIMEOUT, null, 1.0, 2, null, NOW);
    when(repository.findByTargetInstitutionIgnoreCase("bank-b")).thenReturn(List.of(rule));
    when(repository.decrementRemainingCountIfPositive(eq("f-1"), any())).thenReturn(0, 1);

    FaultDecision decision = faultService.evaluateOutboundCall("bank-b");

    assertThat(decision.triggered()).isTrue();
    assertThat(decision.faultType()).isEqualTo(FaultType.TIMEOUT);
    verify(repository, times(2)).decrementRemainingCountIfPositive(eq("f-1"), any());
  }

  @Test
  @DisplayName(
      "Issue #147: evaluateOutboundCall retries when OptimisticLockingFailureException is thrown")
  void evaluateOutboundCallRetriesOnOptimisticLockingFailure() {
    FaultRuleEntity rule =
        new FaultRuleEntity("f-2", "bank-b", FaultType.TIMEOUT, null, 1.0, 1, null, NOW);
    when(repository.findByTargetInstitutionIgnoreCase("bank-b")).thenReturn(List.of(rule));
    when(repository.decrementRemainingCountIfPositive(eq("f-2"), any()))
        .thenThrow(new OptimisticLockingFailureException("Concurrent update"))
        .thenReturn(1);

    FaultDecision decision = faultService.evaluateOutboundCall("bank-b");

    assertThat(decision.triggered()).isTrue();
    assertThat(decision.faultType()).isEqualTo(FaultType.TIMEOUT);
    verify(repository, times(2)).decrementRemainingCountIfPositive(eq("f-2"), any());
  }

  @Test
  @DisplayName(
      "Issue #147: evaluateOutboundCall falls back to FaultDecision.none() after exhausting bounded retries")
  void evaluateOutboundCallReturnsNoneWhenRetriesExhausted() {
    FaultRuleEntity rule =
        new FaultRuleEntity("f-3", "bank-b", FaultType.TIMEOUT, null, 1.0, 1, null, NOW);
    when(repository.findByTargetInstitutionIgnoreCase("bank-b")).thenReturn(List.of(rule));
    when(repository.decrementRemainingCountIfPositive(eq("f-3"), any())).thenReturn(0);

    FaultDecision decision = faultService.evaluateOutboundCall("bank-b");

    assertThat(decision.triggered()).isFalse();
    verify(repository, times(16)).decrementRemainingCountIfPositive(eq("f-3"), any());
  }
}
