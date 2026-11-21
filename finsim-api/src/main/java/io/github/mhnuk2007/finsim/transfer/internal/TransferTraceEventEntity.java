package io.github.mhnuk2007.finsim.transfer.internal;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;

@Entity
@Table(name = "transfer_trace_events")
public class TransferTraceEventEntity {

  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @Column(name = "transfer_id", nullable = false)
  private String transferId;

  @Column(name = "kind", nullable = false)
  private String kind;

  @Column(name = "stage")
  private String stage;

  @Column(name = "target")
  private String target;

  @Column(name = "request_payload")
  private String requestPayload;

  @Column(name = "response_payload")
  private String responsePayload;

  @Column(name = "duration_ms")
  private Long durationMs;

  @Column(name = "fault_id")
  private String faultId;

  @Column(name = "from_state")
  private String fromState;

  @Column(name = "to_state")
  private String toState;

  @Column(name = "created_at", nullable = false)
  private Instant createdAt;

  protected TransferTraceEventEntity() {}

  public static TransferTraceEventEntity of(
      String transferId,
      String kind,
      String stage,
      String target,
      String requestPayload,
      String responsePayload,
      Long durationMs,
      String faultId,
      String fromState,
      String toState,
      Instant createdAt) {
    TransferTraceEventEntity entity = new TransferTraceEventEntity();
    entity.transferId = transferId;
    entity.kind = kind;
    entity.stage = stage;
    entity.target = target;
    entity.requestPayload = requestPayload;
    entity.responsePayload = responsePayload;
    entity.durationMs = durationMs;
    entity.faultId = faultId;
    entity.fromState = fromState;
    entity.toState = toState;
    entity.createdAt = createdAt != null ? createdAt : Instant.now();
    return entity;
  }

  public Long getId() {
    return id;
  }

  public String getTransferId() {
    return transferId;
  }

  public String getKind() {
    return kind;
  }

  public String getStage() {
    return stage;
  }

  public String getTarget() {
    return target;
  }

  public String getRequestPayload() {
    return requestPayload;
  }

  public String getResponsePayload() {
    return responsePayload;
  }

  public Long getDurationMs() {
    return durationMs;
  }

  public String getFaultId() {
    return faultId;
  }

  public String getFromState() {
    return fromState;
  }

  public String getToState() {
    return toState;
  }

  public Instant getCreatedAt() {
    return createdAt;
  }
}
