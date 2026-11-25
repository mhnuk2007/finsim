package io.github.mhnuk2007.finsim.core;

import java.net.InetAddress;
import java.net.UnknownHostException;
import java.util.Collection;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

/**
 * Shared IP and hostname safety helpers used for SSRF defense across registry validation and
 * outbound participant calls.
 */
public final class IpAddressSupport {

  private IpAddressSupport() {}

  /**
   * Returns {@code true} if the address is link-local (including cloud metadata 169.254.169.254) or
   * any-local / unspecified (0.0.0.0, ::).
   */
  public static boolean isLinkLocalOrAnyLocal(InetAddress address) {
    InetAddress unwrapped = unwrapIpv4Mapped(address);
    return unwrapped.isLinkLocalAddress() || unwrapped.isAnyLocalAddress();
  }

  /**
   * Returns {@code true} if the address belongs to loopback (127.0.0.0/8, ::1), RFC 1918 private
   * ranges, carrier-grade NAT (100.64.0.0/10), or IPv6 unique local addresses (fc00::/7).
   */
  public static boolean isPrivateOrLoopback(InetAddress address) {
    InetAddress unwrapped = unwrapIpv4Mapped(address);
    if (unwrapped.isLoopbackAddress() || unwrapped.isSiteLocalAddress()) {
      return true;
    }
    byte[] bytes = unwrapped.getAddress();
    if (bytes.length == 16) {
      return (bytes[0] & 0xFE) == 0xFC; // IPv6 unique local fc00::/7
    }
    return bytes.length == 4
        && (bytes[0] & 0xFF) == 100
        && (bytes[1] & 0xC0) == 64; // carrier-grade NAT 100.64.0.0/10
  }

  public static InetAddress unwrapIpv4Mapped(InetAddress address) {
    byte[] bytes = address.getAddress();
    if (isIpv4Mapped(bytes)) {
      byte[] ipv4 = new byte[4];
      System.arraycopy(bytes, 12, ipv4, 0, 4);
      try {
        return InetAddress.getByAddress(ipv4);
      } catch (UnknownHostException ignored) {
        return address;
      }
    }
    return address;
  }

  public static boolean isIpv4Mapped(byte[] bytes) {
    if (bytes == null || bytes.length != 16) {
      return false;
    }
    for (int i = 0; i < 10; i++) {
      if (bytes[i] != 0) {
        return false;
      }
    }
    return (bytes[10] & 0xFF) == 0xFF && (bytes[11] & 0xFF) == 0xFF;
  }

  public static String normalizeHost(String host) {
    if (host == null) {
      return "";
    }
    String normalized = host.trim().toLowerCase(Locale.ROOT);
    while (normalized.endsWith(".")) {
      normalized = normalized.substring(0, normalized.length() - 1);
    }
    if (normalized.startsWith("[") && normalized.endsWith("]")) {
      normalized = normalized.substring(1, normalized.length() - 1);
    }
    return normalized;
  }

  public static Set<String> normalizeHosts(Collection<String> hosts) {
    if (hosts == null || hosts.isEmpty()) {
      return Set.of();
    }
    Set<String> result = new HashSet<>();
    for (String host : hosts) {
      String normalized = normalizeHost(host);
      if (!normalized.isBlank()) {
        result.add(normalized);
      }
    }
    return Set.copyOf(result);
  }
}
