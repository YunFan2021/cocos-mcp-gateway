#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path');
try {
    if(!process.argv[2]||!path.isAbsolute(process.argv[2]))throw Error('需要扩展绝对路径，--write 显式更新清单');
    if(process.argv.slice(3).some(a=>!['--write','--check'].includes(a)))throw Error('INVALID_OPTIONS');
    const root=fs.realpathSync(process.argv[2]);
    const identity=require(path.join(root,'server/identity'));
    const expected=identity.buildManifest(root),file=path.join(root,'maintenance-manifest.json');
    if(process.argv.includes('--write')){
        const temp=file+'.tmp-'+process.pid;
        fs.writeFileSync(temp,JSON.stringify(expected,null,2)+'\n',{flag:'wx'});
        try{fs.renameSync(temp,file);}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
        console.log('manifest updated '+expected.fingerprint);
    }else{
        const actual=identity.inspect(root);
        console.log(JSON.stringify(actual,null,2));if(actual.status!=='matched')process.exitCode=1;
    }
}catch(e){console.error(e.message);process.exitCode=1;}
