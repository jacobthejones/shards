export const TECH_IDS = {
  RESONANCE: "resonance",
} as const;

export type TechId = typeof TECH_IDS[keyof typeof TECH_IDS];

export const RESONANCE_COST = 10_000;

export type TechDefinition = {
  id: TechId;
  title: string;
  description: string;
  icon: string;
  cost: number;
  dependsOn: TechId[];
};

export const TECH_TREE: TechDefinition[] = [
  {
    id: TECH_IDS.RESONANCE,
    title: "Resonance",
    description: "When a ball strikes a shard, every shard touching it absorbs a softer echo of the impact.",
    icon: "◈",
    cost: RESONANCE_COST,
    dependsOn: [],
  },
];

export const techIsUnlocked = (unlockedTechs: string[], techId: TechId) => unlockedTechs.includes(techId);

export const techHasUnlockedDependents = (unlockedTechs: string[], tech: TechDefinition) => {
  return TECH_TREE.some((candidate) => candidate.dependsOn.includes(tech.id) && unlockedTechs.includes(candidate.id));
};
