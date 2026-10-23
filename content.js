(() => {
  'use strict';
  if (document.getElementById('flow2k-extension')) return;
  const A = globalThis.Flow2KAdapter;
  const S = globalThis.Flow2KSelection;
  const host = document.createElement('div'); host.id = 'flow2k-extension';
  host.style.cssText = 'position:fixed;right:16px;top:72px;z-index:2147483646;';
  const ui = host.attachShadow({mode:'closed'});
  ui.innerHTML = `<style>
  :host{all:initial}*{box-sizing:border-box}section{width:350px;color:#eaeef4;background:#17202b;border:1px solid #455164;border-radius:16px;box-shadow:0 12px 40px #0009;font:13px/1.5 "Microsoft YaHei",sans-serif;overflow:hidden}header{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;background:#202c3a}strong{font-size:16px}small{color:#a8b5c8}main{padding:12px}button{cursor:pointer;color:#eff4ff;background:#344356;border:1px solid #58687c;border-radius:7px;padding:7px 10px;font:inherit}button:disabled{opacity:.45;cursor:default}.row{display:flex;gap:6px;margin-bottom:9px;flex-wrap:wrap}.primary{background:#286c50;border-color:#51a67f}#note{white-space:pre-wrap;color:#cbd7e7;margin:8px 0}#grid{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;max-height:34vh;overflow:auto}label{position:relative;cursor:pointer;background:#253242;border-radius:7px;overflow:hidden;border:2px solid transparent}label:has(input:checked){border-color:#79d9a9}label img{width:100%;height:86px;object-fit:cover;display:block}input{position:absolute;left:3px;top:3px;width:17px;height:17px}label span{display:block;padding:3px;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}#log{max-height:100px;overflow:auto;font-size:11px;color:#b9c7d9;white-space:pre-wrap}#count{margin:8px 0}summary{cursor:pointer;color:#aabacf}details{margin-top:8px}
  </style><section><header><div><strong>Flow 批量 2K</strong><br><small id="compact">0.2 · 原页面选图 → 右键下载</small></div><button id="fold">展开</button></header><main hidden>
  <div class="row"><button id="selection">校准原页选中状态</button></div>
  <div class="row"><button id="calibrate">① 校准图片菜单</button><button id="scan">② 收集已加载图片</button></div>
  <div id="note">首次使用：点击“校准图片菜单”，再点任意图片右上角的 ⋮。只识别图片，不会立即下载。</div>
  <div class="row"><button id="all">全选已收集</button><button id="clear">清空选择</button></div>
  <div id="grid"></div><div id="count">已选 0 张</div>
  <div class="row"><button class="primary" id="start">③ 下载所选 2K</button><button id="pause" disabled>本张完成后暂停</button></div>
  <small>运行时保留此页，不操作其他 Flow 下载。失败即停止，不自动降为 1K。刷新会清空选择。</small>
  <details><summary>日志与恢复</summary><div id="log"></div><button id="reset">解除待核对</button></details>
  </main></section>`;
  document.documentElement.append(host);
  const $ = id => ui.getElementById(id);
  let template = null, learning = false, running = false, stop = false, uncertain = false;
  let selectionRule=null, learningSelection=false, contextUntil=0, menuTimer=null;
  const records = new Map();
  const note = t => { $('note').textContent = t; $('compact').textContent=t; };
  const log = t => { $('log').textContent = (new Date().toLocaleTimeString() + ' ' + t + '\n' + $('log').textContent).slice(0,12000); };
  const delay = ms => new Promise(r => setTimeout(r,ms));
  async function send(type, token) {
    const r = await chrome.runtime.sendMessage({scope:'flow2k',type,token});
    if (!r?.ok) throw new Error(r?.error || '插件连接失效，请刷新页面。');
    return r;
  }
  function render() {
    $('grid').replaceChildren();
    let selected = 0, done = 0;
    for (const rec of records.values()) {
      if (rec.selected) selected++;
      if (rec.status === '已下载') done++;
      const label = document.createElement('label'), img = document.createElement('img'), check = document.createElement('input'), cap = document.createElement('span');
      img.src = rec.src; img.alt = rec.title; check.type = 'checkbox'; check.checked = rec.selected;
      check.disabled = running || rec.status === '已下载';
      check.addEventListener('change', () => {rec.selected = check.checked; render();});
      cap.textContent = '#' + rec.index + ' · ' + rec.status; label.title = rec.title;
      label.append(img,check,cap); $('grid').append(label);
    }
    $('count').textContent = `已收集 ${records.size} 张 · 已选 ${selected} 张 · 已下载 ${done} 张`;
    for (const id of ['calibrate','scan','all','clear','reset','selection']) $(id).disabled = running;
    $('start').disabled = running || !selected || uncertain; $('pause').disabled = !running;
  }
  function remember(item) {
    const scrolls=[];
    for(let el=item.root.parentElement;el;el=el.parentElement)
      if(el.scrollHeight>el.clientHeight || el.scrollWidth>el.clientWidth) scrolls.push({el,top:el.scrollTop,left:el.scrollLeft});
    if(!records.has(item.src)) records.set(item.src,{...item,scrolls,index:records.size+1,selected:false,status:'待选择'});
    else records.get(item.src).scrolls=scrolls;
    return records.get(item.src);
  }
  $('selection').onclick=()=>{
    learningSelection=!learningSelection; learning=false;
    note(learningSelection?'保持 Flow 已选状态，点一张白框选中图片以学习标记；这次点击不会取消选择。':'已取消选中校准。');
  };
  document.addEventListener('click',event=>{
    if(!learningSelection || event.composedPath().includes(host))return;
    const items=A.scan(template,false), item=items.find(x=>x.root.contains(event.target));
    if(!item){note('请点击原页面中的已选图片。需先完成图片菜单校准。');return;}
    event.preventDefault();event.stopImmediatePropagation();
    try {
      selectionRule=S.learn(item,items);learningSelection=false;
      chrome.storage.local.set({flow2kSelection:selectionRule}).catch(e=>log(e.message));
      note('选中标记已校准：识别到 '+items.filter(x=>S.selected(x,selectionRule)).length+' 张。请核对数量后右键下载。');
    }catch(e){note(e.message);}
  },true);
  function injectMenu() {
    if(running || Date.now()>contextUntil)return;
    for(const menu of document.querySelectorAll('[role="menu"]')) {
      if(!menu.getBoundingClientRect().width || menu.querySelector('[data-flow2k-action]'))continue;
      const cancel=S.action(menu,/取消选择|Deselect|Clear selection/i);
      const download=S.action(menu,/下载|Download/i);
      if(!cancel||!download)continue;
      const chosen=A.scan(template,false).filter(x=>S.selected(x,selectionRule));
      const button=document.createElement('button');
      button.type='button';button.setAttribute('role','menuitem');button.setAttribute('data-flow2k-action','true');
      button.className=download.className;
      button.style.cssText='display:flex;align-items:center;width:100%;min-width:240px;min-height:44px;padding:10px 16px;border:0;background:#254537;color:#c5ffe0;font:500 14px "Microsoft YaHei",sans-serif;text-align:left;cursor:pointer;';
      button.textContent=chosen.length?`批量 2K 重塑下载（${chosen.length} 张）`:'批量 2K：请先校准选中状态';
      button.addEventListener('pointerdown',e=>e.stopPropagation());
      button.addEventListener('click',async event=>{
        event.preventDefault();event.stopPropagation();contextUntil=0;
        if(running)return;
        if(uncertain){note('请先在日志与恢复中核对上次下载。');return;}
        if(!chosen.length){ui.querySelector('main').hidden=false;$('fold').textContent='收起';note('没有识别到选中图片。请先校准图片菜单，再点“校准原页选中状态”。');return;}
        // Freeze identity before clearing Flow selection. No small-thumbnail selection involved.
        for(const rec of records.values())rec.selected=false;
        for(const item of chosen){const rec=remember(item);rec.selected=rec.status!=='已下载';}
        render();
        if(![...records.values()].some(x=>x.selected)){note('所选图片在本页均已下载，已跳过重复下载。');return;}
        A.activate(cancel);
        await delay(350);
        if(A.scan(template,false).some(x=>S.selected(x,selectionRule))){note('Flow 未清除多选状态，已停止。请取消页面选择，再在面板中点下载所选 2K。');return;}
        escapeMenus();
        await $('start').onclick();
      });
      download.insertAdjacentElement('afterend',button);
    }
  }
  document.addEventListener('contextmenu',()=>{contextUntil=Date.now()+2500;setTimeout(injectMenu,120);},true);
  const menuObserver=new MutationObserver(()=>{
    if(Date.now()>contextUntil||menuTimer)return;
    menuTimer=setTimeout(()=>{menuTimer=null;injectMenu();},60);
  });
  menuObserver.observe(document.body,{childList:true,subtree:true});
  function collect() {
    if (!template) {note('请先校准图片菜单。'); return;}
    for (const item of A.scan(template)) {
      const scrolls=[];
      for(let el=item.root.parentElement;el;el=el.parentElement)
        if(el.scrollHeight>el.clientHeight || el.scrollWidth>el.clientWidth) scrolls.push({el,top:el.scrollTop,left:el.scrollLeft});
      if (!records.has(item.src)) records.set(item.src,{...item,scrolls,index:records.size+1,selected:false,status:'待选择'});
      else records.get(item.src).scrolls=scrolls;
    }
    render(); note(`已收集 ${records.size} 张。勾选要下载的图片。可滚动网页后再次收集；执行前请关闭原生菜单。`);
  }
  $('calibrate').onclick = () => {learning = !learning; note(learning ? '现在请点一张图片右上角的 ⋮（不是页面的其他按钮）。' : '已取消校准。');};
  document.addEventListener('click', event => {
    if (!learning || event.composedPath().includes(host)) return;
    const button = event.target.closest('button, [role="button"], [aria-haspopup="menu"]');
    if (!button) return;
    try {
      template = A.learn(button); learning = false; records.clear();
      chrome.storage.local.set({flow2kTemplate:template}).catch(e => log(e.message));
      collect(); note('校准完成。请点页面空白处关闭菜单，然后在面板内挑选图片。');
      log('已学习卡片菜单结构；真实下载需先用 1 张试跑。');
    } catch(e) {note(e.message);}
  },true);
  $('scan').onclick = collect;
  $('all').onclick = () => {for (const r of records.values()) if (r.status !== '已下载') r.selected = true; render();};
  $('clear').onclick = () => {for (const r of records.values()) r.selected = false; render();};
  $('fold').onclick = () => {const main = ui.querySelector('main'); main.hidden = !main.hidden; $('fold').textContent = main.hidden ? '展开' : '收起';};
  $('pause').onclick = () => {stop = true; note('已请求暂停；本张下载结束后不再处理下一张。');};
  $('reset').onclick = async () => {
    if (!confirm('请先查看 Edge 下载记录，并确认没有仍在进行或稍后会返回的 Flow 下载。继续可能重复下载待核对图片。确认已核对并解除监控？')) return;
    try {await send('reset'); uncertain=false; note('已解除监控。请取消勾选已下载的图片，再继续。'); render();} catch(e) {note(e.message);}
  };
  async function waitFor(get, ms=10000) {
    const until = Date.now()+ms;
    while(Date.now()<until) {const value = get(); if(value) return value; await delay(200);}
    throw new Error('未找到可用的下载 / 2K 菜单。可能需要重新校准，或当前账号不支持此选项。');
  }
  function escapeMenus() {
    for(let i=0;i<2;i++) {
      const el = document.activeElement || document.body;
      el.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true}));
      el.dispatchEvent(new KeyboardEvent('keyup',{key:'Escape',code:'Escape',bubbles:true}));
    }
  }
  async function process(rec) {
    if (location.href !== runUrl) throw new Error('项目页面已变化，已停止。');
    // Resolve fresh DOM nodes by the original source, never by grid position.
    let item = A.scan(template).find(x=>x.src===rec.src);
    if (!item) {
      for(const saved of rec.scrolls || []) if(saved.el.isConnected) saved.el.scrollTo({top:saved.top,left:saved.left,behavior:'instant'});
      await delay(900);
      item = A.scan(template).find(x=>x.src===rec.src);
    }
    if (!item) throw new Error('所选图片已被页面卸载。请滚回该图片所在位置再继续；不会用其他图片替代。');
    item.root.scrollIntoView({block:'center'}); await delay(450);
    item = A.scan(template).find(x=>x.src===rec.src);
    if (!item) throw new Error('图片位置发生变化，请重新收集。');
    escapeMenus(); await delay(250);
    A.activate(item.button);
    const download = await waitFor(()=>A.menuItem('download'));
    A.activate(download);
    const twoK = await waitFor(()=>A.menuItem('2k'));
    const token = crypto.randomUUID();
    await send('arm',token);
    // From this point on, failure is ambiguous; keep the lock until user reconciles.
    uncertain=true;
    A.activate(twoK);
    rec.status='2K 处理中'; render();
    const deadline=Date.now()+240000;
    while(Date.now()<deadline) {
      if(location.href!==runUrl) throw new Error('页面已切换，请核对本张下载结果。');
      const result=await send('poll',token);
      if(result.state==='complete') {
        await send('release',token); uncertain=false;
        rec.status='已下载'; rec.selected=false;
        log('#'+rec.index+' 浏览器已完成下载：'+result.filename+'（'+(result.bytes>=0 ? Math.round(result.bytes/1024)+' KB' : '大小未知')+'）');
        return;
      }
      await delay(1000);
    }
    throw new Error('等待下载超过 4 分钟。请查看 Flow 提示与 Edge 下载记录；为避免重复下载，队列已停止。');
  }
  let runUrl='';
  $('start').onclick = async () => {
    const queue=[...records.values()].filter(x=>x.selected && x.status!=='已下载');
    if(running || uncertain || !queue.length) return;
    running=true; stop=false; learning=false; runUrl=location.href; render();
    try {
      for(let i=0;i<queue.length;i++) {
        if(stop) break;
        const rec=queue[i]; rec.status='打开菜单'; render(); note(`正在处理 ${i+1}/${queue.length}：图片 #${rec.index}。请勿操作页面。`);
        try {await process(rec);} catch(e) {rec.status=uncertain?'待核对':'未完成'; throw e;}
        render(); await delay(1500);
      }
      note(stop?'队列已暂停，已完成的图片不会重复处理。':'本次队列下载完成。请检查首张图片的实际尺寸与清晰度。');
    } catch(e) {note(e.message); log(e.message);}
    finally {running=false; render();}
  };
  document.addEventListener('pointerdown',event=>{
    if(running && event.isTrusted && !event.composedPath().includes(host)) {
      stop=true; note('检测到手动操作，本张结束后暂停。');
    }
  },true);
  window.addEventListener('beforeunload',event=>{if(running){event.preventDefault();event.returnValue='';}});
  chrome.storage.local.get(['flow2kTemplate','flow2kSelection']).then(data=>{
    selectionRule=data.flow2kSelection||null;
    if(data.flow2kTemplate){template=data.flow2kTemplate;note('在 Flow 原页面选择图片，然后右键 → 批量 2K 重塑下载。');}
  }).catch(e=>log(e.message));
  render();
})();
