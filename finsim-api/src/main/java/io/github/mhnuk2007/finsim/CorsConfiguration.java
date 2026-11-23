package io.github.mhnuk2007.finsim;

import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * Cross-Origin Resource Sharing (CORS) configuration for FinSim REST APIs.
 *
 * <p>Configured via {@code finsim.cors.allowed-origins}. If unset, empty, or whitespace, CORS is
 * not enabled (secure by default).
 */
@Configuration
public class CorsConfiguration implements WebMvcConfigurer {

  private final List<String> allowedOrigins;

  public CorsConfiguration(@Value("${finsim.cors.allowed-origins:}") List<String> allowedOrigins) {
    this.allowedOrigins =
        allowedOrigins == null
            ? List.of()
            : allowedOrigins.stream().map(String::trim).filter(s -> !s.isEmpty()).toList();
  }

  @Override
  public void addCorsMappings(CorsRegistry registry) {
    if (allowedOrigins.isEmpty()) {
      return;
    }
    registry
        .addMapping("/**")
        .allowedOriginPatterns(allowedOrigins.toArray(new String[0]))
        .allowedMethods("GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS")
        .allowedHeaders("*")
        .exposedHeaders("Idempotency-Key", "Location", "Content-Type", "X-Request-Id")
        .maxAge(3600);
  }
}
