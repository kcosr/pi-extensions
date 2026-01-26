function buildInstancePlan(listInstances, noteInstances, preferredInstance) {
  const listInstanceIds = new Set((listInstances || []).map((inst) => inst.id));
  const noteInstanceIds = new Set((noteInstances || []).map((inst) => inst.id));
  const unionIds = new Set();
  for (const id of listInstanceIds) unionIds.add(id);
  for (const id of noteInstanceIds) unionIds.add(id);

  const preferred = typeof preferredInstance === "string" ? preferredInstance.trim() : "";
  if (unionIds.size === 0) {
    unionIds.add(preferred || "default");
  }

  const orderedIds = [];
  if (preferred && unionIds.has(preferred)) {
    orderedIds.push(preferred);
  }
  for (const id of unionIds) {
    if (!orderedIds.includes(id)) {
      orderedIds.push(id);
    }
  }

  return {
    instanceIds: orderedIds.length > 0 ? orderedIds : ["default"],
    listInstanceIds,
    noteInstanceIds,
  };
}

module.exports = {
  buildInstancePlan,
};
