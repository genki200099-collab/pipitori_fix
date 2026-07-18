'use strict';

const assert=require('assert');
const fs=require('fs');
const path=require('path');
const acorn=require('acorn');
const csstree=require('css-tree');
const parse5=require('parse5');

const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'public','index.html'),'utf8');
const serverSource=fs.readFileSync(path.join(root,'server.js'),'utf8');
const document=parse5.parse(html);
const ids=new Map();
const styles=[];
const scripts=[];
let inlineClickCount=0;

(function walk(node){
  if(node.tagName==='style') styles.push((node.childNodes||[]).map(child=>child.value||'').join(''));
  if(node.tagName==='script' && !(node.attrs||[]).some(attr=>attr.name==='src')) scripts.push((node.childNodes||[]).map(child=>child.value||'').join(''));
  for(const attr of node.attrs||[]){
    if(attr.name==='id') ids.set(attr.value,(ids.get(attr.value)||0)+1);
    if(attr.name==='onclick') inlineClickCount++;
  }
  for(const child of node.childNodes||[]) walk(child);
})(document);

assert.strictEqual(styles.length,1,'one consolidated stylesheet expected');
assert.strictEqual(scripts.length,1,'one consolidated client script expected');
assert.deepStrictEqual([...ids].filter(([,count])=>count>1),[],'duplicate DOM ids are not allowed');
assert.strictEqual(inlineClickCount,0,'inline click handlers are not allowed');
assert.doesNotMatch(html,/\sonclick=/,'generated markup must also avoid inline click handlers');
assert.doesNotMatch(scripts[0],/\balert\s*\(/,'blocking browser alerts must not interrupt play');

for(const css of styles) csstree.parse(css,{positions:true});
const serverAst=acorn.parse(serverSource,{ecmaVersion:'latest',sourceType:'script',locations:true});
const clientAst=acorn.parse(scripts[0],{ecmaVersion:'latest',sourceType:'script',locations:true});

function duplicateTopLevelFunctions(ast){
  const names=new Map();
  for(const node of ast.body){
    if(node.type!=='FunctionDeclaration') continue;
    const lines=names.get(node.id.name)||[];
    lines.push(node.loc.start.line);
    names.set(node.id.name,lines);
  }
  return [...names].filter(([,lines])=>lines.length>1);
}
assert.deepStrictEqual(duplicateTopLevelFunctions(serverAst),[],'server functions must not be silently overridden');
assert.deepStrictEqual(duplicateTopLevelFunctions(clientAst),[],'client functions must not be silently overridden');

assert.match(html,/viewport-fit=cover/);
assert.match(html,/env\(safe-area-inset-bottom\)/);
assert.match(html,/@media\(prefers-reduced-motion:reduce\)/);
assert.match(html,/:where\(button,input,select,summary,\[tabindex\]\):focus-visible/);
assert.match(html,/\.hud-button\{min-width:42px;min-height:36px/);
assert.match(html,/\.round-panel \.round-actions\{position:sticky/);
assert.match(serverSource,/maxPayload:64 \* 1024/);
assert.match(serverSource,/try\{[\s\S]*client message handling error/);

console.log(JSON.stringify({
  result:'passed',
  htmlBytes:Buffer.byteLength(html),
  ids:ids.size,
  cssParsed:true,
  serverFunctions:serverAst.body.filter(node=>node.type==='FunctionDeclaration').length,
  clientFunctions:clientAst.body.filter(node=>node.type==='FunctionDeclaration').length,
  duplicateIds:0,
  duplicateFunctions:0,
  blockingAlerts:0
}));
