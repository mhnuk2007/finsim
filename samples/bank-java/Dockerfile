# Stage 1: Build stage
FROM eclipse-temurin:21 AS builder
WORKDIR /workspace

# Copy source and build configurations
COPY gradlew .
COPY gradle gradle
COPY build.gradle.kts settings.gradle.kts .editorconfig ./
COPY finsim-core finsim-core
COPY finsim-registry finsim-registry
COPY finsim-sim finsim-sim
COPY finsim-api finsim-api
COPY finsim-cli finsim-cli
COPY samples/bank-java samples/bank-java

# Ensure executable permissions and Unix line endings for gradlew
RUN sed -i 's/\r$//' gradlew && chmod +x gradlew

# If a pre-built executable jar is present in the context, use it; otherwise build using Gradle
RUN mkdir -p /build-output && \
    JAR_PATH=$(ls samples/bank-java/build/libs/*.jar 2>/dev/null | grep -v 'plain' | head -n 1 || true) && \
    if [ -n "${JAR_PATH}" ] && [ -f "${JAR_PATH}" ]; then \
      echo "Using pre-built jar: ${JAR_PATH}"; \
      cp "${JAR_PATH}" /build-output/app.jar; \
    else \
      echo "Building sample-bank-java with Gradle..."; \
      ./gradlew :sample-bank-java:bootJar --no-daemon -x test && \
      BUILT_JAR=$(ls samples/bank-java/build/libs/*.jar | grep -v 'plain' | head -n 1) && \
      cp "${BUILT_JAR}" /build-output/app.jar; \
    fi

# Stage 2: Minimal runtime image
FROM eclipse-temurin:21
WORKDIR /app

RUN groupadd -g 1001 finsim && useradd -u 1001 -g finsim -s /bin/false finsim
USER finsim

COPY --from=builder /build-output/app.jar app.jar

EXPOSE 9001 9002
ENTRYPOINT ["java", "-jar", "app.jar"]
