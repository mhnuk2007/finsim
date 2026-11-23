package io.github.mhnuk2007.finsim.cli;

import java.io.IOException;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import picocli.CommandLine;
import picocli.CommandLine.Command;
import picocli.CommandLine.Mixin;
import picocli.CommandLine.Model.CommandSpec;
import picocli.CommandLine.Option;
import picocli.CommandLine.Parameters;
import picocli.CommandLine.Spec;

/** The {@code finsim} command line. */
@Command(
    name = "finsim",
    mixinStandardHelpOptions = true,
    version = "finsim 0.1.0-SNAPSHOT",
    description = "Simulate financial networks: connect services, run transfers, inject faults.",
    subcommands = {
      FinSimCli.Register.class,
      FinSimCli.Institutions.class,
      FinSimCli.Networks.class,
      FinSimCli.Directory.class,
      FinSimCli.Join.class,
      FinSimCli.Verify.class,
      FinSimCli.Transfer.class,
      FinSimCli.Trace.class,
      FinSimCli.Resolve.class,
      FinSimCli.Fault.class
    })
public class FinSimCli implements Runnable {

  static final int EXIT_FAILED = 1;
  static final int EXIT_NOT_IMPLEMENTED = 2;

  public static void main(String[] args) {
    System.exit(new CommandLine(new FinSimCli()).execute(args));
  }

  @Override
  public void run() {
    CommandLine.usage(this, System.out);
  }

  /** Where FinSim is running. */
  static class Connection {
    @Option(
        names = "--finsim",
        description = "FinSim base URL (env FINSIM_URL). Default: ${DEFAULT-VALUE}",
        defaultValue = "${env:FINSIM_URL:-http://localhost:8080}")
    String finsimUrl;

    FinSimClient client() {
      return new FinSimClient(finsimUrl);
    }
  }

  /**
   * Runs a request, prints the JSON on success or the error on failure, and picks the exit code.
   */
  abstract static class ApiCommand implements Callable<Integer> {
    @Mixin Connection connection = new Connection();
    @Spec CommandSpec spec;

    @Option(
        names = {"--json", "-j"},
        description = "Output raw JSON")
    boolean jsonMode;

    abstract FinSimClient.Response execute(FinSimClient client)
        throws IOException, InterruptedException;

    @Override
    public Integer call() {
      FinSimClient client = connection.client();
      try {
        FinSimClient.Response response = execute(client);
        if (response.ok()) {
          printSuccess(response.body());
          return 0;
        }
        spec.commandLine()
            .getErr()
            .println("FinSim answered HTTP " + response.status() + ": " + response.body());
        return EXIT_FAILED;
      } catch (IllegalArgumentException e) {
        spec.commandLine().getErr().println(e.getMessage());
        return CommandLine.ExitCode.USAGE;
      } catch (IOException e) {
        spec.commandLine()
            .getErr()
            .println(
                "Cannot reach FinSim at "
                    + client.baseUrl()
                    + ". Is it running? ("
                    + e.getMessage()
                    + ")");
        return EXIT_FAILED;
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
        return EXIT_FAILED;
      }
    }

    /**
     * Prints a successful response. JSON mode pins the machine-readable contract: the raw payload
     * only, with nothing else on stdout. The default output is the same payload today (the CLI has
     * no table formatting yet); when human-readable formatting is added it must branch on {@code
     * jsonMode} and keep this path raw.
     */
    private void printSuccess(String body) {
      spec.commandLine().getOut().println(body);
    }
  }

  @Command(
      name = "register",
      mixinStandardHelpOptions = true,
      description = "Register an institution with FinSim (idempotent by id).")
  static class Register extends ApiCommand {
    @Option(names = "--id", required = true, description = "Short id, for example bank-a.")
    String id;

    @Option(names = "--name", required = true, description = "Display name.")
    String name;

    @Option(
        names = "--type",
        defaultValue = "BANK",
        description = "BANK, MERCHANT, PAYMENT_GATEWAY, or CUSTOM. Default: ${DEFAULT-VALUE}")
    String type;

    @Option(
        names = "--base-url",
        required = true,
        description = "Where the institution serves the finsim/v1 contract.")
    String baseUrl;

    @Option(
        names = "--capabilities",
        required = true,
        split = ",",
        description = "Comma-separated: ACCOUNT_DEBIT, ACCOUNT_CREDIT, STATUS_QUERY.")
    List<String> capabilities;

    static String body(
        String id, String name, String type, String baseUrl, List<String> capabilities) {
      List<String> trimmedCapabilities =
          capabilities == null
              ? List.of()
              : capabilities.stream().map(String::trim).filter(s -> !s.isEmpty()).toList();
      return "{\"id\":"
          + Json.quote(id)
          + ",\"name\":"
          + Json.quote(name)
          + ",\"type\":"
          + Json.quote(type)
          + ",\"baseUrl\":"
          + Json.quote(baseUrl)
          + ",\"capabilities\":"
          + Json.array(trimmedCapabilities)
          + "}";
    }

    @Override
    FinSimClient.Response execute(FinSimClient client) throws IOException, InterruptedException {
      return client.post("/api/v1/institutions", body(id, name, type, baseUrl, capabilities));
    }
  }

  @Command(
      name = "institutions",
      mixinStandardHelpOptions = true,
      description = "List registered institutions, or show one with --id.")
  static class Institutions extends ApiCommand {
    @Option(names = "--id", description = "Show a single institution.")
    String id;

    @Override
    FinSimClient.Response execute(FinSimClient client) throws IOException, InterruptedException {
      return client.get(id == null ? "/api/v1/institutions" : "/api/v1/institutions/" + id);
    }
  }

  @Command(
      name = "networks",
      mixinStandardHelpOptions = true,
      description = "List networks, or show one with --id.")
  static class Networks extends ApiCommand {
    @Option(names = "--id", description = "Show a single network.")
    String id;

    @Option(
        names = "--directory",
        description = "Show participant directory for the network (requires --id).")
    boolean directory;

    @Override
    FinSimClient.Response execute(FinSimClient client) throws IOException, InterruptedException {
      if (id != null && directory) {
        return client.get("/api/v1/networks/" + id + "/directory");
      }
      return client.get(id == null ? "/api/v1/networks" : "/api/v1/networks/" + id);
    }
  }

  @Command(
      name = "directory",
      mixinStandardHelpOptions = true,
      description = "Show the participant directory for a network.")
  static class Directory extends ApiCommand {
    @Option(
        names = {"--network", "-n"},
        required = true,
        description = "Network id, for example sandbox.")
    String network;

    @Override
    FinSimClient.Response execute(FinSimClient client) throws IOException, InterruptedException {
      return client.get("/api/v1/networks/" + network + "/directory");
    }
  }

  @Command(
      name = "join",
      mixinStandardHelpOptions = true,
      description = "Add a registered institution to a network.")
  static class Join extends ApiCommand {
    @Option(names = "--network", required = true, description = "Network id, for example sandbox.")
    String network;

    @Option(names = "--institution", required = true, description = "Institution id.")
    String institution;

    @Override
    FinSimClient.Response execute(FinSimClient client) throws IOException, InterruptedException {
      return client.post(
          "/api/v1/networks/" + network + "/members",
          "{\"institutionId\":" + Json.quote(institution) + "}");
    }
  }

  /** Runs the public participant contract checks. */
  @Command(
      name = "verify",
      mixinStandardHelpOptions = true,
      description = "Verify a participant's conformance to the finsim/v1 contract.")
  static class Verify implements Callable<Integer> {
    @Spec CommandSpec spec;

    @Option(
        names = "--url",
        required = true,
        description = "Participant base URL, for example http://localhost:9001.")
    String url;

    @Option(names = "--verbose", description = "Show sanitized HTTP exchanges.")
    boolean verbose;

    @Option(
        names = {"--json", "-j"},
        description = "Output machine-readable results.")
    boolean json;

    @Option(
        names = "--timeout-ms",
        defaultValue = "5000",
        description = "Request timeout in milliseconds.")
    int timeoutMs;

    @Override
    public Integer call() {
      if (timeoutMs <= 0 || !ParticipantVerifier.validUrl(url)) {
        spec.commandLine().getErr().println("Invalid --url or --timeout-ms (must be positive).");
        return CommandLine.ExitCode.USAGE;
      }
      if (!json)
        spec.commandLine()
            .getOut()
            .println("Warning: successful checks can change synthetic account balances.");
      var result = new ParticipantVerifier(url, timeoutMs, verbose).run();
      if (json) {
        spec.commandLine().getOut().println(ParticipantVerifier.json(result));
        if (!result.passed())
          spec.commandLine().getErr().println("Participant verification failed.");
      } else {
        spec.commandLine()
            .getOut()
            .println("FinSim Participant Conformance Verification\nTarget: " + url);
        for (var phase : result.phases()) {
          spec.commandLine().getOut().println("[" + phase.status() + "] " + phase.name());
          for (String detail : phase.details()) spec.commandLine().getOut().println("  " + detail);
        }
        spec.commandLine()
            .getOut()
            .println(
                result.passed()
                    ? "All 7 conformance phases PASSED."
                    : "Participant verification FAILED.");
      }
      return result.passed() ? 0 : EXIT_FAILED;
    }
  }

  @Command(
      name = "transfer",
      mixinStandardHelpOptions = true,
      description = "Start a payment transfer between two institutions.")
  static class Transfer extends ApiCommand {
    @Option(
        names = {"--network", "-n"},
        defaultValue = "sandbox",
        description = "Network id. Default: ${DEFAULT-VALUE}")
    String network;

    @Option(
        names = "--from",
        required = true,
        description =
            "Debited party: <institution>:<account> or institution id (e.g. bank-a:ACC-1).")
    String from;

    @Option(
        names = "--from-account",
        description = "Debited account reference if --from is institution only.")
    String fromAccount;

    @Option(
        names = "--to",
        required = true,
        description =
            "Credited party: <institution>:<account> or institution id (e.g. bank-b:ACC-2).")
    String to;

    @Option(
        names = "--to-account",
        description = "Credited account reference if --to is institution only.")
    String toAccount;

    @Option(
        names = {"--amount", "-a"},
        required = true,
        description = "Monetary amount (e.g. 100.00).")
    String amount;

    @Option(
        names = {"--currency", "-c"},
        defaultValue = "USD",
        description = "Three-letter ISO currency code. Default: ${DEFAULT-VALUE}")
    String currency;

    @Option(
        names = {"--reference", "-r"},
        description = "Payment reference.")
    String reference;

    @Option(
        names = "--idempotency-key",
        description = "Unique idempotency key (defaults to generated UUID).")
    String idempotencyKey;

    @Override
    FinSimClient.Response execute(FinSimClient client) throws IOException, InterruptedException {
      String fromInst = from;
      String fromAcc = fromAccount;
      if (from != null && from.contains(":")) {
        String[] parts = from.split(":", 2);
        fromInst = parts[0];
        if (fromAcc == null || fromAcc.isBlank()) {
          fromAcc = parts[1];
        }
      }

      String toInst = to;
      String toAcc = toAccount;
      if (to != null && to.contains(":")) {
        String[] parts = to.split(":", 2);
        toInst = parts[0];
        if (toAcc == null || toAcc.isBlank()) {
          toAcc = parts[1];
        }
      }

      String key =
          (idempotencyKey != null && !idempotencyKey.isBlank())
              ? idempotencyKey
              : UUID.randomUUID().toString();

      StringBuilder sb = new StringBuilder();
      sb.append("{")
          .append("\"from\":{\"institutionId\":")
          .append(Json.quote(fromInst))
          .append(",\"accountReference\":")
          .append(Json.quote(fromAcc != null ? fromAcc : ""))
          .append("},\"to\":{\"institutionId\":")
          .append(Json.quote(toInst))
          .append(",\"accountReference\":")
          .append(Json.quote(toAcc != null ? toAcc : ""))
          .append("},\"money\":{\"amount\":")
          .append(Json.quote(amount))
          .append(",\"currency\":")
          .append(Json.quote(currency != null ? currency : "USD"))
          .append("}");
      String ref = (reference != null && !reference.isBlank()) ? reference : "CLI-TRANSFER";
      sb.append(",\"reference\":").append(Json.quote(ref));
      sb.append("}");

      return client.post("/api/v1/networks/" + network + "/transfers", sb.toString(), key);
    }
  }

  @Command(
      name = "trace",
      mixinStandardHelpOptions = true,
      description = "Show every stage, call, and fault for a transfer.")
  static class Trace extends ApiCommand {
    @Option(
        names = {"--id", "-t"},
        description = "Transfer transaction identifier.")
    String id;

    @Parameters(
        index = "0",
        arity = "0..1",
        description = "Transfer transaction identifier (positional).")
    String positionalId;

    @Override
    FinSimClient.Response execute(FinSimClient client) throws IOException, InterruptedException {
      String targetId = id != null ? id : positionalId;
      if (targetId == null || targetId.isBlank()) {
        throw new IllegalArgumentException(
            "Transaction ID is required via --id or positional argument.");
      }
      return client.get("/api/v1/transfers/" + targetId + "/trace");
    }
  }

  @Command(
      name = "resolve",
      mixinStandardHelpOptions = true,
      description = "Resolve an UNKNOWN transfer by querying leg statuses.")
  static class Resolve extends ApiCommand {
    @Option(
        names = {"--id", "-t"},
        description = "Transfer transaction identifier.")
    String id;

    @Parameters(
        index = "0",
        arity = "0..1",
        description = "Transfer transaction identifier (positional).")
    String positionalId;

    @Override
    FinSimClient.Response execute(FinSimClient client) throws IOException, InterruptedException {
      String targetId = id != null ? id : positionalId;
      if (targetId == null || targetId.isBlank()) {
        throw new IllegalArgumentException(
            "Transaction ID is required via --id or positional argument.");
      }
      return client.post("/api/v1/transfers/" + targetId + "/resolve");
    }
  }

  @Command(
      name = "fault",
      mixinStandardHelpOptions = true,
      description = "Manage simulation fault injection rules.",
      subcommands = {Fault.Add.class, Fault.ListCmd.class, Fault.Remove.class})
  static class Fault implements Runnable {
    @Override
    public void run() {
      CommandLine.usage(this, System.out);
    }

    @Command(
        name = "add",
        mixinStandardHelpOptions = true,
        description = "Add a fault injection rule (DELAY, TIMEOUT, DUPLICATE_DELIVERY).")
    static class Add extends ApiCommand {
      @Option(
          names = "--target",
          required = true,
          description = "Target institution id (e.g. bank-b).")
      String target;

      @Option(
          names = "--type",
          required = true,
          description = "Fault type: DELAY, TIMEOUT, DUPLICATE_DELIVERY.")
      String type;

      @Option(names = "--delay", description = "Milliseconds of delay for DELAY type.")
      Integer delayMs;

      @Option(
          names = "--probability",
          description = "Trigger probability between 0.0 and 1.0 (default 1.0).")
      Double probability;

      @Option(names = "--times", description = "Cap on number of times the fault triggers.")
      Integer times;

      @Option(names = "--seed", description = "PRNG seed for reproducible probabilistic faults.")
      Long seed;

      @Override
      FinSimClient.Response execute(FinSimClient client) throws IOException, InterruptedException {
        StringBuilder sb = new StringBuilder();
        sb.append("{")
            .append("\"target\":")
            .append(Json.quote(target))
            .append(",\"type\":")
            .append(Json.quote(type.toUpperCase()));
        if (delayMs != null) {
          sb.append(",\"delayMs\":").append(delayMs);
        }
        if (probability != null) {
          sb.append(",\"probability\":").append(probability);
        }
        if (times != null) {
          sb.append(",\"times\":").append(times);
        }
        if (seed != null) {
          sb.append(",\"seed\":").append(seed);
        }
        sb.append("}");
        return client.post("/api/v1/faults", sb.toString());
      }
    }

    @Command(
        name = "list",
        aliases = {"ls"},
        mixinStandardHelpOptions = true,
        description = "List active fault rules.")
    static class ListCmd extends ApiCommand {
      @Override
      FinSimClient.Response execute(FinSimClient client) throws IOException, InterruptedException {
        return client.get("/api/v1/faults");
      }
    }

    @Command(
        name = "remove",
        aliases = {"delete", "rm"},
        mixinStandardHelpOptions = true,
        description = "Remove a fault rule by id.")
    static class Remove extends ApiCommand {
      @Option(names = "--id", description = "Fault rule id.")
      String id;

      @Parameters(index = "0", arity = "0..1", description = "Fault rule id (positional).")
      String positionalId;

      @Override
      FinSimClient.Response execute(FinSimClient client) throws IOException, InterruptedException {
        String targetId = id != null ? id : positionalId;
        if (targetId == null || targetId.isBlank()) {
          throw new IllegalArgumentException(
              "Fault rule ID is required via --id or positional argument.");
        }
        return client.delete("/api/v1/faults/" + targetId);
      }
    }
  }
}
