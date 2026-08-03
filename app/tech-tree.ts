export const TECH_IDS = {
  CORROSIVE_WAKE: "corrosive-wake",
  CHOSEN_ONE: "chosen-one",
  RESONANCE: "resonance",
  CONDUCTION: "conduction",
} as const;

// Kept so saves from the original New Growth branch can be converted without
// losing the player's unlock when the branch is renamed and repurposed.
export const LEGACY_TECH_IDS = {
  NEW_GROWTH: "new-growth",
} as const;

export type TechId = typeof TECH_IDS[keyof typeof TECH_IDS];

export const RESONANCE_COST = 10_000;
export const CONDUCTION_COST = 50_000;
export const CHOSEN_ONE_COST = 10_000;
export const CORROSIVE_WAKE_COST = 50_000;

export type TechIcon = "corrosive-wake" | "chosen-one" | "resonance" | "conduction";

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
    id: TECH_IDS.CORROSIVE_WAKE,
    title: "Corrosive Wake",
    description: "The chosen ball leaves a fading wake. Any ball that passes through it makes its next shard impact five times stronger.",
    icon: "corrosive-wake",
    cost: CORROSIVE_WAKE_COST,
    dependsOn: [TECH_IDS.CHOSEN_ONE],
  },
  {
    id: TECH_IDS.CHOSEN_ONE,
    title: "The Chosen One",
    description: "The first ball becomes chosen. Its impacts break five times harder, and its resonance carries that strength outward.",
    icon: "chosen-one",
    cost: CHOSEN_ONE_COST,
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
  [TECH_IDS.CORROSIVE_WAKE, TECH_IDS.CHOSEN_ONE],
  [TECH_IDS.CONDUCTION, TECH_IDS.RESONANCE],
];

export const techIsUnlocked = (unlockedTechs: string[], techId: TechId) => unlockedTechs.includes(techId);

export const techHasUnlockedDependents = (unlockedTechs: string[], tech: TechDefinition) => {
  return TECH_TREE.some((candidate) => candidate.dependsOn.includes(tech.id) && unlockedTechs.includes(candidate.id));
};
