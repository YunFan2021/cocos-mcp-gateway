'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { editPrefab } = require('../runtime/cli/src/editor/index.js');
const { handleOfflineToolCall } = require('../runtime/router/src/offline-tools.js');

const ref = id => ({ __id__: id });
const read = file => JSON.parse(fs.readFileSync(file));
const element = (data, pointer) => data[pointer.__id__];

function add(data, item) {
  const pointer = ref(data.length);
  data.push(item);
  return pointer;
}

function prefab(name, fileId) {
  return [
    { __type__: 'cc.Prefab', data: ref(1) },
    { __type__: 'cc.Node', _name: name, _active: true, _parent: null, _children: [], _components: [], _prefab: ref(2) },
    { __type__: 'cc.PrefabInfo', root: ref(1), asset: ref(0), fileId, instance: null, targetOverrides: [], nestedPrefabInstanceRoots: [] },
  ];
}

function stub(data, name, template, fileId) {
  const node = add(data, { __type__: 'cc.Node', _parent: ref(1) });
  const instance = add(data, {
    __type__: 'cc.PrefabInstance', fileId, prefabRootNode: ref(1),
    mountedChildren: [], mountedComponents: [], propertyOverrides: [], removedComponents: [],
  });
  element(data, node)._prefab = add(data, {
    __type__: 'cc.PrefabInfo', root: node, asset: { __uuid__: template.uuid, __expectedType__: 'cc.Prefab' },
    fileId: template.rootFileId, instance, targetOverrides: null,
  });
  data[1]._children.push(node);
  data[2].nestedPrefabInstanceRoots.push(node);
  override(data, element(data, instance), [template.rootFileId], ['_name'], name);
  return { node, instance: element(data, instance) };
}

function component(data, node, type, fileId, fields) {
  return add(data, {
    __type__: type, node, ...fields,
    __prefab: add(data, { __type__: 'cc.CompPrefabInfo', fileId }),
  });
}

function targetInfo(data, chain) {
  return add(data, { __type__: 'cc.TargetInfo', localID: chain });
}

function override(data, instance, chain, propertyPath, value) {
  instance.propertyOverrides.push(add(data, {
    __type__: 'CCPropertyOverrideInfo', targetInfo: targetInfo(data, chain), propertyPath, value,
  }));
}

function bind(data, source, propertyPath, target, chain, sourceChain) {
  data[2].targetOverrides.push(add(data, {
    __type__: 'cc.TargetOverrideInfo', source, propertyPath, target,
    sourceInfo: sourceChain ? targetInfo(data, sourceChain) : null,
    targetInfo: targetInfo(data, chain),
  }));
}

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cocos-cli-unpack-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const assets = path.join(dir, 'assets');
  fs.mkdirSync(assets);
  fs.writeFileSync(path.join(dir, 'package.json'), '{}');
  function write(name, data) {
    const file = path.join(assets, `${name}.prefab`);
    const uuid = `00000000-0000-4000-8000-${name.padEnd(12, 'a')}`;
    fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
    fs.writeFileSync(file + '.meta', JSON.stringify({ uuid }));
    return { file, uuid, rootFileId: data[2].fileId };
  }

  const leaf = prefab('Label', 'leaf-root');
  leaf[1]._components.push(component(leaf, ref(1), 'cc.Label', 'leaf-label', { _string: 'default' }));
  const mid = prefab('Button', 'mid-root');
  stub(mid, 'label', write('a', leaf), 'inner-label');

  const template = prefab('Panel', 'panel-root');
  const midAsset = write('b', mid);
  const left = stub(template, 'left', midAsset, 'left-instance');
  const right = stub(template, 'right', midAsset, 'right-instance');
  const transform = component(template, ref(1), 'cc.UITransform', 'panel-transform', { _contentSize: { width: 100 } });
  template[1]._components.push(transform);

  const host = prefab('Window', 'window-root');
  const outer = stub(host, 'panel', write('c', template), 'panel-instance');
  const other = stub(host, 'other', midAsset, 'other-instance');
  const view = component(host, ref(1), 'cc.Button', 'view-script', { references: [null], panel: null });
  host[1]._components.push(view);
  const layout = component(host, outer.node, 'cc.Widget', 'panel-layout', { _target: ref(1) });
  const adornment = component(host, outer.node, 'cc.Sprite', 'label-sprite', { _enabled: true });
  outer.instance.mountedComponents.push(
    { __type__: 'cc.MountedComponentsInfo', targetInfo: { localID: ['panel-root'] }, components: [layout] },
    add(host, { __type__: 'cc.MountedComponentsInfo', targetInfo: targetInfo(host, ['left-instance', 'inner-label', 'leaf-root']), components: [adornment] }),
  );
  override(host, outer.instance, ['panel-transform'], ['_contentSize'], { width: 200 });
  override(host, outer.instance, ['right-instance', 'inner-label', 'leaf-label'], ['_string'], 'override');
  bind(host, view, ['panel'], outer.node, ['panel-root']);
  bind(host, view, ['references', 0], outer.node, ['right-instance', 'inner-label', 'leaf-label']);
  bind(host, outer.node, ['remote'], other.node, ['mid-root'], ['left-instance', 'inner-label', 'leaf-label']);
  bind(host, other.node, ['remote'], outer.node, ['panel-transform'], ['inner-label', 'leaf-label']);
  return { host, outer, other, view, layout, adornment, left, right, file: write('d', host).file };
}

const unpack = { op: 'unpack-nested-prefab', node: { path: 'Window/panel' } };

test('新增实例的名称与位置均绑定到模板根，而非宿主生成的 fileId', t => {
  const f = fixture(t);
  const templateInfo = element(f.host, element(f.host, f.outer.node)._prefab);
  const { diff } = editPrefab(f.file, [{
    op: 'add-nested-prefab', parent: 'Window', prefabUuid: templateInfo.asset.__uuid__,
    name: '副本', lpos: [4, 5, 6],
  }], { dryRun: true });
  const additions = diff.filter(row => row.type === 'added').map(row => row.after);
  const targets = additions.filter(row => row.__type__ === 'cc.TargetInfo');
  assert.deepEqual(targets.map(row => row.localID), [['panel-root'], ['panel-root']]);
  assert.notEqual(additions.find(row => row.__type__ === 'cc.PrefabInfo').fileId, 'panel-root');
});

test('解包跳过空路径并将兄弟实例根绑定定位到模板根', t => {
  const f = fixture(t);
  const otherInfo = element(f.host, element(f.host, f.other.node)._prefab);
  otherInfo.fileId = 'host-generated-stub-id';
  override(f.host, f.outer.instance, ['panel-root'], [], 99);
  bind(f.host, f.view, [], f.outer.node, ['panel-root']);
  bind(f.host, f.other.node, ['linkedPanel'], f.outer.node, ['panel-root']);
  fs.writeFileSync(f.file, JSON.stringify(f.host));
  editPrefab(f.file, [unpack]);
  const data = read(f.file);
  const bindings = data[2].targetOverrides.map(p => element(data, p));
  assert.ok(bindings.every(row => row.propertyPath.length > 0));
  const other = element(data, otherInfo.instance);
  const rootLink = other.propertyOverrides.map(p => element(data, p)).find(row => row.propertyPath[0] === 'linkedPanel');
  assert.deepEqual(element(data, rootLink.targetInfo).localID, ['mid-root']);
  assert.deepEqual(rootLink.value, f.outer.node);
  assert.equal(element(data, f.outer.node)._name, 'panel');
});

test('unpack keeps mounted components and moves cross-Prefab references to the surviving instances', t => {
  const f = fixture(t);
  const before = fs.readFileSync(f.file, 'utf8');
  const dryRun = editPrefab(f.file, [unpack], { dryRun: true });
  assert.ok(dryRun.diff.length);
  assert.equal(fs.readFileSync(f.file, 'utf8'), before);

  const run = editPrefab(f.file, [unpack]);
  assert.deepEqual(run.nodesAffected, ['panel']);
  const data = read(f.file);
  const panel = element(data, f.outer.node);
  assert.equal(panel._name, 'panel');
  const panelInfo = element(data, panel._prefab);
  assert.equal(panelInfo.instance, null);
  assert.equal(panelInfo.fileId, 'panel-root');
  assert.deepEqual(panelInfo.asset, ref(0));
  assert.ok(panel._components.some(id => id.__id__ === f.layout.__id__));
  assert.deepEqual(element(data, f.layout), element(f.host, f.layout));
  const transform = panel._components.map(p => element(data, p)).find(c => c.__type__ === 'cc.UITransform');
  assert.equal(transform._contentSize.width, 200);

  const [left, right] = panel._children;
  const prefabInstance = pointer => element(data, element(data, element(data, pointer)._prefab).instance);
  assert.equal(prefabInstance(left).fileId, 'left-instance');
  assert.equal(prefabInstance(right).fileId, 'right-instance');
  assert.equal(element(data, element(data, left)._prefab).fileId, 'mid-root');
  assert.equal(element(data, element(data, right)._prefab).fileId, 'mid-root');
  assert.deepEqual(data[2].nestedPrefabInstanceRoots.map(id => id.__id__).sort(), [f.other.node.__id__, left.__id__, right.__id__].sort());
  const [mount] = prefabInstance(left).mountedComponents;
  assert.deepEqual(mount.components, [f.adornment]);
  assert.deepEqual(mount.targetInfo.localID, ['inner-label', 'leaf-root']);
  const deepProp = element(data, prefabInstance(right).propertyOverrides.at(-1));
  assert.deepEqual(element(data, deepProp.targetInfo).localID, ['inner-label', 'leaf-label']);
  assert.equal(deepProp.value, 'override');

  assert.deepEqual(element(data, f.view).panel, f.outer.node);
  const bindings = data[2].targetOverrides.map(p => element(data, p));
  const [outgoing, incoming] = bindings;
  assert.equal(bindings.length, 2);
  assert.deepEqual(incoming.target, right);
  assert.deepEqual(incoming.propertyPath, ['references', 0]);
  assert.deepEqual(element(data, incoming.targetInfo).localID, ['inner-label', 'leaf-label']);
  assert.deepEqual(outgoing.source, left);
  assert.deepEqual(element(data, outgoing.sourceInfo).localID, ['inner-label', 'leaf-label']);
  assert.deepEqual(outgoing.target, f.other.node);
  const directTarget = element(data, prefabInstance(f.other.node).propertyOverrides.at(-1));
  assert.deepEqual(element(data, directTarget.targetInfo).localID, ['inner-label', 'leaf-label']);
  assert.deepEqual(directTarget.value, panel._components.find(p => element(data, p) === transform));
});

test('an invalid relative path aborts the whole batch without saving earlier edits', t => {
  const f = fixture(t);
  const binding = f.host[2].targetOverrides.map(p => element(f.host, p)).find(row => row.propertyPath[0] === 'references');
  element(f.host, binding.targetInfo).localID[0] = 'missing-instance';
  const before = JSON.stringify(f.host);
  fs.writeFileSync(f.file, before);
  assert.throws(() => editPrefab(f.file, [{ op: 'set-active', node: 'Window', active: false }, unpack]), /无法定位跨层引用: missing-instance/);
  assert.equal(fs.readFileSync(f.file, 'utf8'), before);
});

test('Gateway offline editing uses the global CLI unpack handler', async t => {
  const f = fixture(t);
  const result = await handleOfflineToolCall('prefab_edit', { filePath: f.file, ops: [unpack] });
  assert.deepEqual(JSON.parse(result.content[0].text).nodesAffected, ['panel']);
  const data = read(f.file);
  assert.equal(element(data, element(data, f.outer.node)._prefab).instance, null);
});
