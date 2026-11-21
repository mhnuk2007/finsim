package io.github.mhnuk2007.finsim.registry;

import java.util.List;
import java.util.Optional;
import java.util.Set;

/**
 * Dynamic directory discovery model for a network, providing registered active participants, base
 * URLs, and declared capabilities.
 */
public record NetworkDirectory(
    String networkId,
    String name,
    Set<String> currencies,
    List<ParticipantDirectoryEntry> participants) {

  public Optional<ParticipantDirectoryEntry> findParticipant(String institutionId) {
    return participants.stream().filter(p -> p.id().equals(institutionId)).findFirst();
  }

  public List<ParticipantDirectoryEntry> findByCapability(Capability capability) {
    return participants.stream().filter(p -> p.capabilities().contains(capability)).toList();
  }

  /** Details for an active participant in the network directory. */
  public record ParticipantDirectoryEntry(
      String id,
      String name,
      InstitutionType type,
      String baseUrl,
      Set<Capability> capabilities,
      InstitutionStatus status,
      String provenance) {

    public static ParticipantDirectoryEntry from(Institution inst) {
      return new ParticipantDirectoryEntry(
          inst.id(),
          inst.name(),
          inst.type(),
          inst.baseUrl(),
          inst.capabilities(),
          inst.status(),
          inst.provenance());
    }
  }
}
