'use strict';

// 统一入口：re-export 所有公开 API
const { parsePrefab } = require('./parse.js');
const { writePrefab } = require('./write.js');
const { editPrefab } = require('./editor/index.js');
const { queryPrefab } = require('./query/index.js');
const { setOverrideProperty, listOverrides } = require('./overrides.js');
const { deterministicUUID, deterministicFileId, createFileIdGenerator } = require('./id.js');
const primitives = require('./primitives.js');
const animPrimitives = require('./anim-primitives.js');
const { parseAnimation, queryAnimation, editAnimation } = require('./animation.js');

module.exports = {
  parsePrefab,
  writePrefab,
  editPrefab,
  queryPrefab,
  parseAnimation,
  queryAnimation,
  editAnimation,
  setOverrideProperty,
  listOverrides,
  deterministicUUID,
  deterministicFileId,
  createFileIdGenerator,
  ...primitives,
  // .anim 文件对象构建原语（AnimationClip / Track / Curve / Channel），
  // 动画专用解析见 parseAnimation；写回仍复用 writePrefab 保留格式。
  anim: animPrimitives,
};
