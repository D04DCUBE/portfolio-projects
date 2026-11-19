const fs=require('fs');const css=fs.readFileSync('tokens.css','utf8');
function block(sel){const i=css.indexOf(sel);const s=css.indexOf('{',i);const e=css.indexOf('}',s);return css.slice(s+1,e)}
function vars(b){const o={};for(const m of b.matchAll(/--(ds-[a-z-]+):\s*(#[0-9a-fA-F]{6})/g))o[m[1]]=m[2];return o}
const light=vars(block(':root {')); const dark={...light,...vars(block(':root[data-theme="dark"]'))};
const lum=h=>{const c=[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)/255).map(v=>v<=.03928?v/12.92:((v+.055)/1.055)**2.4);return .2126*c[0]+.7152*c[1]+.0722*c[2]};
const cr=(a,b)=>{const [x,y]=[lum(a),lum(b)].sort((p,q)=>q-p);return (x+.05)/(y+.05)};
const pairs=[ // [fg,bg,min,label]
 ['ds-fg','ds-bg',4.5,'body text on page'],['ds-fg-muted','ds-bg',4.5,'muted text on page'],['ds-fg','ds-surface',4.5,'text on surface'],
 ['ds-fg-muted','ds-surface',4.5,'muted on surface'],
 ['ds-primary-fg','ds-primary',4.5,'primary button text'],['ds-primary-fg','ds-primary-hover',4.5,'primary hover text'],
 ['ds-danger-fg','ds-danger',4.5,'danger button text'],['ds-danger-fg','ds-danger-hover',4.5,'danger hover text'],
 ['ds-danger','ds-bg',4.5,'error text on page'],['ds-danger','ds-surface',4.5,'error text on surface'],
 ['ds-border','ds-bg',3,'input border (UI)'],['ds-focus','ds-bg',3,'focus ring on page'],
 ['ds-info','ds-surface',3,'info border (UI)'],['ds-success','ds-surface',3,'success border (UI)'],['ds-warning','ds-surface',3,'warning border (UI)'],
 ['ds-bg','ds-info',4.5,'info icon'],['ds-bg','ds-success',4.5,'success icon'],['ds-bg','ds-warning',4.5,'warning icon'],['ds-bg','ds-danger',4.5,'error icon']];
let bad=0;
for(const [name,t] of [['LIGHT',light],['DARK',dark]]){console.log('--',name);
 for(const [f,b,min,l] of pairs){const r=cr(t[f],t[b]);const ok=r>=min;if(!ok)bad++;console.log((ok?'ok  ':'FAIL')+' '+r.toFixed(2).padStart(5)+' (need '+min+') '+l+'  '+t[f]+' on '+t[b])}}
console.log('failures:',bad);
