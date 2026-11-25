package io.github.mhnuk2007.finsim.core;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.InetAddress;
import java.util.List;
import org.junit.jupiter.api.Test;

class IpAddressSupportTest {

  @Test
  void detectsPrivateLoopbackCgnatAndIpv6UlaAddresses() throws Exception {
    assertThat(IpAddressSupport.isPrivateOrLoopback(InetAddress.getByName("127.0.0.1"))).isTrue();
    assertThat(IpAddressSupport.isPrivateOrLoopback(InetAddress.getByName("::1"))).isTrue();
    assertThat(IpAddressSupport.isPrivateOrLoopback(InetAddress.getByName("10.0.0.1"))).isTrue();
    assertThat(IpAddressSupport.isPrivateOrLoopback(InetAddress.getByName("172.18.0.3"))).isTrue();
    assertThat(IpAddressSupport.isPrivateOrLoopback(InetAddress.getByName("192.168.1.50")))
        .isTrue();
    assertThat(IpAddressSupport.isPrivateOrLoopback(InetAddress.getByName("fc00::1"))).isTrue();
    assertThat(IpAddressSupport.isPrivateOrLoopback(InetAddress.getByName("fd12:3456:789a::1")))
        .isTrue();
    assertThat(IpAddressSupport.isPrivateOrLoopback(InetAddress.getByName("100.64.0.1"))).isTrue();
    assertThat(IpAddressSupport.isPrivateOrLoopback(InetAddress.getByName("100.127.255.254")))
        .isTrue();

    assertThat(IpAddressSupport.isPrivateOrLoopback(InetAddress.getByName("100.128.0.1")))
        .isFalse();
    assertThat(IpAddressSupport.isPrivateOrLoopback(InetAddress.getByName("8.8.8.8"))).isFalse();
  }

  @Test
  void detectsLinkLocalAndAnyLocalIncludingMetadataIp() throws Exception {
    assertThat(IpAddressSupport.isLinkLocalOrAnyLocal(InetAddress.getByName("169.254.169.254")))
        .isTrue();
    assertThat(IpAddressSupport.isLinkLocalOrAnyLocal(InetAddress.getByName("0.0.0.0"))).isTrue();
    assertThat(IpAddressSupport.isLinkLocalOrAnyLocal(InetAddress.getByName("fe80::1"))).isTrue();
    assertThat(IpAddressSupport.isLinkLocalOrAnyLocal(InetAddress.getByName("8.8.8.8"))).isFalse();
  }

  @Test
  void normalizesHostsAndInternalHostLists() {
    assertThat(IpAddressSupport.normalizeHost(" [FD00::1]. ")).isEqualTo("fd00::1");
    assertThat(IpAddressSupport.normalizeHosts(List.of(" Bank-A. ", "  ", "BANK-B")))
        .containsExactlyInAnyOrder("bank-a", "bank-b");
  }
}
