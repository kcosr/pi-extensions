export interface InstanceDefinition {
  id: string;
  name?: string;
}

export interface InstancePlan {
  instanceIds: string[];
  listInstanceIds: Set<string>;
  noteInstanceIds: Set<string>;
}

export function buildInstancePlan(
  listInstances: InstanceDefinition[],
  noteInstances: InstanceDefinition[],
  preferredInstance: string
): InstancePlan;
