package io.github.mhnuk2007.finsim.transfer.internal;

import java.net.InetAddress;
import java.net.URI;
import java.net.UnknownHostException;
import java.time.Duration;
import java.util.Optional;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;

@Component
public class ParticipantClient {

  private final RestClient restClient;
  private final boolean allowPrivateAddresses;

  public ParticipantClient() {
    this(true);
  }

  public ParticipantClient(
      @Value("${finsim.registry.allow-private-addresses:true}") boolean allowPrivateAddresses) {
    this(Duration.ofSeconds(2), Duration.ofSeconds(4), allowPrivateAddresses);
  }

  public ParticipantClient(Duration connectTimeout, Duration readTimeout) {
    this(connectTimeout, readTimeout, true);
  }

  public ParticipantClient(
      Duration connectTimeout, Duration readTimeout, boolean allowPrivateAddresses) {
    SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
    factory.setConnectTimeout(connectTimeout);
    factory.setReadTimeout(readTimeout);
    this.restClient = RestClient.builder().requestFactory(factory).build();
    this.allowPrivateAddresses = allowPrivateAddresses;
  }

  ParticipantClient(RestClient restClient) {
    this(restClient, true);
  }

  ParticipantClient(RestClient restClient, boolean allowPrivateAddresses) {
    this.restClient = restClient;
    this.allowPrivateAddresses = allowPrivateAddresses;
  }

  public enum CallStatus {
    COMPLETED,
    REJECTED,
    TIMED_OUT
  }

  public record PaymentCallOutcome(
      CallStatus status, String reasonCode, String participantReference, String errorMessage) {

    public static PaymentCallOutcome completed(String participantReference) {
      return new PaymentCallOutcome(CallStatus.COMPLETED, null, participantReference, null);
    }

    public static PaymentCallOutcome rejected(String reasonCode, String message) {
      return new PaymentCallOutcome(CallStatus.REJECTED, reasonCode, null, message);
    }

    public static PaymentCallOutcome timedOut(String message) {
      return new PaymentCallOutcome(CallStatus.TIMED_OUT, null, null, message);
    }
  }

  public record LegRequestPayload(
      String transactionId,
      String direction,
      String accountReference,
      MoneyPayload money,
      String reference,
      String reversalOf,
      String provenance) {}

  public record MoneyPayload(String amount, String currency) {}

  public record LegResponsePayload(
      String transactionId,
      String direction,
      String status,
      String reasonCode,
      String participantReference,
      String provenance) {}

  public record ParticipantErrorPayload(String code, String message) {}

  /**
   * Dispatches a payment leg (DEBIT or CREDIT) to a participant bank.
   *
   * @param baseUrl the participant base URL (e.g. http://localhost:9001)
   * @param idempotencyKey the idempotency key for this leg
   * @param request the payment leg payload
   * @return the outcome (COMPLETED, REJECTED, or TIMED_OUT)
   */
  public PaymentCallOutcome applyLeg(
      String baseUrl, String idempotencyKey, LegRequestPayload request) {
    String url = normalizeUrl(baseUrl) + "/finsim/v1/payments";
    try {
      validateTargetSafety(url);
      LegResponsePayload response =
          restClient
              .post()
              .uri(url)
              .header("Idempotency-Key", idempotencyKey)
              .contentType(MediaType.APPLICATION_JSON)
              .body(request)
              .retrieve()
              .body(LegResponsePayload.class);

      if (response == null || response.status() == null || response.status().isBlank()) {
        return PaymentCallOutcome.timedOut(
            "Participant returned empty or missing response payload");
      }
      String status = response.status().toUpperCase();
      if ("COMPLETED".equals(status)) {
        return PaymentCallOutcome.completed(response.participantReference());
      }
      if ("REJECTED".equals(status)) {
        String reason =
            response.reasonCode() != null && !response.reasonCode().isBlank()
                ? response.reasonCode()
                : "REJECTED";
        return PaymentCallOutcome.rejected(reason, "Participant returned REJECTED status");
      }
      if ("ACCEPTED".equals(status) || "PENDING".equals(status)) {
        return PaymentCallOutcome.timedOut(
            "Participant returned asynchronous status: " + response.status());
      }
      return PaymentCallOutcome.timedOut(
          "Unrecognized participant leg status: " + response.status());
    } catch (SecurityException ex) {
      return PaymentCallOutcome.rejected("ROUTING_ERROR", ex.getMessage());
    } catch (ResourceAccessException ex) {
      // Timeout or connection failure -> UNKNOWN outcome
      return PaymentCallOutcome.timedOut(ex.getMessage());
    } catch (RestClientResponseException ex) {
      int statusCode = ex.getStatusCode().value();
      if (statusCode == 422 || statusCode == 400 || statusCode == 409) {
        try {
          ParticipantErrorPayload error = ex.getResponseBodyAs(ParticipantErrorPayload.class);
          String code = error != null && error.code() != null ? error.code() : "REJECTED";
          String message = error != null ? error.message() : ex.getMessage();
          return PaymentCallOutcome.rejected(code, message);
        } catch (Exception ignored) {
          return PaymentCallOutcome.rejected("REJECTED", ex.getResponseBodyAsString());
        }
      }
      return PaymentCallOutcome.timedOut(
          "HTTP " + ex.getStatusCode().value() + ": " + ex.getMessage());
    } catch (Exception ex) {
      return PaymentCallOutcome.timedOut(ex.getMessage());
    }
  }

  /** Queries a participant bank for the recorded status of a leg. */
  public Optional<LegResponsePayload> queryLegStatus(
      String baseUrl, String transactionId, String direction) {
    String url =
        normalizeUrl(baseUrl)
            + "/finsim/v1/payments/"
            + transactionId
            + "?leg="
            + direction.toUpperCase();
    try {
      validateTargetSafety(url);
      LegResponsePayload response =
          restClient.get().uri(url).retrieve().body(LegResponsePayload.class);
      return Optional.ofNullable(response);
    } catch (SecurityException ex) {
      return Optional.empty();
    } catch (RestClientResponseException ex) {
      if (ex.getStatusCode().value() == 404) {
        return Optional.empty();
      }
      throw ex;
    }
  }

  private void validateTargetSafety(String targetUrl) {
    try {
      URI uri = URI.create(targetUrl);
      String host = uri.getHost();
      if (host == null || host.isBlank()) {
        return;
      }
      InetAddress address = InetAddress.getByName(host);
      if (address.isLinkLocalAddress() || address.isAnyLocalAddress()) {
        throw new SecurityException(
            "Outbound participant call rejected: link-local or metadata address is not allowed ("
                + host
                + ")");
      }
      if (!allowPrivateAddresses && (address.isLoopbackAddress() || address.isSiteLocalAddress())) {
        throw new SecurityException(
            "Outbound participant call rejected: private or loopback address is not allowed in production ("
                + host
                + ")");
      }
    } catch (UnknownHostException ignored) {
      // DNS lookup failure will be handled by the HTTP client
    }
  }

  private static String normalizeUrl(String url) {
    return url.endsWith("/") ? url.substring(0, url.length() - 1) : url;
  }
}
