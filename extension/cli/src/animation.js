'use strict';

const fs = require('fs');
const { writePrefab } = require('./write.js');
const { computeDiff } = require('./editor/diff.js');

/** 动画以 AnimationClip 为根，不依赖 Prefab.data 或 Node 树。 */
function parseAnimation(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const elements = JSON.parse(raw);
  if (!Array.isArray(elements)) throw new Error('parseAnimation: 顶层必须是数组');
  const rootId = elements.findIndex(el => el && el.__type__ === 'cc.AnimationClip');
  if (rootId < 0) throw new Error('parseAnimation: 未找到 cc.AnimationClip 资产头');
  const resolveRef = ref => {
    const id = ref && ref.__id__;
    if (!Number.isInteger(id) || id < 0 || !elements[id]) {
      throw new Error(`parseAnimation: 无效引用 ${JSON.stringify(ref)}`);
    }
    return elements[id];
  };
  return { raw, elements, rootId, resolveRef };
}

/** 展开动画绑定路径、通道及关键帧，find/field 可继续查询具体对象。 */
function queryAnimation(filePath, selector = {}) {
  const data = parseAnimation(filePath);
  const { elements, rootId, resolveRef } = data;
  const clip = elements[rootId];
  const type = selector.type || 'tree';
  if (type === 'find') {
    if (!selector.nodeType) throw new Error('queryAnimation find: 必须提供 --type');
    return elements.flatMap((el, id) => el && el.__type__ === selector.nodeType ? [id] : []);
  }
  if (type === 'field') {
    const id = selector.id === undefined ? rootId : selector.id;
    const object = resolveRef({ __id__: id });
    if (!selector.field || !Object.hasOwn(object, selector.field)) {
      throw new Error(`queryAnimation field: 对象 ${id} 不存在字段 ${selector.field}`);
    }
    return object[selector.field];
  }
  if (!['tree', 'node'].includes(type)) throw new Error(`queryAnimation: 不支持 selector ${type}`);
  if (type === 'node' && !selector.name) throw new Error('queryAnimation node: 必须提供 --name 节点路径');
  const tracks = (clip._tracks || []).map(ref => {
    const track = resolveRef(ref);
    const path = resolveRef(track._binding.path)._paths.map(part => typeof part === 'string' ? part : resolveRef(part));
    const channelRefs = track._channels || (track._channel ? [track._channel] : []);
    return {
      id: ref.__id__, type: track.__type__, path,
      channels: channelRefs.map((channelRef, index) => {
        const channel = resolveRef(channelRef);
        return { index, id: channelRef.__id__, curveId: channel._curve.__id__, curve: resolveRef(channel._curve) };
      }),
    };
  });
  if (type === 'node') {
    return tracks.filter(track => track.path.some(part => part && part.path === selector.name));
  }
  return { id: rootId, name: clip._name, type: clip.__type__, duration: clip._duration, sample: clip.sample, tracks };
}

/** 动画批量修改仅支持明确的曲线操作；全部成功后才写盘。 */
function editAnimation(filePath, ops, options = {}) {
  if (!Array.isArray(ops) || ops.length === 0) throw new Error('editAnimation: ops 必须是非空数组');
  const data = parseAnimation(filePath);
  const before = JSON.parse(JSON.stringify(data.elements));
  for (const op of ops) {
    if (!op || !['offset-curve', 'set-keyframe-value'].includes(op.op)) {
      throw new Error('editAnimation: 支持 offset-curve / set-keyframe-value，不支持预制体节点操作');
    }
    const curve = data.resolveRef({ __id__: op.curveId });
    if (curve.__type__ !== 'cc.RealCurve') throw new Error(`editAnimation: ${op.curveId} 不是 cc.RealCurve`);
    if (!Array.isArray(curve._times) || !Array.isArray(curve._values) || curve._times.length !== curve._values.length) {
      throw new Error(`editAnimation: 曲线 ${op.curveId} 的时间与关键帧数量不一致`);
    }
    if (op.op === 'offset-curve') {
      if (!Number.isFinite(op.offset)) throw new Error('offset-curve: offset 必须是有限数值');
      for (const key of curve._values) {
        if (!key || !Number.isFinite(key.value) || !Number.isFinite(key.value + op.offset)) {
          throw new Error('offset-curve: 关键帧结果必须是有限数值');
        }
        key.value += op.offset;
      }
    } else {
      if (!Number.isInteger(op.index) || op.index < 0 || !curve._values[op.index]) {
        throw new Error('set-keyframe-value: index 超出关键帧范围');
      }
      if (!Number.isFinite(op.value)) throw new Error('set-keyframe-value: value 必须是有限数值');
      curve._values[op.index].value = op.value;
    }
  }
  const diff = computeDiff(before, data.elements);
  if (!options.dryRun && diff.length > 0) writePrefab(filePath, data.elements, data.raw);
  return { changed: !options.dryRun && diff.length > 0, opsApplied: ops.length, diff };
}

module.exports = { parseAnimation, queryAnimation, editAnimation };
