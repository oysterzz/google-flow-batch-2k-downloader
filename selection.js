(() => {
  'use strict';
  // Only inspect the image's own ancestry, never siblings or the page selection container.
  function chain(item) {
    const nodes=[];
    for(let n=item.img,level=0;n && level<10;n=n.parentElement,level++) {
      if(n===document.body || n===document.documentElement) break;
      if([...n.querySelectorAll('img')].filter(x=>{const r=x.getBoundingClientRect();return r.width>=90&&r.height>=70;}).length>1) break;
      nodes.push(n);
    }
    return nodes;
  }
  function explicit(n) {
    for(const name of ['aria-selected','data-selected','data-is-selected']) {
      if(n.hasAttribute(name)) return n.getAttribute(name)==='true';
    }
    if(['selected','checked'].includes(n.getAttribute('data-state'))) return true;
    if([...n.classList].some(c=>/^(?:selected|is-selected|isSelected|selected-item|item-selected|selected-card|card-selected|selected-tile|tile-selected)$/.test(c))) return true;
    return null;
  }
  function selected(item,rule) {
    const nodes=chain(item);
    if(rule) {
      const n=nodes[rule.level];
      return !!n && (rule.kind==='class' ? n.classList.contains(rule.value) : n.getAttribute(rule.name)===rule.value);
    }
    for(const n of nodes) {const state=explicit(n);if(state!==null)return state;}
    return false;
  }
  function learn(item,items) {
    const nodes=chain(item), candidates=[];
    nodes.forEach((n,level)=>{
      const others=items.filter(x=>x.src!==item.src).map(x=>chain(x)[level]).filter(Boolean);
      if(!others.length)return;
      for(const name of ['aria-selected','data-selected','data-is-selected','data-state']) {
        const value=n.getAttribute(name);
        if(value && !['false','unselected','unchecked'].includes(value) && others.some(x=>x.getAttribute(name)!==value))
          candidates.push({kind:'attr',name,value,level,score:100});
      }
      for(const value of n.classList) {
        if(/(?:hover|focus|active|unselected|ng-|ng_|cdk-|mat-)/i.test(value) || /[\[\]:]/.test(value))continue;
        const differing=others.filter(x=>!x.classList.contains(value)).length;
        if(differing && /select|ring|border|outline/i.test(value))
          candidates.push({kind:'class',value,level,score:/select/i.test(value)?90:10});
      }
    });
    candidates.sort((a,b)=>b.score-a.score);
    if(!candidates.length) throw new Error('没有找到可靠的选中标记。请保留至少一张未选图片，再校准；不要开始下载。');
    const best=candidates[0];
    const set=items.filter(x=>selected(x,best)).map(x=>x.src).sort().join('\n');
    if(candidates.some(x=>x.score===best.score && items.filter(i=>selected(i,x)).map(i=>i.src).sort().join('\n')!==set))
      throw new Error('选中标记不明确，请重新选择少量图片后校准。');
    return best;
  }
  function action(menu,pattern) {
    return [...menu.querySelectorAll('[role="menuitem"],button')].find(el=>!el.hasAttribute('data-flow2k-action')&&pattern.test((el.textContent||'').trim()));
  }
  globalThis.Flow2KSelection={selected,learn,action};
})();
