// Copyright 2026 The PravahOS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

/**
 * Computes topological stages (columns) and layout coordinates for a Task DAG.
 */
export function computeDagLayout(nodesMap) {
  // nodesMap can be Map<string, object> or array of nodes
  const nodes = nodesMap instanceof Map ? Array.from(nodesMap.values()) : Array.from(nodesMap || []);
  const nodeDict = new Map();
  for (const n of nodes) {
    const id = n.nodeId || n.id;
    nodeDict.set(id, { ...n, id, dependencies: n.dependencies || [] });
  }

  // Calculate in-degree and depths
  const depths = new Map();
  const getDepth = (id, visited = new Set()) => {
    if (depths.has(id)) return depths.get(id);
    if (visited.has(id)) return 0; // handle potential cycles safely
    visited.add(id);

    const node = nodeDict.get(id);
    if (!node || !node.dependencies || node.dependencies.length === 0) {
      depths.set(id, 0);
      return 0;
    }

    let maxDepDepth = 0;
    for (const depId of node.dependencies) {
      maxDepDepth = Math.max(maxDepDepth, getDepth(depId, new Set(visited)) + 1);
    }
    depths.set(id, maxDepDepth);
    return maxDepDepth;
  };

  for (const id of nodeDict.keys()) {
    getDepth(id);
  }

  // Group into stages
  const stages = new Map();
  for (const [id, depth] of depths.entries()) {
    if (!stages.has(depth)) stages.set(depth, []);
    stages.get(depth).push(nodeDict.get(id));
  }

  // Compute edges: { from: string, to: string }
  const edges = [];
  for (const node of nodeDict.values()) {
    for (const depId of node.dependencies) {
      if (nodeDict.has(depId)) {
        edges.push({ from: depId, to: node.id });
      }
    }
  }

  // Sort stages by key
  const sortedStages = Array.from(stages.keys()).sort((a, b) => a - b).map(stageIdx => ({
    stageIndex: stageIdx,
    nodes: stages.get(stageIdx)
  }));

  return {
    stages: sortedStages,
    depths: Object.fromEntries(depths),
    edges,
    totalNodes: nodes.length
  };
}
