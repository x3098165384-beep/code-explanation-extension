const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const vscode = require('vscode');
const { execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { pause } = require('./renderer.cjs');

exports.verify = async ({ config, renderer, checkpoint, wait, command, parseExplanation, diskFile }) => {
  const original = fs.readFileSync(diskFile, 'utf8'), value = JSON.parse(original);
  value.id = 'layout-selectable-text';
  const code = '\tconst label = "中文 C:\\temp";\n\nreturn label;\n';
  value.steps.forEach(step => { step.body = '```javascript\n' + code + '```\n\n用变量 label 保存文字，再返回 label。'; });
  const file = path.join(config.runRoot, 'layout.json'); fs.writeFileSync(file, JSON.stringify(value));
  const lecture = parseExplanation(JSON.stringify(value));
  await vscode.commands.executeCommand('workbench.action.joinAllGroups');
  await vscode.workspace.getConfiguration('diffEditor').update('useInlineViewWhenSpaceIsLimited',false,vscode.ConfigurationTarget.Global);
  const isolation = JSON.parse(fs.readFileSync(path.join(config.runRoot,'copy-expected-isolation.json'),'utf8').replace(/^\uFEFF/,''));
  const probe = () => JSON.parse(execFileSync(path.join(config.runRoot,'ClipboardProbe.exe'),[isolation.station,'read'],{encoding:'utf8',windowsHide:true}));
  const records=[];
  await renderer.protocol('Emulation.setFocusEmulationEnabled',{enabled:true});
  async function copied(name, expected, before, selected) {
    await pause(120); const native=probe(), actual=await vscode.env.clipboard.readText();
    assert.notEqual(native.sequence,before.sequence); assert.equal(native.ownerProcessId,isolation.mainProcessId);
    assert.equal(actual.replace(/\r\n/g,'\n'),expected); assert.equal(native.text.replace(/\r\n/g,'\n'),expected);
    if(selected!==undefined)assert.equal(selected,expected);
    records.push({name,expected,actual,selected,native,passed:true}); fs.writeFileSync(path.join(config.runRoot,'layout-copy-results.json'),JSON.stringify(records,null,2));
  }
  async function copy(name) {
    let previous, since=Date.now();
    await wait('复制前当前行内正文已稳定',state=>{const current=state.comments[0]?.markdown;if(!current||state.status.includes('正在读取')||current!==previous){previous=current;since=Date.now();return false;}return Date.now()-since>800;});
    await renderer.evaluate(`document.querySelector('.review-widget blockquote code').scrollIntoView({block:'center'})`);
    await pause(200);
    const start=1,end=code.length-1;
    const points=await renderer.evaluate(`(()=>{const code=document.querySelector('.review-widget blockquote code');code.scrollIntoView({block:'center'});const nodes=[];let offset=0;const visit=n=>{if(n.nodeType===3){nodes.push({n,start:offset,end:offset+n.nodeValue.length});offset+=n.nodeValue.length;}else for(const c of n.childNodes)visit(c);};visit(code);const point=(i,last)=>{const a=nodes.find(n=>i>=n.start&&i<n.end),r=document.createRange();r.setStart(a.n,i-a.start);r.setEnd(a.n,i-a.start+1);const b=r.getBoundingClientRect();return{x:last?b.right-.2:b.left+.2,y:b.top+b.height/2};};return{start:point(${start},false),end:point(${end-1},true)};})()`);
    await vscode.env.clipboard.writeText('layout-before-'+randomUUID()); let before=probe();
    for(const type of ['mousePressed','mouseReleased','mousePressed'])await renderer.protocol('Input.dispatchMouseEvent',{type,...points.start,button:'left',clickCount:1});
    for(let i=1;i<=12;i++)await renderer.protocol('Input.dispatchMouseEvent',{type:'mouseMoved',x:points.start.x+(points.end.x-points.start.x)*i/12,y:points.start.y+(points.end.y-points.start.y)*i/12,button:'left',buttons:1});
    await renderer.protocol('Input.dispatchMouseEvent',{type:'mouseReleased',...points.end,button:'left',clickCount:1});
    const selected=await renderer.evaluate('window.getSelection().toString()');
    assert.equal(selected,code.slice(start,end),'真实鼠标拖选必须选中当前代码原文');
    for(const type of ['rawKeyDown','keyUp'])await renderer.protocol('Input.dispatchKeyEvent',{type,key:'c',code:'KeyC',modifiers:2,windowsVirtualKeyCode:67,nativeVirtualKeyCode:67});
    await copied(name+'跨行拖选',code.slice(start,end),before,selected);
    await vscode.env.clipboard.writeText('layout-before-'+randomUUID()); before=probe();
    const point=await renderer.evaluate(`(()=>{const a=[...document.querySelectorAll('.review-widget a')].find(a=>a.textContent==='复制这段代码');a.scrollIntoView({block:'center'});const r=a.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2};})()`);
    for(const type of ['mousePressed','mouseReleased'])await renderer.protocol('Input.dispatchMouseEvent',{type,...point,button:'left',clickCount:1});
    await copied(name+'整块复制',code,before);
  }
  async function inspect() {
    return renderer.evaluate(`(()=>{const body=document.querySelector('.review-widget .comment-body');const code=body?.querySelector('blockquote pre code');const quote=code?.closest('blockquote');const r=code?.getBoundingClientRect();return code?{text:code.textContent,images:body.querySelectorAll('img').length,border:getComputedStyle(quote).borderLeftWidth,background:getComputedStyle(quote).backgroundColor,width:r.width,body:body.innerText}:null;})()`);
  }
  async function check() {
    await wait('代码文字区域和下方翻译已显示', async state => state.comments.length===1 && !state.status.includes('正在读取') && !!(await inspect()));
    const actual = await inspect(); assert.equal(actual.text, code); assert.equal(actual.images, 0);
    assert.ok(parseFloat(actual.border)>0); assert.ok(actual.width>20); assert.ok(actual.body.includes('用变量 label 保存文字'));
    return actual;
  }
  await checkpoint('深色行内代码是真实文字，边线与翻译区分且不使用图片', async () => {
    await vscode.workspace.getConfiguration('workbench').update('colorTheme','Default Dark Modern',vscode.ConfigurationTarget.Global);
    await command('open',vscode.Uri.file(file)); await check(); await command('previous');
    await wait('第一步不能后退',state=>state.status.includes('1/9：')&&!state.status.includes('正在读取'));
    await copy('深色普通行内');
  },'layout-dark.png');
  await checkpoint('浅色主题代码文字、缩进与翻译保持清楚', async () => {
    await vscode.workspace.getConfiguration('workbench').update('colorTheme','Default Light Modern',vscode.ConfigurationTarget.Global);
    await wait('浅色主题',()=>renderer.evaluate(`document.querySelector('.monaco-workbench').classList.contains('vs')`)); await check(); await copy('浅色普通行内');
  },'layout-light.png');
  await checkpoint('窄双侧diff保留真实比较、两侧目标和一份文字讲解', async () => {
    await vscode.workspace.getConfiguration('workbench').update('colorTheme','Default Dark Modern',vscode.ConfigurationTarget.Global);
    await renderer.protocol('Emulation.setDeviceMetricsOverride',{width:1000,height:900,deviceScaleFactor:1,mobile:false});
    for(let index=1;index<5;index++)await command('next');
    await wait('双侧定位完成',state=>state.status.includes('5/9：')&&state.highlights.some(h=>h.side==='left')&&state.highlights.some(h=>h.side==='right'));
    const columns=await renderer.evaluate(`(()=>{const visible=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0;};const diff=[...document.querySelectorAll('.monaco-diff-editor')].find(visible);const left=diff?.querySelector('.editor.original'),right=diff?.querySelector('.editor.modified');if(!left||!right)return null;const a=left.getBoundingClientRect(),b=right.getBoundingClientRect();return{left:{x:a.x,width:a.width,height:a.height},right:{x:b.x,width:b.width,height:b.height}};})()`);
    assert.ok(columns?.left.width>0&&columns.right.width>0&&columns.right.x>columns.left.x+columns.left.width-2,'窄diff必须实际左右并排显示');
    fs.writeFileSync(path.join(config.runRoot,'layout-columns.json'),JSON.stringify(columns,null,2));
    await check(); assert.ok(vscode.window.tabGroups.activeTabGroup.activeTab.input instanceof vscode.TabInputTextDiff); await copy('窄双侧diff');
  },'layout-narrow-diff.png');
  await renderer.protocol('Emulation.clearDeviceMetricsOverride');
  await command('stop'); await wait('停止移除行内文字及范围',state=>!state.comments.length&&!state.highlights.length);
};
