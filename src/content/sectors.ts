import type { SectorId, SectorState } from "../game/types";

export const sectors: Record<SectorId, SectorState> = {
  tech: {
    id: "tech",
    name: "AI / Tech",
    sentiment: 58,
    attention: 62,
    momentum: 12,
    activeModifiers: []
  },
  biotech: {
    id: "biotech",
    name: "Biotech",
    sentiment: 52,
    attention: 48,
    momentum: 2,
    activeModifiers: []
  },
  property: {
    id: "property",
    name: "Property",
    sentiment: 35,
    attention: 55,
    momentum: -18,
    activeModifiers: []
  },
  consumer: {
    id: "consumer",
    name: "Consumer",
    sentiment: 57,
    attention: 40,
    momentum: 4,
    activeModifiers: []
  },
  resources: {
    id: "resources",
    name: "Resources",
    sentiment: 54,
    attention: 47,
    momentum: 6,
    activeModifiers: []
  },
  finance: {
    id: "finance",
    name: "Finance",
    sentiment: 50,
    attention: 35,
    momentum: -2,
    activeModifiers: []
  },
  defense: {
    id: "defense",
    name: "Defense",
    sentiment: 56,
    attention: 60,
    momentum: 10,
    activeModifiers: []
  },
  energy: {
    id: "energy",
    name: "Energy",
    sentiment: 53,
    attention: 38,
    momentum: 1,
    activeModifiers: []
  }
};
