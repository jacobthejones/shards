export type GrowthTech = {
  id: string;
  title: string;
  description: string;
  cost: number;
  accent: string;
  dependsOn?: string;
};

export const GROWTH_TECH_TREE: GrowthTech[] = [
  {
    id: "living-current",
    title: "Living Current",
    description: "The green trail lingers a little longer before it thins back into the field.",
    cost: 180,
    accent: "#9bd9a9",
  },
  {
    id: "deep-roots",
    title: "Deep Roots",
    description: "A shard that reaches fullness settles more gently into the field and becomes a steady place to rest.",
    cost: 320,
    accent: "#b6d88f",
    dependsOn: "living-current",
  },
  {
    id: "shared-breath",
    title: "Shared Breath",
    description: "Nearby green shards take a quiet echo of the balls passing through their neighbors.",
    cost: 540,
    accent: "#9ed6c5",
  },
];

export const growthTechIsUnlocked = (unlocked: string[], id: string) => unlocked.includes(id);
