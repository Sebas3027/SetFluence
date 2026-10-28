import type { FestivalBrief } from "@setfluence/shared";

export const KNOWN_SPONSOR_CATEGORIES: string[] = [
  "footwear",
  "apparel",
  "energy_drink",
  "streaming",
  "eyewear",
  "consumer_electronics",
  "beverage",
  "automotive",
  "finance",
];

export interface PresetBriefOption {
  id: string;
  label: string;
  badge: string;
  brief: FestivalBrief;
}

export const PRESET_BRIEFS: PresetBriefOption[] = [
  {
    id: "preset-horizon-2026",
    label: "Horizon Multi-Genre",
    badge: "3 Genres · Apparel Exclusivity",
    brief: {
      id: "preset-horizon-2026",
      name: "Horizon Sound Festival",
      location: "Austin, TX",
      stages: [
        {
          id: "stage-1",
          name: "Main Stage",
          genreLabel: "Indie / Alt Rock",
          artists: ["Arctic Monkeys", "Tame Impala", "The 1975"],
          activationFormat: {
            id: "fmt-pavilion",
            name: "Flagship Experience Pavilion",
            requiredSpaceFootprint: "large",
            noiseLevelCeiling: "moderate",
            stageTier: "headliner_arena",
          },
        },
        {
          id: "stage-2",
          name: "Dance Arena",
          genreLabel: "Electronic / Dance",
          artists: ["Calvin Harris", "David Guetta", "Disclosure"],
          activationFormat: {
            id: "fmt-immersion",
            name: "High-Energy Immersion Zone",
            requiredSpaceFootprint: "medium",
            noiseLevelCeiling: "loud",
            stageTier: "secondary_stage",
          },
        },
        {
          id: "stage-3",
          name: "Block Party",
          genreLabel: "Hip-hop / R&B",
          artists: ["Kendrick Lamar", "Travis Scott", "SZA"],
          activationFormat: {
            id: "fmt-studio",
            name: "Intimate Creator & Listening Studio",
            requiredSpaceFootprint: "compact",
            noiseLevelCeiling: "quiet",
            stageTier: "intimate_tent",
          },
        },
      ],
      suppliedBrands: [
        { name: "Converse", category: "footwear", available: true },
        { name: "Nike", category: "apparel", available: true },
        { name: "Adidas", category: "apparel", available: true },
        { name: "Red Bull", category: "energy_drink", available: true },
        { name: "Spotify", category: "streaming", available: true },
      ],
      constraints: [
        {
          id: "excl-apparel-festival",
          type: "category_exclusivity",
          scope: "festival",
          category: "apparel",
          active: true,
          reason: "At most one primary apparel sponsor across the festival.",
        },
      ],
    },
  },
  {
    id: "preset-neon-pulse",
    label: "Neon Pulse Electronic",
    badge: "Electronic / Indie Synth",
    brief: {
      id: "preset-neon-pulse",
      name: "Neon Pulse Electronic Weekender",
      location: "Detroit, MI",
      stages: [
        {
          id: "stage-1",
          name: "Cyber Dome",
          genreLabel: "Progressive & Synth",
          artists: ["Disclosure", "Tame Impala", "Calvin Harris"],
          activationFormat: {
            id: "fmt-cyber",
            name: "Audio-Visual Synth Pavilion",
            requiredSpaceFootprint: "large",
            noiseLevelCeiling: "loud",
            stageTier: "headliner_arena",
          },
        },
        {
          id: "stage-2",
          name: "Warehouse 09",
          genreLabel: "Big Room & Club",
          artists: ["David Guetta", "Travis Scott", "Calvin Harris"],
          activationFormat: {
            id: "fmt-bunker",
            name: "Sub-Frequency Recharge Bunker",
            requiredSpaceFootprint: "medium",
            noiseLevelCeiling: "loud",
            stageTier: "secondary_stage",
          },
        },
        {
          id: "stage-3",
          name: "Vinyl Sanctuary",
          genreLabel: "Alt & R&B Chillout",
          artists: ["SZA", "The 1975", "Arctic Monkeys"],
          activationFormat: {
            id: "fmt-sanctuary",
            name: "Analog Vinyl Listening Lounge",
            requiredSpaceFootprint: "compact",
            noiseLevelCeiling: "quiet",
            stageTier: "intimate_tent",
          },
        },
      ],
      suppliedBrands: [
        { name: "Red Bull", category: "energy_drink", available: true },
        { name: "Monster Energy", category: "energy_drink", available: true },
        { name: "Spotify", category: "streaming", available: true },
        { name: "Samsung", category: "consumer_electronics", available: true },
        { name: "Ray-Ban", category: "eyewear", available: true },
      ],
      constraints: [
        {
          id: "excl-energy-festival",
          type: "category_exclusivity",
          scope: "festival",
          category: "energy_drink",
          active: true,
          reason:
            "At most one primary energy_drink sponsor across the festival.",
        },
      ],
    },
  },
  {
    id: "preset-conflict-stress",
    label: "Constraint Stress-Test",
    badge: "Exclusivity + Stage Bans",
    brief: {
      id: "preset-conflict-stress",
      name: "Apex Multi-Constraint Showcase",
      location: "Chicago, IL",
      stages: [
        {
          id: "stage-1",
          name: "Main Stage",
          genreLabel: "Indie / Alt Rock",
          artists: ["Arctic Monkeys", "Tame Impala", "The 1975"],
          activationFormat: {
            id: "fmt-pavilion",
            name: "Flagship Experience Pavilion",
            requiredSpaceFootprint: "large",
            noiseLevelCeiling: "moderate",
            stageTier: "headliner_arena",
          },
        },
        {
          id: "stage-2",
          name: "Dance Arena",
          genreLabel: "Electronic / Dance",
          artists: ["Calvin Harris", "David Guetta", "Disclosure"],
          activationFormat: {
            id: "fmt-immersion",
            name: "High-Energy Immersion Zone",
            requiredSpaceFootprint: "medium",
            noiseLevelCeiling: "loud",
            stageTier: "secondary_stage",
          },
        },
        {
          id: "stage-3",
          name: "Block Party",
          genreLabel: "Hip-hop / R&B",
          artists: ["Kendrick Lamar", "Travis Scott", "SZA"],
          activationFormat: {
            id: "fmt-studio",
            name: "Intimate Creator & Listening Studio",
            requiredSpaceFootprint: "compact",
            noiseLevelCeiling: "quiet",
            stageTier: "intimate_tent",
          },
        },
      ],
      suppliedBrands: [
        { name: "Nike", category: "apparel", available: true },
        { name: "Adidas", category: "apparel", available: true },
        { name: "Converse", category: "footwear", available: true },
        { name: "Red Bull", category: "energy_drink", available: true },
        { name: "Monster Energy", category: "energy_drink", available: true },
      ],
      constraints: [
        {
          id: "excl-apparel-festival",
          type: "category_exclusivity",
          scope: "festival",
          category: "apparel",
          active: true,
          reason: "At most one primary apparel sponsor across the festival.",
        },
        {
          id: "ban-energy-stage-1",
          type: "category_ban",
          scope: "stage",
          stageId: "stage-1",
          category: "energy_drink",
          active: true,
          reason: "Banned category energy_drink on Main Stage.",
        },
      ],
    },
  },
];
