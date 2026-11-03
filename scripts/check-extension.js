#!/usr/bin/env node
'use strict';
const fs = require('fs'), path = require('path');
const { inspect } = require('../extension/server/identity');
// 只读比较已安装核心与模板。无清单的旧安装明确报告 unknown，禁止据此覆盖。
function compareInstallation(target) {
    const template = inspect(path.join(__dirname, '../extension'));
    if (!fs.existsSync(path.join(target, 'maintenance-manifest.json'))) return { status:'unknown', reason:'NO_MANIFEST', template };
    const installed = inspect(target);
    return { status: installed.status !== 'matched' ? 'local_changes' : installed.fingerprint === template.fingerprint && template.status === 'matched' ? 'matched' : 'different_baseline',
        template, installed };
}
if (require.main === module) {
    try {
        if (!process.argv[2]) throw Error('需要扩展目录绝对路径');
        if (!path.isAbsolute(process.argv[2])) throw Error('必须传绝对路径');
        const result = compareInstallation(fs.realpathSync(process.argv[2]));
        console.log(JSON.stringify(result, null, 2)); process.exitCode = result.status === 'matched' ? 0 : 1;
    } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { compareInstallation };
