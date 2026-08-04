export const TECH_IDS = {
  RESONANCE: "resonance",
  CONDUCTION: "conduction",
  GERMINATION: "germination",
} as const;

// These IDs are kept only for save migrations. The branch they belonged to
// has been removed from the active tech tree.
export const REMOVED_TECH_IDS = {
  CHOSEN_ONE: "chosen-one",
  CORROSIVE_WAKE: "corrosive-wake",
  NEW_GROWTH: "new-growth",
} as const;

export type TechId = typeof TECH_IDS[keyof typeof TECH_IDS];

export const RESONANCE_COST = 10_000;
export const GERMINATION_COST = 5_000;
export const CONDUCTION_COST = 50_000;
export const REMOVED_TECH_REFUNDS: Record<string, number> = {
  [REMOVED_TECH_IDS.CHOSEN_ONE]: 10_000,
  [REMOVED_TECH_IDS.CORROSIVE_WAKE]: 50_000,
  [REMOVED_TECH_IDS.NEW_GROWTH]: 50_000,
};

export type TechIcon = "resonance" | "conduction" | "germination";

export type TechDefinition = {
  id: TechId;
  title: string;
  description: string;
  icon: TechIcon;
  cost: number;
  dependsOn: TechId[];
};

export const TECH_TREE: TechDefinition[] = [
  {
    id: TECH_IDS.GERMINATION,
    title: "Germination",
    description: "Each ball occasionally plants a seed in the empty field. A mature seed slowly charges and returns 10 lumens whenever a ball passes through it.",
    icon: "germination",
    cost: GERMINATION_COST,
    dependsOn: [],
  },
  {
    id: TECH_IDS.CONDUCTION,
    title: "Conduction",
    description: "The resonance travels one layer farther, reaching second-neighbor shards with a softer echo.",
    icon: "conduction",
    cost: CONDUCTION_COST,
    dependsOn: [TECH_IDS.RESONANCE],
  },
  {
    id: TECH_IDS.RESONANCE,
    title: "Resonance",
    description: "When a ball strikes a shard, every shard touching it absorbs a softer echo of the impact.",
    icon: "resonance",
    cost: RESONANCE_COST,
    dependsOn: [],
  },
];

export const TECH_TREE_BRANCHES: TechId[][] = [
  [TECH_IDS.GERMINATION],
  [TECH_IDS.CONDUCTION, TECH_IDS.RESONANCE],
];

export const techIsUnlocked = (unlockedTechs: string[], techId: TechId) => unlockedTechs.includes(techId);

export const techHasUnlockedDependents = (unlockedTechs: string[], tech: TechDefinition) => {
  return TECH_TREE.some((candidate) => candidate.dependsOn.includes(tech.id) && unlockedTechs.includes(candidate.id));
};
