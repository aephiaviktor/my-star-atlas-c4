// C4-only accounting view. Signed returns must never be drawn as positive pie slices.
(function(root){
  const node=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};
  function render(result,prefix){
    const set=(suffix,text)=>{const e=document.getElementById(prefix+'-'+suffix);if(e)e.textContent=text;};
    const total=result.totals.reduce((n,r)=>n+BigInt(r.quantity),0n);
    set('avg-value','—');set('avg-note','Captured transfers; no rate estimate');
    set('total-value',result.entries.length?total.toString():'—');set('total-note',result.basis);
    const top=result.totals.reduce((best,r)=>!best||BigInt(r.quantity)>BigInt(best.quantity)?r:best,null);
    set('top-value',top?.label||'—');set('top-note','Largest net resource quantity');
    set(prefix==='mining'?'material-count-value':'asset-count-value',String(result.totals.length));
    set(prefix==='mining'?'material-count-note':'asset-count-note','Recorded resources');
    set(prefix==='mining'?'fleet-note':'filter-note','Last 30 days · '+result.basis);
    const grid=document.getElementById(prefix+'-chart-grid');grid.replaceChildren();
    const note=node('p',result.warning+' '+result.issues.length+' transfer attribution issue(s) in captured history.');note.style.gridColumn='1 / -1';grid.append(note);
    if(!result.entries.length){grid.append(node('p','No eligible recorded transfers for this selection.'));return;}
    for(const resource of result.totals){
      const card=node('section');card.className='resource-card';card.append(node('h3',resource.label),node('strong',resource.quantity));
      const matching=result.entries.filter(e=>e.resource===resource.resource);
      const loads=matching.filter(e=>BigInt(e.quantity)>0n).reduce((n,e)=>n+BigInt(e.quantity),0n);
      const returns=matching.filter(e=>BigInt(e.quantity)<0n).reduce((n,e)=>n-BigInt(e.quantity),0n);
      card.append(node('p',result.kind==='consumption'?`Loaded: ${loads} · Returned: ${returns} · Net: ${resource.quantity}`:'Recorded on successful unload'));
      const details=node('details');details.append(node('summary','Transfer evidence ('+matching.length+')'));
      const table=node('table');table.className='fleet-table';const head=node('tr');for(const title of ['UTC','Fleet','Quantity','Signature'])head.append(node('th',title));table.append(head);
      for(const e of matching){const row=node('tr');for(const value of [e.time,e.fleetName,e.quantity,e.signature])row.append(node('td',value));table.append(row);}
      details.append(table);card.append(details);grid.append(card);
    }
  }
  root.C4MiningAccountingUI={render};
})(globalThis);
