#!/usr/bin/env node
'use strict';
const fs=require('fs'), path=require('path'), crypto=require('crypto'), cp=require('child_process');

// 同步维护仓库中的安装快照。默认只读预览；--apply 才执行，备份保留供人工恢复。
function syncRuntime(source, root, apply=false, rename=fs.renameSync) {
    source=fs.realpathSync(source);root=fs.realpathSync(root);
    const overlaps=(a,b)=>{const r=path.relative(a,b);return !r||(!r.startsWith('..'+path.sep)&&r!=='..'&&!path.isAbsolute(r));};
    if(overlaps(source,root)||overlaps(root,source))throw Error('SOURCE_TARGET_OVERLAP');
    const identity=require(path.join(source,'server/identity'));
    if(identity.inspect(source).status!=='matched')throw Error('SOURCE_MANIFEST_MISMATCH');
    const targets=['runtime/router','runtime/cli','extension'];
    const sources=['router','cli',''];
    for(const relative of targets){
        let parent=root;
        for(const part of relative.split('/')){
            parent=path.join(parent,part);
            if(fs.existsSync(parent)&&fs.lstatSync(parent).isSymbolicLink())throw Error('SYMLINK_TARGET_PARENT');
        }
    }
    const excluded=new Set(['.git','.gitmodules','.agents','node_modules','mcp-sdk','test']);
    // 全量文件摘要用于发现扫描后并发修改。拒绝链接，防止目标越界。
    function scan(dir) {
        const out={};
        function visit(p,rel=''){
            for(const e of fs.readdirSync(p,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
                if(excluded.has(e.name))continue;
                if(e.isSymbolicLink())throw Error('SYMLINK_IN_SYNC_SCOPE');
                const key=rel+e.name,file=path.join(p,e.name);
                if(e.isDirectory())visit(file,key+'/');
                else out[key]=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
            }
        }
        if(fs.existsSync(dir)){if(fs.lstatSync(dir).isSymbolicLink())throw Error('SYMLINK_TARGET');visit(dir);}
        return JSON.stringify(out);
    }
    for(const file of ['router/bin.js','cli/bin/cocos-mcp-cli.js'])if(!fs.existsSync(path.join(source,file)))throw Error('INVALID_SOURCE');
    const before=targets.map(t=>scan(path.join(root,t)));
    const desired=sources.map(s=>scan(path.join(source,s)));
    const changed=targets.filter((t,i)=>before[i]!==desired[i]);
    if(!apply)return {status:'dry_run',changed};
    // 有版本控制的维护仓库才能应用；拒绝覆盖目标范围中的未提交或未跟踪改动。
    const dirty=cp.execFileSync('git',['status','--porcelain','--',...targets],{cwd:root,encoding:'utf8'});
    if(dirty.trim())throw Error('LOCAL_CHANGES_IN_SYNC_TARGET');
    if(!changed.length)return {status:'unchanged',changed};
    const staging=fs.mkdtempSync(path.join(root,'.mcp-sync-'));
    const journal=targets.map((t,i)=>({target:path.join(root,t),staged:path.join(staging,'new-'+i),backup:path.join(staging,'old-'+i),moved:false,installed:false}));
    try{
        for(let i=0;i<targets.length;i++)fs.cpSync(path.join(source,sources[i]),journal[i].staged,{recursive:true,filter:p=>!excluded.has(path.basename(p))});
        for(let i=0;i<targets.length;i++){
            if(scan(path.join(root,targets[i]))!==before[i]||scan(path.join(source,sources[i]))!==desired[i]||
                scan(journal[i].staged)!==desired[i])throw Error('FILES_CHANGED_DURING_SYNC');
        }
        fs.writeFileSync(path.join(staging,'recovery.json'),JSON.stringify(journal,null,2));
        for(const item of journal){
            if(fs.existsSync(item.target)){rename(item.target,item.backup);item.moved=true;}
            fs.mkdirSync(path.dirname(item.target),{recursive:true});
            rename(item.staged,item.target);item.installed=true;
        }
        return {status:'synced',changed,backup:staging};
    }catch(error){
        for(const item of journal.slice().reverse()){
            if(item.installed)rename(item.target,item.staged);
            if(item.moved)rename(item.backup,item.target);
        }
        throw Error(error.message+'; recovery='+staging);
    }
}
if(require.main===module){
    try{
        if(!process.argv[2])throw Error('用法: node scripts/sync-runtime.js <扩展目录> [--apply]');
        const flags=process.argv.slice(3);if(flags.some(f=>!['--apply','--dry-run'].includes(f))||flags.length>1)throw Error('INVALID_OPTIONS');
        console.log(JSON.stringify(syncRuntime(process.argv[2],path.resolve(__dirname,'..'),flags.includes('--apply')),null,2));
    }catch(error){console.error(error.message);process.exitCode=1;}
}
module.exports={syncRuntime};
