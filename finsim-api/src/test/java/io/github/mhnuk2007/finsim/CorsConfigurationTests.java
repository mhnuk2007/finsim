package io.github.mhnuk2007.finsim;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;
import org.springframework.web.filter.CorsFilter;
import org.springframework.web.servlet.config.annotation.CorsRegistry;

class CorsConfigurationTests {

  @RestController
  static class DummyController {
    @GetMapping("/api/test")
    public ResponseEntity<String> test() {
      return ResponseEntity.ok("ok");
    }
  }

  static class TestCorsRegistry extends CorsRegistry {
    public Map<String, org.springframework.web.cors.CorsConfiguration> getConfigs() {
      return getCorsConfigurations();
    }
  }

  @Test
  void emptyAllowedOriginsDisablesCors() {
    CorsConfiguration config = new CorsConfiguration(List.of());
    TestCorsRegistry registry = new TestCorsRegistry();
    config.addCorsMappings(registry);

    assertThat(registry.getConfigs()).isEmpty();
  }

  @Test
  void whitespaceOrNullOriginsAreFiltered() {
    CorsConfiguration config =
        new CorsConfiguration(List.of("   ", "", "  https://finsim.vercel.app  "));
    TestCorsRegistry registry = new TestCorsRegistry();
    config.addCorsMappings(registry);

    Map<String, org.springframework.web.cors.CorsConfiguration> configs = registry.getConfigs();
    assertThat(configs).containsKey("/**");
    org.springframework.web.cors.CorsConfiguration cors = configs.get("/**");
    assertThat(cors.getAllowedOriginPatterns()).containsExactly("https://finsim.vercel.app");
    assertThat(cors.getAllowedMethods())
        .containsExactly("GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS");
    assertThat(cors.getAllowedHeaders()).containsExactly("*");
    assertThat(cors.getExposedHeaders())
        .containsExactly("Idempotency-Key", "Location", "Content-Type", "X-Request-Id");
    assertThat(cors.getMaxAge()).isEqualTo(3600L);
  }

  @Test
  void permitsAllowedOriginAndRejectsUnlistedOrigin() throws Exception {
    CorsConfiguration config =
        new CorsConfiguration(List.of("https://finsim.vercel.app", "http://localhost:3000"));
    TestCorsRegistry registry = new TestCorsRegistry();
    config.addCorsMappings(registry);

    UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
    registry.getConfigs().forEach(source::registerCorsConfiguration);

    MockMvc mockMvc =
        MockMvcBuilders.standaloneSetup(new DummyController())
            .addFilters(new CorsFilter(source))
            .build();

    // Allowed origin succeeds with expected headers
    mockMvc
        .perform(
            options("/api/test")
                .header(HttpHeaders.ORIGIN, "https://finsim.vercel.app")
                .header(HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD, "POST")
                .header(HttpHeaders.ACCESS_CONTROL_REQUEST_HEADERS, "Idempotency-Key,Content-Type"))
        .andExpect(status().isOk())
        .andExpect(
            header().string(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN, "https://finsim.vercel.app"))
        .andExpect(
            header()
                .string(
                    HttpHeaders.ACCESS_CONTROL_ALLOW_METHODS, "GET,POST,PUT,DELETE,PATCH,OPTIONS"))
        .andExpect(
            header()
                .string(
                    HttpHeaders.ACCESS_CONTROL_EXPOSE_HEADERS,
                    "Idempotency-Key, Location, Content-Type, X-Request-Id"));

    // Disallowed origin is rejected with 403 Forbidden
    mockMvc
        .perform(
            options("/api/test")
                .header(HttpHeaders.ORIGIN, "https://unauthorized-site.com")
                .header(HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD, "POST"))
        .andExpect(status().isForbidden())
        .andExpect(header().doesNotExist(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN));
  }
}
