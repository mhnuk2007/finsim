package io.github.mhnuk2007.finsim.transfer.internal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import io.github.mhnuk2007.finsim.transfer.internal.ParticipantClient.CallStatus;
import io.github.mhnuk2007.finsim.transfer.internal.ParticipantClient.LegRequestPayload;
import io.github.mhnuk2007.finsim.transfer.internal.ParticipantClient.MoneyPayload;
import io.github.mhnuk2007.finsim.transfer.internal.ParticipantClient.PaymentCallOutcome;
import java.net.InetAddress;
import java.net.UnknownHostException;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

class ParticipantClientTest {

  private RestClient.Builder restClientBuilder;
  private MockRestServiceServer mockServer;
  private ParticipantClient client;

  @BeforeEach
  void setUp() {
    restClientBuilder = RestClient.builder();
    mockServer = MockRestServiceServer.bindTo(restClientBuilder).build();
    client = new ParticipantClient(restClientBuilder.build());
  }

  @Test
  @DisplayName(
      "Issue #52: HTTP 422 with JSON error body is classified as REJECTED with reason code")
  void http422ClassifiedAsRejectedWithReasonCode() {
    mockServer
        .expect(requestTo("http://localhost:9001/finsim/v1/payments"))
        .andExpect(method(HttpMethod.POST))
        .andExpect(header("Idempotency-Key", "idemp-key-1"))
        .andRespond(
            withStatus(HttpStatus.UNPROCESSABLE_ENTITY)
                .contentType(MediaType.APPLICATION_JSON)
                .body("{\"code\": \"AM04\", \"message\": \"Insufficient funds.\"}"));

    LegRequestPayload request =
        new LegRequestPayload(
            "tx-1",
            "DEBIT",
            "ACC-1",
            new MoneyPayload("100.00", "USD"),
            "REF-1",
            null,
            "SYNTHETIC");

    PaymentCallOutcome outcome = client.applyLeg("http://localhost:9001", "idemp-key-1", request);

    assertThat(outcome.status()).isEqualTo(CallStatus.REJECTED);
    assertThat(outcome.reasonCode()).isEqualTo("AM04");
    assertThat(outcome.errorMessage()).isEqualTo("Insufficient funds.");
    mockServer.verify();
  }

  @Test
  @DisplayName("Issue #52: HTTP 400 is classified as REJECTED with reason code")
  void http400ClassifiedAsRejected() {
    mockServer
        .expect(requestTo("http://localhost:9001/finsim/v1/payments"))
        .andExpect(method(HttpMethod.POST))
        .andRespond(
            withStatus(HttpStatus.BAD_REQUEST)
                .contentType(MediaType.APPLICATION_JSON)
                .body("{\"code\": \"AC01\", \"message\": \"Account does not exist.\"}"));

    LegRequestPayload request =
        new LegRequestPayload(
            "tx-2", "DEBIT", "ACC-X", new MoneyPayload("50.00", "USD"), "REF-2", null, "SYNTHETIC");

    PaymentCallOutcome outcome = client.applyLeg("http://localhost:9001", "idemp-key-2", request);

    assertThat(outcome.status()).isEqualTo(CallStatus.REJECTED);
    assertThat(outcome.reasonCode()).isEqualTo("AC01");
    mockServer.verify();
  }

  @Test
  @DisplayName("HTTP 200/201 with COMPLETED is classified as COMPLETED")
  void http200ClassifiedAsCompleted() {
    mockServer
        .expect(requestTo("http://localhost:9001/finsim/v1/payments"))
        .andExpect(method(HttpMethod.POST))
        .andRespond(
            withSuccess(
                "{\"status\": \"COMPLETED\", \"participantReference\": \"PART-REF-99\"}",
                MediaType.APPLICATION_JSON));

    LegRequestPayload request =
        new LegRequestPayload(
            "tx-3", "DEBIT", "ACC-1", new MoneyPayload("10.00", "USD"), "REF-3", null, "SYNTHETIC");

    PaymentCallOutcome outcome = client.applyLeg("http://localhost:9001", "idemp-key-3", request);

    assertThat(outcome.status()).isEqualTo(CallStatus.COMPLETED);
    assertThat(outcome.participantReference()).isEqualTo("PART-REF-99");
    mockServer.verify();
  }

  @Test
  @DisplayName(
      "Issue #116: HTTP 200 with status ACCEPTED is classified as TIMED_OUT (holds in UNKNOWN)")
  void http200WithAcceptedClassifiedAsTimedOut() {
    mockServer
        .expect(requestTo("http://localhost:9001/finsim/v1/payments"))
        .andExpect(method(HttpMethod.POST))
        .andRespond(
            withSuccess(
                "{\"status\": \"ACCEPTED\", \"participantReference\": \"ASYNC-REF-1\"}",
                MediaType.APPLICATION_JSON));

    LegRequestPayload request =
        new LegRequestPayload(
            "tx-4", "DEBIT", "ACC-1", new MoneyPayload("10.00", "USD"), "REF-4", null, "SYNTHETIC");

    PaymentCallOutcome outcome = client.applyLeg("http://localhost:9001", "idemp-key-4", request);

    assertThat(outcome.status()).isEqualTo(CallStatus.TIMED_OUT);
    assertThat(outcome.errorMessage()).contains("asynchronous status: ACCEPTED");
    mockServer.verify();
  }

  @Test
  @DisplayName(
      "Issue #116: HTTP 200 with status PENDING is classified as TIMED_OUT (holds in UNKNOWN)")
  void http200WithPendingClassifiedAsTimedOut() {
    mockServer
        .expect(requestTo("http://localhost:9001/finsim/v1/payments"))
        .andExpect(method(HttpMethod.POST))
        .andRespond(
            withSuccess(
                "{\"status\": \"PENDING\", \"participantReference\": \"PENDING-REF-1\"}",
                MediaType.APPLICATION_JSON));

    LegRequestPayload request =
        new LegRequestPayload(
            "tx-5", "DEBIT", "ACC-1", new MoneyPayload("10.00", "USD"), "REF-5", null, "SYNTHETIC");

    PaymentCallOutcome outcome = client.applyLeg("http://localhost:9001", "idemp-key-5", request);

    assertThat(outcome.status()).isEqualTo(CallStatus.TIMED_OUT);
    assertThat(outcome.errorMessage()).contains("asynchronous status: PENDING");
    mockServer.verify();
  }

  @Test
  @DisplayName(
      "Issue #116: HTTP 200 with application status REJECTED is classified as REJECTED with reasonCode")
  void http200WithRejectedClassifiedAsRejected() {
    mockServer
        .expect(requestTo("http://localhost:9001/finsim/v1/payments"))
        .andExpect(method(HttpMethod.POST))
        .andRespond(
            withSuccess(
                "{\"status\": \"REJECTED\", \"reasonCode\": \"AM04\", \"participantReference\": \"REJ-1\"}",
                MediaType.APPLICATION_JSON));

    LegRequestPayload request =
        new LegRequestPayload(
            "tx-6", "DEBIT", "ACC-1", new MoneyPayload("10.00", "USD"), "REF-6", null, "SYNTHETIC");

    PaymentCallOutcome outcome = client.applyLeg("http://localhost:9001", "idemp-key-6", request);

    assertThat(outcome.status()).isEqualTo(CallStatus.REJECTED);
    assertThat(outcome.reasonCode()).isEqualTo("AM04");
    mockServer.verify();
  }

  @Test
  @DisplayName(
      "Issue #116: HTTP 200 with missing, empty, or unknown status is classified as TIMED_OUT")
  void http200WithUnknownOrMissingStatusClassifiedAsTimedOut() {
    mockServer
        .expect(requestTo("http://localhost:9001/finsim/v1/payments"))
        .andExpect(method(HttpMethod.POST))
        .andRespond(
            withSuccess(
                "{\"status\": \"SOME_FUTURE_STATUS\", \"participantReference\": \"REF-UNKNOWN\"}",
                MediaType.APPLICATION_JSON));

    LegRequestPayload request =
        new LegRequestPayload(
            "tx-7", "DEBIT", "ACC-1", new MoneyPayload("10.00", "USD"), "REF-7", null, "SYNTHETIC");

    PaymentCallOutcome outcome = client.applyLeg("http://localhost:9001", "idemp-key-7", request);

    assertThat(outcome.status()).isEqualTo(CallStatus.TIMED_OUT);
    assertThat(outcome.errorMessage())
        .contains("Unrecognized participant leg status: SOME_FUTURE_STATUS");
    mockServer.verify();
  }

  @Test
  @DisplayName(
      "Issue #128: Cloud metadata address (169.254.169.254) is rejected without network call")
  void metadataAddressIsBlocked() {
    LegRequestPayload request =
        new LegRequestPayload(
            "tx-8", "DEBIT", "ACC-1", new MoneyPayload("10.00", "USD"), "REF-8", null, "SYNTHETIC");

    PaymentCallOutcome outcome =
        client.applyLeg("http://169.254.169.254:80", "idemp-key-8", request);

    assertThat(outcome.status()).isEqualTo(CallStatus.REJECTED);
    assertThat(outcome.reasonCode()).isEqualTo("ROUTING_ERROR");
    assertThat(outcome.errorMessage()).contains("link-local or metadata address is not allowed");
    // Verify no HTTP call was dispatched to mockServer
    mockServer.verify();

    assertThatThrownBy(() -> client.queryLegStatus("http://169.254.169.254:80", "tx-8", "DEBIT"))
        .isInstanceOf(SecurityException.class)
        .hasMessageContaining("link-local or metadata address is not allowed");
  }

  @Test
  @DisplayName(
      "Issue #128 / #146: In production (allowPrivateAddresses=false), private/loopback addresses are rejected in both applyLeg and queryLegStatus")
  void privateAddressesBlockedInProduction() {
    ParticipantClient prodClient = new ParticipantClient(restClientBuilder.build(), false);

    LegRequestPayload request =
        new LegRequestPayload(
            "tx-9", "DEBIT", "ACC-1", new MoneyPayload("10.00", "USD"), "REF-9", null, "SYNTHETIC");

    PaymentCallOutcome outcome =
        prodClient.applyLeg("http://127.0.0.1:9001", "idemp-key-9", request);

    assertThat(outcome.status()).isEqualTo(CallStatus.REJECTED);
    assertThat(outcome.reasonCode()).isEqualTo("ROUTING_ERROR");
    assertThat(outcome.errorMessage())
        .contains("private or loopback address is not allowed in production");
    mockServer.verify();

    assertThatThrownBy(() -> prodClient.queryLegStatus("http://127.0.0.1:9001", "tx-9", "DEBIT"))
        .isInstanceOf(SecurityException.class)
        .hasMessageContaining("private or loopback address is not allowed in production");
  }

  @Test
  @DisplayName(
      "Issue #137: In production (allowPrivateAddresses=false), IPv6 ULA (fc00::/7) and CGNAT (100.64.0.0/10) are rejected")
  void ipv6UlaAndCgnatBlockedInProduction() {
    ParticipantClient prodClient = new ParticipantClient(restClientBuilder.build(), false);
    LegRequestPayload request =
        new LegRequestPayload(
            "tx-10",
            "DEBIT",
            "ACC-1",
            new MoneyPayload("10.00", "USD"),
            "REF-10",
            null,
            "SYNTHETIC");

    for (String blockedUrl :
        List.of(
            "http://[fd00::1]:9001",
            "http://[fc00::1]:9001",
            "http://100.64.0.1:9001",
            "http://100.127.255.254:9001")) {
      PaymentCallOutcome outcome = prodClient.applyLeg(blockedUrl, "idemp-key-10", request);
      assertThat(outcome.status()).isEqualTo(CallStatus.REJECTED);
      assertThat(outcome.reasonCode()).isEqualTo("ROUTING_ERROR");
      assertThatThrownBy(() -> prodClient.queryLegStatus(blockedUrl, "tx-10", "DEBIT"))
          .isInstanceOf(SecurityException.class);
    }
    mockServer.verify();
  }

  @Test
  @DisplayName(
      "Issue #136: Whitelisted internalHosts are permitted in strict mode while link-local metadata and non-whitelisted internal hosts remain blocked")
  void internalHostsWhitelistAllowsDockerServicesWithoutWeakeningMetadataOrPrivateSsrf() {
    ParticipantClient prodWithWhitelist =
        new ParticipantClient(restClientBuilder.build(), false, List.of("bank-a", "bank-b")) {
          @Override
          InetAddress[] resolveHostAddresses(String host) throws UnknownHostException {
            return switch (host) {
              case "bank-a" ->
                  new InetAddress[] {InetAddress.getByAddress(new byte[] {(byte) 172, 18, 0, 3})};
              case "bank-b" ->
                  new InetAddress[] {
                    InetAddress.getByAddress(
                        new byte[] {(byte) 169, (byte) 254, (byte) 169, (byte) 254})
                  };
              case "evil-internal" ->
                  new InetAddress[] {InetAddress.getByAddress(new byte[] {(byte) 172, 18, 0, 9})};
              default -> super.resolveHostAddresses(host);
            };
          }
        };

    mockServer
        .expect(requestTo("http://bank-a:9001/finsim/v1/payments"))
        .andExpect(method(HttpMethod.POST))
        .andRespond(
            withSuccess(
                "{\"status\": \"COMPLETED\", \"participantReference\": \"DOCKER-OK\"}",
                MediaType.APPLICATION_JSON));

    LegRequestPayload request =
        new LegRequestPayload(
            "tx-11",
            "DEBIT",
            "ACC-1",
            new MoneyPayload("10.00", "USD"),
            "REF-11",
            null,
            "SYNTHETIC");

    PaymentCallOutcome allowed =
        prodWithWhitelist.applyLeg("http://bank-a:9001", "idemp-key-11", request);
    assertThat(allowed.status()).isEqualTo(CallStatus.COMPLETED);
    mockServer.verify();

    // Even a whitelisted hostname cannot resolve to link-local / metadata IP
    PaymentCallOutcome metadataRebind =
        prodWithWhitelist.applyLeg("http://bank-b:9002", "idemp-key-12", request);
    assertThat(metadataRebind.status()).isEqualTo(CallStatus.REJECTED);
    assertThat(metadataRebind.reasonCode()).isEqualTo("ROUTING_ERROR");
    assertThat(metadataRebind.errorMessage()).contains("link-local or metadata address");

    // Non-whitelisted host resolving to RFC 1918 is still blocked
    PaymentCallOutcome nonWhitelisted =
        prodWithWhitelist.applyLeg("http://evil-internal:9003", "idemp-key-13", request);
    assertThat(nonWhitelisted.status()).isEqualTo(CallStatus.REJECTED);
    assertThat(nonWhitelisted.reasonCode()).isEqualTo("ROUTING_ERROR");
    assertThat(nonWhitelisted.errorMessage())
        .contains("private or loopback address is not allowed in production");
  }
}
