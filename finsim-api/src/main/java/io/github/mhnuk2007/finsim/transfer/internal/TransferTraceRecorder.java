package io.github.mhnuk2007.finsim.transfer.internal;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.github.mhnuk2007.finsim.core.TransferState;
import io.github.mhnuk2007.finsim.transfer.TransferDtos.TraceEventDto;
import io.github.mhnuk2007.finsim.transfer.TransferDtos.TraceResponse;
import java.time.Instant;
import java.util.List;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Service component responsible for recording fine-grained transfer trace events (stages, state
 * changes, outbound calls, and injected faults) and reading transfer traces.
 */
@Component
public class TransferTraceRecorder {

  private final TransferTraceEventRepository repository;
  private final ObjectMapper objectMapper;

  @Autowired
  public TransferTraceRecorder(TransferTraceEventRepository repository) {
    this(repository, new ObjectMapper().findAndRegisterModules());
  }

  public TransferTraceRecorder(TransferTraceEventRepository repository, ObjectMapper objectMapper) {
    this.repository = repository;
    this.objectMapper =
        objectMapper != null ? objectMapper : new ObjectMapper().findAndRegisterModules();
  }

  @Transactional(propagation = Propagation.REQUIRED)
  public void recordStage(String transferId, String stage, Instant at) {
    repository.save(
        TransferTraceEventEntity.of(
            transferId, "STAGE", stage, null, null, null, null, null, null, null, at));
  }

  @Transactional(propagation = Propagation.REQUIRED)
  public void recordStateChange(
      String transferId, String stage, TransferState fromState, TransferState toState, Instant at) {
    repository.save(
        TransferTraceEventEntity.of(
            transferId,
            "STATE_CHANGE",
            stage,
            null,
            null,
            null,
            null,
            null,
            fromState != null ? fromState.name() : null,
            toState != null ? toState.name() : null,
            at));
  }

  @Transactional(propagation = Propagation.REQUIRED)
  public void recordFaultInjected(
      String transferId, String stage, String target, String faultId, Instant at) {
    repository.save(
        TransferTraceEventEntity.of(
            transferId,
            "FAULT_INJECTED",
            stage,
            target,
            null,
            null,
            null,
            faultId,
            null,
            null,
            at));
  }

  @Transactional(propagation = Propagation.REQUIRED)
  public void recordOutboundCall(
      String transferId,
      String stage,
      String target,
      Object request,
      Object response,
      Long durationMs,
      Instant at) {
    String requestJson = toJson(request);
    String responseJson = toJson(response);
    repository.save(
        TransferTraceEventEntity.of(
            transferId,
            "OUTBOUND_CALL",
            stage,
            target,
            requestJson,
            responseJson,
            durationMs,
            null,
            null,
            null,
            at));
  }

  @Transactional(readOnly = true)
  public TraceResponse getTrace(String transactionId) {
    List<TransferTraceEventEntity> entities =
        repository.findByTransferIdOrderByIdAsc(transactionId);
    List<TraceEventDto> dtos = entities.stream().map(this::toDto).toList();
    return new TraceResponse(transactionId, dtos);
  }

  private TraceEventDto toDto(TransferTraceEventEntity entity) {
    Object reqObj = fromJson(entity.getRequestPayload());
    Object resObj = fromJson(entity.getResponsePayload());
    return new TraceEventDto(
        entity.getCreatedAt(),
        entity.getKind(),
        entity.getStage(),
        entity.getTarget(),
        reqObj,
        resObj,
        entity.getDurationMs(),
        entity.getFaultId(),
        entity.getFromState(),
        entity.getToState());
  }

  private String toJson(Object obj) {
    if (obj == null) {
      return null;
    }
    if (obj instanceof String s) {
      return s;
    }
    try {
      return objectMapper.writeValueAsString(obj);
    } catch (JsonProcessingException e) {
      return obj.toString();
    }
  }

  private Object fromJson(String json) {
    if (json == null || json.isBlank()) {
      return null;
    }
    try {
      return objectMapper.readValue(json, Object.class);
    } catch (Exception e) {
      return json;
    }
  }
}
