// cli/anim-cmd.js — anim 子命令
//
// .anim 以 AnimationClip 为根，使用专用解析器和曲线操作。
//
// 用法：
//   anim query <anim> [--selector tree|node|find|field] ...
//   anim batch <anim> <ops.json> [--dry-run]
//
// batch 支持 offset-curve / set-keyframe-value；曲线 id 从 query 返回值获取。

'use strict';

const fs = require('fs');
const path = require('path');
const { queryAnimation, editAnimation } = require('../animation.js');
const { parseFlags } = require('./flags.js');

function die(msg) {
  process.stderr.write('Error: ' + msg + '\n');
  process.exit(1);
}

function resolvePath(p) {
  return path.resolve(process.cwd(), p);
}

function cmdAnim(args) {
  const sub = args[0];
  const rest = args.slice(1);

  if (!sub || sub === '--help' || sub === '-h') {
    process.stdout.write(`anim <subcommand> <file> [args]

Subcommands:
  query <anim>                                  # 动画轨道、绑定路径和曲线
  query <anim> --selector node --name <节点路径>
  query <anim> --selector find --type cc.RealCurve
  query <anim> --selector field [--id <对象id>] --field <字段>
  batch <anim> <ops.json> [--dry-run]

曲线操作：
  {"op":"offset-curve","curveId":29,"offset":10}
  {"op":"set-keyframe-value","curveId":29,"index":0,"value":100}
只改变关键帧数值，保留时间、插值、切线及编辑器信息。
`);
    return;
  }

  if (sub === 'query') {
    const { flags, positional } = parseFlags(rest);
    const animArg = positional[0];
    if (!animArg) die('anim query: 必须提供 <anim>');
    const animPath = resolvePath(animArg);
    if (!fs.existsSync(animPath)) die(`anim query: 文件不存在: ${animPath}`);

    const selectorType = flags['selector'] || 'tree';
    let selector;
    if (selectorType === 'tree') selector = { type: 'tree' };
    else if (selectorType === 'node') selector = { type: 'node', name: flags['name'] };
    else if (selectorType === 'find') selector = { type: 'find', nodeType: flags['type'] };
    else if (selectorType === 'field') selector = {
      type: 'field', id: flags['id'] === undefined ? undefined : Number(flags['id']), field: flags['field'],
    };
    else die(`anim query: 不支持的 --selector "${selectorType}"`);

    let result;
    try {
      result = queryAnimation(animPath, selector);
    } catch (e) {
      die('anim query 失败: ' + e.message);
    }
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return;
  }

  if (sub === 'batch') {
    const { flags, positional } = parseFlags(rest);
    const [animArg, opsArg] = positional;
    if (!animArg) die('anim batch: 必须提供 <anim>');
    if (!opsArg) die('anim batch: 必须提供 <ops.json>');
    const animPath = resolvePath(animArg);
    const opsPath = resolvePath(opsArg);
    if (!fs.existsSync(animPath)) die(`anim batch: 文件不存在: ${animPath}`);
    if (!fs.existsSync(opsPath)) die(`anim batch: ops 文件不存在: ${opsPath}`);

    let ops;
    try {
      ops = JSON.parse(fs.readFileSync(opsPath, 'utf8'));
    } catch (e) {
      die('anim batch: ops.json 解析失败: ' + e.message);
    }
    if (!Array.isArray(ops)) die('anim batch: ops.json 必须是数组');

    const editOptions = {};
    if (flags['dry-run'] === true) editOptions.dryRun = true;

    let result;
    try {
      result = editAnimation(animPath, ops, editOptions);
    } catch (e) {
      die('anim batch 失败: ' + e.message);
    }
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return;
  }

  die(`anim: 未知子命令 "${sub}"，可用: query / batch`);
}

module.exports = { cmdAnim };
