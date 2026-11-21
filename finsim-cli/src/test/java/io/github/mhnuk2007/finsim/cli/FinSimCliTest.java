package io.github.mhnuk2007.finsim.cli;

import static org.assertj.core.api.Assertions.assertThat;

import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import picocli.CommandLine;

class FinSimCliTest {

  private HttpServer server;
  private final AtomicReference<String> lastMethod = new AtomicReference<>();
  private final AtomicReference<String> lastPath = new AtomicReference<>();
  private final AtomicReference<String> lastBody = new AtomicReference<>();
  private final AtomicReference<String> lastIdempotencyKey = new AtomicReference<>();

  @AfterEach
  void stopServer() {
    if (server != null) {
      server.stop(0);
    }
  }

  /** Starts a stub FinSim that answers every request with the given status and body. */
  private String stubFinSim(int status, String responseBody) throws IOException {
    server = HttpServer.create(new InetSocketAddress("localhost", 0), 0);
    server.createContext(
        "/",
        exchange -> {
          lastMethod.set(exchange.getRequestMethod());
          lastPath.set(exchange.getRequestURI().getPath());
          lastIdempotencyKey.set(exchange.getRequestHeaders().getFirst("Idempotency-Key"));
          lastBody.set(
              new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
          byte[] bytes = responseBody.getBytes(StandardCharsets.UTF_8);
          exchange.getResponseHeaders().add("Content-Type", "application/json");
          exchange.sendResponseHeaders(status, bytes.length);
          exchange.getResponseBody().write(bytes);
          exchange.close();
        });
    server.start();
    return "http://localhost:" + server.getAddress().getPort();
  }

  private record Result(int exit, String out, String err) {}

  private static Result run(String... args) {
    StringWriter out = new StringWriter();
    StringWriter err = new StringWriter();
    CommandLine cli = new CommandLine(new FinSimCli());
    cli.setOut(new PrintWriter(out));
    cli.setErr(new PrintWriter(err));
    int exit = cli.execute(args);
    return new Result(exit, out.toString(), err.toString());
  }

  @Test
  void helpExitsCleanly() {
    assertThat(run("--help").exit()).isZero();
  }

  @Test
  void everySubcommandAcceptsHelp() {
    for (String subcommand :
        List.of(
            "register",
            "institutions",
            "networks",
            "directory",
            "join",
            "verify",
            "transfer",
            "trace",
            "resolve",
            "fault")) {
      Result result = run(subcommand, "--help");
      assertThat(result.exit()).isZero();
      assertThat(result.out()).contains("Usage: finsim " + subcommand);
    }
  }

  @Test
  void shortHelpFlagWorksOnASubcommand() {
    Result result = run("register", "-h");
    assertThat(result.exit()).isZero();
    assertThat(result.out()).contains("Usage: finsim register");
  }

  @Test
  void verifyRequiresParticipantUrl() {
    assertThat(run("verify").exit()).isEqualTo(CommandLine.ExitCode.USAGE);
  }

  @Test
  void verifyValidatesUrlAndTimeoutBeforeSendingRequests() {
    assertThat(run("verify", "--url", "file:///tmp/bank").exit())
        .isEqualTo(CommandLine.ExitCode.USAGE);
    assertThat(run("verify", "--url", "http://localhost:1", "--timeout-ms", "0").exit())
        .isEqualTo(CommandLine.ExitCode.USAGE);
  }

  @Test
  void verifyJsonFailureIsMachineReadableAndReturnsOne() {
    Result result = run("verify", "--url", "http://localhost:1", "--json", "--timeout-ms", "100");
    assertThat(result.exit()).isEqualTo(FinSimCli.EXIT_FAILED);
    assertThat(ContractJson.parse(result.out().strip())).isInstanceOf(java.util.Map.class);
    assertThat(result.out()).doesNotContain("[FAIL]").doesNotContain("Warning:");
    assertThat(result.err()).contains("failed");
  }

  @Test
  void registerSendsTheInstitutionAndPrintsTheResponse() throws Exception {
    String url = stubFinSim(201, "{\"id\":\"my-bank\"}");

    Result result =
        run(
            "register",
            "--finsim",
            url,
            "--id",
            "my-bank",
            "--name",
            "My \"Bank\"",
            "--base-url",
            "http://localhost:9100",
            "--capabilities",
            "ACCOUNT_DEBIT,ACCOUNT_CREDIT,STATUS_QUERY");

    assertThat(result.exit()).isZero();
    assertThat(result.out()).contains("my-bank");
    assertThat(lastMethod.get()).isEqualTo("POST");
    assertThat(lastPath.get()).isEqualTo("/api/v1/institutions");
    assertThat(lastBody.get())
        .contains("\"id\":\"my-bank\"")
        .contains("\"name\":\"My \\\"Bank\\\"\"")
        .contains("\"type\":\"BANK\"")
        .contains("\"capabilities\":[\"ACCOUNT_DEBIT\",\"ACCOUNT_CREDIT\",\"STATUS_QUERY\"]");
  }

  @Test
  void registerTrimsWhitespaceFromCapabilities() {
    String body =
        FinSimCli.Register.body(
            "my-bank",
            "My Bank",
            "BANK",
            "http://localhost:9100",
            List.of(" ACCOUNT_DEBIT ", "  ACCOUNT_CREDIT", "STATUS_QUERY  "));
    assertThat(body)
        .contains("\"capabilities\":[\"ACCOUNT_DEBIT\",\"ACCOUNT_CREDIT\",\"STATUS_QUERY\"]");
  }

  @Test
  void aFailureResponseGivesAReadableErrorAndANonZeroExit() throws Exception {
    String url = stubFinSim(409, "{\"code\":\"INSTITUTION_ALREADY_EXISTS\"}");

    Result result =
        run(
            "register",
            "--finsim",
            url,
            "--id",
            "my-bank",
            "--name",
            "x",
            "--base-url",
            "http://localhost:9100",
            "--capabilities",
            "STATUS_QUERY");

    assertThat(result.exit()).isEqualTo(FinSimCli.EXIT_FAILED);
    assertThat(result.err()).contains("409").contains("INSTITUTION_ALREADY_EXISTS");
  }

  @Test
  void listingInstitutionsAndNetworksUsesTheRightPaths() throws Exception {
    String url = stubFinSim(200, "[]");

    assertThat(run("institutions", "--finsim", url).exit()).isZero();
    assertThat(lastPath.get()).isEqualTo("/api/v1/institutions");

    assertThat(run("institutions", "--finsim", url, "--id", "bank-a").exit()).isZero();
    assertThat(lastPath.get()).isEqualTo("/api/v1/institutions/bank-a");

    assertThat(run("networks", "--finsim", url, "--id", "sandbox").exit()).isZero();
    assertThat(lastPath.get()).isEqualTo("/api/v1/networks/sandbox");

    assertThat(run("networks", "--finsim", url, "--id", "sandbox", "--directory").exit()).isZero();
    assertThat(lastPath.get()).isEqualTo("/api/v1/networks/sandbox/directory");

    assertThat(run("directory", "--finsim", url, "--network", "sandbox").exit()).isZero();
    assertThat(lastPath.get()).isEqualTo("/api/v1/networks/sandbox/directory");
  }

  @Test
  void joinPostsTheMember() throws Exception {
    String url = stubFinSim(200, "{}");

    Result result = run("join", "--finsim", url, "--network", "sandbox", "--institution", "bank-a");

    assertThat(result.exit()).isZero();
    assertThat(lastPath.get()).isEqualTo("/api/v1/networks/sandbox/members");
    assertThat(lastBody.get()).isEqualTo("{\"institutionId\":\"bank-a\"}");
  }

  @Test
  void anUnreachableFinSimIsAClearError() {
    Result result = run("institutions", "--finsim", "http://localhost:1");

    assertThat(result.exit()).isEqualTo(FinSimCli.EXIT_FAILED);
    assertThat(result.err()).contains("Cannot reach FinSim");
  }

  @Test
  void jsonFlagPrintsRawJsonWithoutExtraText() throws Exception {
    String body = "[{\"id\":\"bank-a\",\"name\":\"Bank A\"}]";
    String url = stubFinSim(200, body);

    Result result = run("institutions", "--json", "--finsim", url);

    assertThat(result.exit()).isZero();
    assertThat(result.out().strip()).isEqualTo(body);
    assertThat(result.err()).isEmpty();
  }

  @Test
  void shortJsonFlagBehavesLikeLongForm() throws Exception {
    String body = "[{\"id\":\"bank-a\"}]";
    String url = stubFinSim(200, body);

    Result result = run("institutions", "-j", "--finsim", url);

    assertThat(result.exit()).isZero();
    assertThat(result.out().strip()).isEqualTo(body);
    assertThat(result.err()).isEmpty();
  }

  @Test
  void defaultOutputIsUnchangedWithoutJsonFlag() throws Exception {
    String body = "[{\"id\":\"bank-a\"}]";
    String url = stubFinSim(200, body);

    Result result = run("institutions", "--finsim", url);

    assertThat(result.exit()).isZero();
    assertThat(result.out().strip()).isEqualTo(body);
  }

  @Test
  void jsonFlagKeepsErrorsOnStderr() throws Exception {
    String url = stubFinSim(409, "{\"code\":\"INSTITUTION_ALREADY_EXISTS\"}");

    Result result = run("institutions", "--json", "--finsim", url);

    assertThat(result.exit()).isEqualTo(FinSimCli.EXIT_FAILED);
    assertThat(result.out()).isEmpty();
    assertThat(result.err()).contains("409").contains("INSTITUTION_ALREADY_EXISTS");
  }

  @Test
  void jsonQuotingEscapesSpecialCharacters() {
    assertThat(Json.quote("a\"b\\c\nd")).isEqualTo("\"a\\\"b\\\\c\\nd\"");
    assertThat(Json.array(List.of("X", "Y"))).isEqualTo("[\"X\",\"Y\"]");
  }

  @Test
  void traceCommandDispatchesGetWithTransactionId() throws Exception {
    String body = "{\"transactionId\":\"tx-123\",\"events\":[]}";
    String url = stubFinSim(200, body);

    Result result = run("trace", "--id", "tx-123", "--finsim", url);

    assertThat(result.exit()).isZero();
    assertThat(lastMethod.get()).isEqualTo("GET");
    assertThat(lastPath.get()).isEqualTo("/api/v1/transfers/tx-123/trace");
    assertThat(result.out().strip()).isEqualTo(body);
  }

  @Test
  void traceCommandAcceptsShortIdFlag() throws Exception {
    String body = "{\"transactionId\":\"tx-456\",\"events\":[]}";
    String url = stubFinSim(200, body);

    Result result = run("trace", "-t", "tx-456", "--finsim", url);

    assertThat(result.exit()).isZero();
    assertThat(lastMethod.get()).isEqualTo("GET");
    assertThat(lastPath.get()).isEqualTo("/api/v1/transfers/tx-456/trace");
  }

  @Test
  void traceCommandAcceptsPositionalTransactionId() throws Exception {
    String body = "{\"transactionId\":\"tx-789\",\"events\":[]}";
    String url = stubFinSim(200, body);

    Result result = run("trace", "tx-789", "--finsim", url);

    assertThat(result.exit()).isZero();
    assertThat(lastMethod.get()).isEqualTo("GET");
    assertThat(lastPath.get()).isEqualTo("/api/v1/transfers/tx-789/trace");
  }

  @Test
  void traceCommandRequiresTransactionId() {
    Result result = run("trace");

    assertThat(result.exit()).isEqualTo(CommandLine.ExitCode.USAGE);
    assertThat(result.err()).contains("Transaction ID is required");
  }

  @Test
  void transferCommandDispatchesPostWithParsedParties() throws Exception {
    String body = "{\"transactionId\":\"tx-001\",\"state\":\"COMPLETED\"}";
    String url = stubFinSim(200, body);

    Result result =
        run(
            "transfer",
            "--finsim",
            url,
            "--network",
            "sandbox",
            "--from",
            "bank-a:ACC-1",
            "--to",
            "bank-b:ACC-2",
            "--amount",
            "100.00",
            "--currency",
            "USD",
            "--reference",
            "DEMO-001",
            "--idempotency-key",
            "custom-key-123");

    assertThat(result.exit()).isZero();
    assertThat(lastMethod.get()).isEqualTo("POST");
    assertThat(lastPath.get()).isEqualTo("/api/v1/networks/sandbox/transfers");
    assertThat(lastIdempotencyKey.get()).isEqualTo("custom-key-123");
    assertThat(lastBody.get())
        .contains("\"from\":{\"institutionId\":\"bank-a\",\"accountReference\":\"ACC-1\"}")
        .contains("\"to\":{\"institutionId\":\"bank-b\",\"accountReference\":\"ACC-2\"}")
        .contains("\"money\":{\"amount\":\"100.00\",\"currency\":\"USD\"}")
        .contains("\"reference\":\"DEMO-001\"");
    assertThat(result.out().strip()).isEqualTo(body);
  }

  @Test
  void transferCommandAllowsSeparateAccountFlags() throws Exception {
    String body = "{\"transactionId\":\"tx-002\",\"state\":\"COMPLETED\"}";
    String url = stubFinSim(200, body);

    Result result =
        run(
            "transfer",
            "--finsim",
            url,
            "--from",
            "bank-a",
            "--from-account",
            "ACC-1",
            "--to",
            "bank-b",
            "--to-account",
            "ACC-2",
            "--amount",
            "50.00");

    assertThat(result.exit()).isZero();
    assertThat(lastMethod.get()).isEqualTo("POST");
    assertThat(lastPath.get()).isEqualTo("/api/v1/networks/sandbox/transfers");
    assertThat(lastIdempotencyKey.get()).isNotBlank();
    assertThat(lastBody.get())
        .contains("\"from\":{\"institutionId\":\"bank-a\",\"accountReference\":\"ACC-1\"}")
        .contains("\"to\":{\"institutionId\":\"bank-b\",\"accountReference\":\"ACC-2\"}")
        .contains("\"money\":{\"amount\":\"50.00\",\"currency\":\"USD\"}");
  }

  @Test
  void resolveCommandDispatchesPostWithTransactionId() throws Exception {
    String body = "{\"transactionId\":\"tx-rec-1\",\"state\":\"COMPLETED\"}";
    String url = stubFinSim(200, body);

    Result result = run("resolve", "--id", "tx-rec-1", "--finsim", url);

    assertThat(result.exit()).isZero();
    assertThat(lastMethod.get()).isEqualTo("POST");
    assertThat(lastPath.get()).isEqualTo("/api/v1/transfers/tx-rec-1/resolve");
    assertThat(result.out().strip()).isEqualTo(body);
  }

  @Test
  void resolveCommandAcceptsPositionalTransactionId() throws Exception {
    String body = "{\"transactionId\":\"tx-rec-2\",\"state\":\"REJECTED\"}";
    String url = stubFinSim(200, body);

    Result result = run("resolve", "tx-rec-2", "--finsim", url);

    assertThat(result.exit()).isZero();
    assertThat(lastMethod.get()).isEqualTo("POST");
    assertThat(lastPath.get()).isEqualTo("/api/v1/transfers/tx-rec-2/resolve");
  }

  @Test
  void resolveCommandRequiresTransactionId() {
    Result result = run("resolve");

    assertThat(result.exit()).isEqualTo(CommandLine.ExitCode.USAGE);
    assertThat(result.err()).contains("Transaction ID is required");
  }

  @Test
  void faultAddDispatchesPostWithAllConfiguredFields() throws Exception {
    String body = "{\"faultId\":\"f-1\",\"target\":\"bank-b\",\"type\":\"DELAY\"}";
    String url = stubFinSim(201, body);

    Result result =
        run(
            "fault",
            "add",
            "--finsim",
            url,
            "--target",
            "bank-b",
            "--type",
            "DELAY",
            "--delay",
            "500",
            "--probability",
            "0.8",
            "--times",
            "3",
            "--seed",
            "42");

    assertThat(result.exit()).isZero();
    assertThat(lastMethod.get()).isEqualTo("POST");
    assertThat(lastPath.get()).isEqualTo("/api/v1/faults");
    assertThat(lastBody.get())
        .contains("\"target\":\"bank-b\"")
        .contains("\"type\":\"DELAY\"")
        .contains("\"delayMs\":500")
        .contains("\"probability\":0.8")
        .contains("\"times\":3")
        .contains("\"seed\":42");
    assertThat(result.out().strip()).isEqualTo(body);
  }

  @Test
  void faultListDispatchesGetToFaults() throws Exception {
    String body = "[{\"faultId\":\"f-1\"}]";
    String url = stubFinSim(200, body);

    Result result = run("fault", "list", "--finsim", url);

    assertThat(result.exit()).isZero();
    assertThat(lastMethod.get()).isEqualTo("GET");
    assertThat(lastPath.get()).isEqualTo("/api/v1/faults");
    assertThat(result.out().strip()).isEqualTo(body);
  }

  @Test
  void faultRemoveDispatchesDeleteById() throws Exception {
    String url = stubFinSim(204, "");

    Result result = run("fault", "remove", "--id", "f-123", "--finsim", url);

    assertThat(result.exit()).isZero();
    assertThat(lastMethod.get()).isEqualTo("DELETE");
    assertThat(lastPath.get()).isEqualTo("/api/v1/faults/f-123");
  }

  @Test
  void faultRemoveAcceptsPositionalId() throws Exception {
    String url = stubFinSim(204, "");

    Result result = run("fault", "remove", "f-456", "--finsim", url);

    assertThat(result.exit()).isZero();
    assertThat(lastMethod.get()).isEqualTo("DELETE");
    assertThat(lastPath.get()).isEqualTo("/api/v1/faults/f-456");
  }

  @Test
  void faultRemoveRequiresId() {
    Result result = run("fault", "remove");

    assertThat(result.exit()).isEqualTo(CommandLine.ExitCode.USAGE);
    assertThat(result.err()).contains("Fault rule ID is required");
  }
}
