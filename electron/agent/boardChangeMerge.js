import { normalizeBoard } from "../../src/progressCore.js";
import { canonicalJson } from "../db/boardHash.js";

export class BoardChangeMergeConflict extends Error {
  constructor(path) {
    super(`Conflicting board change at ${path}`);
    this.name = "BoardChangeMergeConflict";
    this.path = path;
  }
}

function sameValue(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function itemId(item) {
  return isPlainObject(item) && typeof item.id === "string" && item.id ? item.id : null;
}

function conflict(path) {
  throw new BoardChangeMergeConflict(path);
}

function mergeKeyedArray(base, current, proposed, path) {
  const baseById = new Map(base.map((item) => [itemId(item), item]));
  const currentById = new Map(current.map((item) => [itemId(item), item]));
  const proposedById = new Map(proposed.map((item) => [itemId(item), item]));
  const result = [];
  const included = new Set();

  function mergeItem(id) {
    if (included.has(id)) return;
    const hasBase = baseById.has(id);
    const hasCurrent = currentById.has(id);
    const hasProposed = proposedById.has(id);

    if (!hasBase) {
      if (!hasProposed) {
        if (hasCurrent) result.push(currentById.get(id));
        included.add(id);
        return;
      }
      if (!hasCurrent) {
        result.push(proposedById.get(id));
        included.add(id);
        return;
      }
      if (!sameValue(currentById.get(id), proposedById.get(id))) conflict(`${path}[${id}]`);
      result.push(currentById.get(id));
      included.add(id);
      return;
    }

    if (!hasProposed) {
      included.add(id);
      if (!hasCurrent || sameValue(currentById.get(id), baseById.get(id))) return;
      conflict(`${path}[${id}]`);
    }

    if (!hasCurrent) {
      included.add(id);
      if (sameValue(proposedById.get(id), baseById.get(id))) return;
      conflict(`${path}[${id}]`);
    }

    result.push(mergeValue(baseById.get(id), currentById.get(id), proposedById.get(id), `${path}[${id}]`));
    included.add(id);
  }

  for (const item of current) mergeItem(itemId(item));
  for (const id of baseById.keys()) {
    if (!included.has(id)) mergeItem(id);
  }

  for (let index = 0; index < proposed.length; index += 1) {
    const item = proposed[index];
    const id = itemId(item);
    if (baseById.has(id) || currentById.has(id) || included.has(id)) continue;

    let insertAt = result.length;
    let anchored = false;
    for (let nextIndex = index + 1; nextIndex < proposed.length; nextIndex += 1) {
      const nextId = itemId(proposed[nextIndex]);
      if (!nextId || !baseById.has(nextId)) continue;
      const existingIndex = result.findIndex((candidate) => itemId(candidate) === nextId);
      if (existingIndex >= 0) {
        insertAt = existingIndex;
        anchored = true;
      }
      break;
    }
    if (!anchored) {
      for (let previousIndex = index - 1; previousIndex >= 0; previousIndex -= 1) {
        const previousId = itemId(proposed[previousIndex]);
        if (!previousId || !baseById.has(previousId)) continue;
        const existingIndex = result.findIndex((candidate) => itemId(candidate) === previousId);
        if (existingIndex >= 0) insertAt = existingIndex + 1;
        break;
      }
    }
    result.splice(insertAt, 0, item);
    included.add(id);
  }

  return result;
}

function mergeSetArray(base, current, proposed) {
  const baseKeys = new Set(base.map((item) => canonicalJson(item)));
  const proposedKeys = new Set(proposed.map((item) => canonicalJson(item)));
  const result = current.filter((item) => {
    const key = canonicalJson(item);
    return !baseKeys.has(key) || proposedKeys.has(key);
  });
  const resultKeys = new Set(result.map((item) => canonicalJson(item)));
  for (const item of proposed) {
    const key = canonicalJson(item);
    if (baseKeys.has(key) || resultKeys.has(key)) continue;
    result.push(item);
    resultKeys.add(key);
  }
  return result;
}

function mergeArray(base, current, proposed, path) {
  const hasStableIds = [...base, ...current, ...proposed].every((item) => itemId(item));
  return hasStableIds
    ? mergeKeyedArray(base, current, proposed, path)
    : mergeSetArray(base, current, proposed);
}

function mergeObject(base, current, proposed, path) {
  const result = {};
  const keys = new Set([...Object.keys(current), ...Object.keys(proposed)]);

  for (const key of keys) {
    const hasBase = Object.prototype.hasOwnProperty.call(base, key);
    const hasCurrent = Object.prototype.hasOwnProperty.call(current, key);
    const hasProposed = Object.prototype.hasOwnProperty.call(proposed, key);
    const keyPath = `${path}.${key}`;

    if (!hasBase) {
      if (!hasProposed) {
        result[key] = current[key];
        continue;
      }
      if (!hasCurrent) {
        result[key] = proposed[key];
        continue;
      }
      if (!sameValue(current[key], proposed[key])) conflict(keyPath);
      result[key] = current[key];
      continue;
    }

    if (!hasProposed) {
      if (!hasCurrent || sameValue(current[key], base[key])) continue;
      conflict(keyPath);
    }

    if (!hasCurrent) {
      if (sameValue(proposed[key], base[key])) continue;
      conflict(keyPath);
    }

    result[key] = mergeValue(base[key], current[key], proposed[key], keyPath);
  }

  return result;
}

function mergeValue(base, current, proposed, path) {
  if (sameValue(base, proposed)) return current;
  if (sameValue(base, current)) return proposed;
  if (sameValue(current, proposed)) return current;
  if (Array.isArray(base) && Array.isArray(current) && Array.isArray(proposed)) return mergeArray(base, current, proposed, path);
  if (isPlainObject(base) && isPlainObject(current) && isPlainObject(proposed)) return mergeObject(base, current, proposed, path);
  return conflict(path);
}

function placeAddedNodesWithoutOverlap(base, merged, proposed) {
  const baseNodeIds = new Set(base.tasks.flatMap((task) => task.nodes.map((node) => node.id)));
  const addedNodeIds = new Set(
    proposed.tasks.flatMap((task) => task.nodes.filter((node) => !baseNodeIds.has(node.id)).map((node) => node.id)),
  );
  if (addedNodeIds.size === 0) return merged;

  return {
    ...merged,
    tasks: merged.tasks.map((task) => {
      if (!task.nodes.some((node) => addedNodeIds.has(node.id))) return task;
      const nodes = [...task.nodes];
      for (let index = 0; index < nodes.length; index += 1) {
        const node = nodes[index];
        if (!addedNodeIds.has(node.id)) continue;
        let placedNode = node;
        const collides = () => nodes.some((candidate) => (
          candidate.id !== node.id
          && Math.abs(candidate.x - placedNode.x) < 180
          && Math.abs(candidate.y - placedNode.y) < 120
        ));
        while (collides()) {
          placedNode = { ...placedNode, y: placedNode.y + 150 };
        }
        nodes[index] = placedNode;
      }
      return { ...task, nodes };
    }),
  };
}

export function rebaseBoardChange(baseBoard, currentBoard, proposedBoard) {
  const base = normalizeBoard(baseBoard);
  const current = normalizeBoard(currentBoard);
  const proposed = normalizeBoard(proposedBoard);
  const merged = normalizeBoard(mergeValue(base, current, proposed, "board"));
  return normalizeBoard(placeAddedNodesWithoutOverlap(base, merged, proposed));
}
