const {readFileSync}=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const path=require('node:path');
const base=path.resolve(__dirname,'.');
async function backgroundTests(){
  let listener, job, items=[];
  const chrome={runtime:{onMessage:{addListener:f=>listener=f}},storage:{session:{
    get:async()=>({job}),set:async o=>{job=o.job},remove:async()=>{job=undefined}
  }},downloads:{search:async()=>items}};
  vm.runInNewContext(readFileSync(path.join(base,'background.js'),'utf8'),{chrome,URL,Date,Promise,Error});
  const send=(type,token='a',id=1)=>new Promise(resolve=>listener({scope:'flow2k',type,token},{url:'https://flow.google.com/project/test',tab:{id}},resolve));
  assert.equal((await send('arm')).ok,true);
  assert.equal((await send('arm','b',2)).ok,false,'global lock prevents cross-tab queues');
  assert.equal((await send('reset','a',2)).ok,false,'other tab cannot reset active queue');
  items=[{id:1,startTime:new Date().toISOString(),url:'https://example.com/p.png',mime:'image/png',state:'complete',fileSize:100}];
  assert.equal((await send('poll')).state,'waiting','unrelated download excluded');
  items.push({id:2,startTime:new Date().toISOString(),url:'blob:https://flow.google.com/id',mime:'image/png',state:'in_progress',fileSize:-1});
  assert.equal((await send('poll')).state,'in_progress','click/start is not completion');
  items[1].state='complete';items[1].fileSize=204800;
  assert.equal((await send('poll')).state,'complete');
  items[1].state='interrupted';items[1].error='NETWORK_FAILED';
  assert.equal((await send('poll')).ok,false);
  items[1].state='complete';items[1].fileSize=0;
  assert.equal((await send('poll')).ok,false,'empty file rejected');
  items[1].fileSize=100;
  items.push({...items[1],id:3});
  assert.equal((await send('poll')).ok,false,'multiple candidates stop queue');
  assert.equal((await send('release')).ok,true);
  assert.equal((await send('arm','next')).ok,true);
  assert.equal((await send('poll','next')).state,'waiting','prior downloads excluded by baseline');
  console.log('PASS: download matching, completion, interruption, empty file, ambiguity, cross-tab lock, baseline');
}
async function domTests(){
  const {JSDOM}=require('jsdom');
  const dom=new JSDOM('<body><div class="card"><img src="https://example.com/a.png"><div><button aria-haspopup="menu">more_vert</button></div></div><div class="card"><img src="https://example.com/b.png"><div><button aria-haspopup="menu">more_vert</button></div></div></body>',{url:'https://flow.google.com/project/test',runScripts:'outside-only'});
  const w=dom.window;
  w.HTMLElement.prototype.getBoundingClientRect=function(){return {x:0,y:0,width:200,height:180}};
  w.PointerEvent=w.MouseEvent;
  w.eval(readFileSync(path.join(base,'adapter.js'),'utf8'));
  const A=w.Flow2KAdapter, template=A.learn(w.document.querySelector('button'));
  assert.equal(A.scan(template).length,2);
  const menu=w.document.createElement('div');menu.innerHTML='<div role="menuitem" aria-label="下载">download 下载 chevron_right</div><div role="menuitem">1K 原始尺寸</div><div role="menuitem">2K 已高清重塑</div><div role="menuitem" aria-disabled="true">4K 升级</div>';
  w.document.body.append(menu);
  assert.match(A.menuItem('download').textContent,/下载/);
  assert.equal(A.menuItem('2k').textContent,'2K 已高清重塑');
  A.menuItem('2k').setAttribute('aria-disabled','true');assert.equal(A.menuItem('2k'),null);
  const duplicate=menu.firstElementChild.cloneNode(true);menu.append(duplicate);
  assert.throws(()=>A.menuItem('download'),/多个/);duplicate.remove();
  let clicked=0;A.menuItem('download').addEventListener('click',()=>clicked++);A.activate(A.menuItem('download'));assert.equal(clicked,1);
  w.document.querySelector('img').src='https://example.com/replaced.png';
  assert.equal(A.scan(template).some(x=>x.src==='https://example.com/a.png'),false,'recycled DOM does not substitute image');
  w.chrome={storage:{local:{get:async()=>({}),set:async()=>{}}}};
  w.eval(readFileSync(path.join(base,'content.js'),'utf8'));
  assert.ok(w.document.getElementById('flow2k-extension'),'content script mounts');
  console.log('PASS: calibration, card discovery, Chinese menus, disabled 2K, ambiguous menus, click, recycled images, content mount');
  dom.window.close();
}
async function nativeSelectionTests(){
  const {JSDOM}=require('jsdom');
  const dom=new JSDOM('<body>'+[1,2,3].map(i=>`<div class="card ${i<3?'selected':''}"><img src="https://example.com/${i}.png"><div><button aria-haspopup="menu">more_vert</button></div></div>`).join('')+'</body>',{url:'https://flow.google.com/project/test',runScripts:'outside-only'});
  const w=dom.window, d=w.document;
  w.HTMLElement.prototype.getBoundingClientRect=()=>({x:0,y:0,width:200,height:180});
  w.HTMLElement.prototype.scrollIntoView=()=>{};w.PointerEvent=w.MouseEvent;
  const attach=w.HTMLElement.prototype.attachShadow;
  w.HTMLElement.prototype.attachShadow=function(){return attach.call(this,{mode:'open'})};
  const timeout=w.setTimeout.bind(w);w.setTimeout=(fn,ms)=>timeout(fn,Math.min(ms,5));
  for(const file of ['adapter.js','selection.js'])w.eval(readFileSync(path.join(base,file),'utf8'));
  const A=w.Flow2KAdapter,S=w.Flow2KSelection,template=A.learn(d.querySelector('button'));
  let items=A.scan(template,false);
  assert.equal(items.filter(x=>S.selected(x)).length,2,'recognize only selected cards');
  d.querySelector('.selected').className='card';
  assert.equal(A.scan(template,false).filter(x=>S.selected(x)).length,1,'deselection reflected');
  d.querySelector('.card').classList.add('selected');
  const rule=S.learn(items[0],items);
  assert.equal(items.filter(x=>S.selected(x,rule)).length,2,'calibrated rule');
  const downloaded=[],messages=[];
  let active=0;
  w.chrome={storage:{local:{get:async()=>({flow2kTemplate:template}),set:async()=>{}}},runtime:{sendMessage:async m=>{
    messages.push(m.type);
    if(m.type==='arm'){active++;assert.equal(active,1,'sequential requests');return{ok:true}}
    if(m.type==='poll')return{ok:true,state:'complete',filename:'test.png',bytes:100};
    if(m.type==='release')active--;
    return{ok:true};
  }}};
  for(const [index,btn]of [...d.querySelectorAll('.card button')].entries()){
    btn.onclick=()=>{
      const menu=d.createElement('div');menu.setAttribute('role','menu');
      const dl=d.createElement('button');dl.setAttribute('role','menuitem');dl.textContent='下载';
      dl.onclick=()=>{
        dl.remove();const two=d.createElement('button');two.setAttribute('role','menuitem');two.textContent='2K 已高清重塑';
        two.onclick=()=>{downloaded.push(index+1);menu.remove()};menu.append(two);
      };menu.append(dl);d.body.append(menu);
    };
  }
  w.eval(readFileSync(path.join(base,'content.js'),'utf8'));
  await new Promise(r=>setTimeout(r,10));
  const menu=d.createElement('div');menu.setAttribute('role','menu');
  menu.innerHTML='<button role="menuitem">下载</button><button role="menuitem">取消选择</button>';
  menu.lastElementChild.onclick=()=>{d.querySelectorAll('.selected').forEach(x=>x.classList.remove('selected'));menu.remove()};
  d.body.append(menu);d.querySelector('img').dispatchEvent(new w.MouseEvent('contextmenu',{bubbles:true}));
  await new Promise(r=>setTimeout(r,20));
  assert.equal(d.querySelectorAll('[data-flow2k-action]').length,1,'one injected menu entry');
  const entry=d.querySelector('[data-flow2k-action]');assert.match(entry.textContent,/2 张/);
  entry.click();
  for(let i=0;i<100 && downloaded.length<2;i++)await new Promise(r=>setTimeout(r,10));
  assert.deepEqual(downloaded,[1,2],'native selection drives queue without unrelated card');
  await new Promise(r=>setTimeout(r,20));
  assert.equal(active,0);
  assert.deepEqual(messages,['arm','poll','release','arm','poll','release']);
  assert.equal(d.getElementById('flow2k-extension').shadowRoot.querySelector('main').hidden,true,'panel starts collapsed');
  console.log('PASS: native multi-selection, deselection, calibration, menu injection, selection freeze/clear, two-item 2K queue, no unselected downloads');
  dom.window.close();
}
(async()=>{await backgroundTests();await domTests();await nativeSelectionTests()})().catch(e=>{console.error(e);process.exitCode=1});
