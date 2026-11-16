// Run the public review script against a small DOM and API stand-in.
// These checks never touch published reviews or live feedback.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { test } from 'node:test';

const source=await readFile(new URL('../review/app.js',import.meta.url),'utf8');

async function harness(initialReceipts={}){
  const nodes=new Map(),storage=new Map([['review-feedback-receipts',JSON.stringify(initialReceipts)]]),requests=[],records=[];
  let nextID=0,pendingPost=null;
  class Node {
    constructor(key){this.key=key;this.value='';this.dataset={};this.style={};this.hidden=false;this.disabled=false;this.required=false;this.inert=false;this.attributes={};this.html='';this.children=[];this.classes=new Set();this.classList={add:value=>this.classes.add(value),remove:value=>this.classes.delete(value),toggle:(value,on)=>{if(on??!this.classes.has(value))this.classes.add(value);else this.classes.delete(value)}}}
    set innerHTML(value){this.html=value;this.children=[...value.matchAll(/<button\b([^>]*)>/g)].map(([,attrs])=>{const child=new Node('button');for(const [,name,value] of attrs.matchAll(/([\w-]+)(?:="([^"]*)")?/g)){child.attributes[name]=value??'';if(name.startsWith('data-'))child.dataset[name.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase())]=value??''}return child})}
    get innerHTML(){return this.html}
    setAttribute(name,value){this.attributes[name]=String(value)}
    hasAttribute(name){return Object.hasOwn(this.attributes,name)}
    removeAttribute(name){delete this.attributes[name]}
    querySelectorAll(selector){const name=/^\[([^\]]+)\]$/.exec(selector)?.[1];return name?this.children.filter(child=>child.hasAttribute(name)):[]}
    querySelector(selector){return node(`${this.key} ${selector}`)}
    closest(selector){return selector==='nav'?node('nav'):this}
    showModal(){this.open=true}
    close(){this.open=false}
    focus(){this.focused=true}
    pause(){}
    load(){}
    reset(){node('#form textarea').value='';node('#reaction').value=''}
  }
  function node(key){key=({'#feedback-comment':'#form textarea','#form .feedback-picks':'#feedback-picks'})[key]||key;if(!nodes.has(key))nodes.set(key,new Node(key));return nodes.get(key)}
  const fetch=async(path,options={})=>{
    const body=options.body?JSON.parse(options.body):undefined;requests.push({path,method:options.method||'GET',body});
    if(path==='/api/board'||path==='/api/jingles/board')return {ok:true,json:async()=>({iterations:[]})};
    if(path==='/api/comments'&&options.method==='POST'){
      if(pendingPost){await pendingPost;pendingPost=null}
      const comment={message:body.message,createdAt:'2026-11-16T12:00:00.000Z',...(body.reaction?{reaction:body.reaction}:{})};
      const id=`feedback-${++nextID}.json`,token=`receipt-${nextID}`;records.push({...body,...comment,id,token});return {ok:true,json:async()=>({id,token,comment})};
    }
    if(path==='/api/comments/remove'&&options.method==='POST'){
      const index=records.findIndex(record=>record.id===body.id&&record.token===body.token&&record.kind===body.kind&&record.iteration===body.iteration&&record.slot===body.slot);
      if(index<0)return {ok:false,json:async()=>({error:'Invalid removal receipt'})};records.splice(index,1);return {ok:true,json:async()=>({ok:true})};
    }
    if(path.startsWith('/api/comments?')){
      const query=new URL(path,'https://intro-maker.example').searchParams;
      return {ok:true,json:async()=>({canRemove:false,comments:records.filter(record=>record.kind===query.get('kind')&&record.iteration===+query.get('iteration')&&record.slot===+query.get('slot')).map(({token,kind,iteration,slot,...record})=>record)})};
    }
    throw new Error(`Unexpected request: ${path}`);
  };
  const context=vm.createContext({URL,console,location:{href:'https://intro-maker.example/',pathname:'/'},history:{pushState(){},replaceState(){}},window:{matchMedia:()=>({matches:false})},document:{hidden:false,body:{style:{}},querySelector:node,querySelectorAll:()=>[],addEventListener(){}},localStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)},createGalleryPlayback:()=>({start(){},stop(){},destroy(){}}),FormData:class {get(){return ''}},fetch});
  new vm.Script(source).runInContext(context);await new Promise(setImmediate);
  return {context,node,requests,records,storage,run:code=>vm.runInContext(code,context),deferPost(){let resolve;pendingPost=new Promise(done=>{resolve=done});return resolve},submit:()=>node('#form').onsubmit({preventDefault(){},currentTarget:node('#form')})};
}

await test('logo cards have a plain heading, visible chosen label, and comment action fourth',async()=>{
  const h=await harness();
  const card=h.run("renderCard({slot:3,title:'Gentle <reveal>',url:'/recording.mp4'})");
  assert.match(card,/<h2 class="intro-title">Gentle &lt;reveal&gt;<\/h2>/);
  assert.doesNotMatch(card,/class="open-label"/);
  assert.match(card,/<span class="chosen-label">This Is The One<\/span>/);
  assert.doesNotMatch(card,/This Is The One!/);
  assert.deepEqual([...card.matchAll(/data-vote="([^"]+)"|data-comment-open/g)].map(match=>match[1]||'comment'),['chosen','up','down','comment']);
});

await test('comment action opens a focused required textarea without requiring a rating',async()=>{
  const h=await harness();
  h.run("board={iterations:[{number:4,items:[{slot:2,title:'Soft reveal'}]}]};activeIteration=4;render()");
  const commentButton=h.node('#grid').children.find(button=>button.hasAttribute('data-comment-open'));
  h.node('#grid').onclick({target:{closest:selector=>selector==='[data-open]'?commentButton:null}});
  assert.equal(h.node('#feedback-dialog').open,true);
  assert.equal(h.node('#feedback-title').textContent,'Soft reveal');
  assert.equal(h.node('#feedback-prompt').textContent,'Leave a comment about this video.');
  assert.equal(h.node('#feedback-picks').hidden,true);
  assert.equal(h.node('#form textarea').focused,true);
  assert.equal(h.node('#form textarea').required,true);
  assert.equal(h.node('#form textarea').disabled,false);
  assert.equal(h.node('#reaction').value,'');
  assert.equal(h.node('#form .send').disabled,true);
  h.node('#form textarea').value=' \n  ';h.node('#form textarea').oninput();await h.submit();
  assert.equal(h.node('#form .send').disabled,true);
  assert.equal(h.requests.filter(request=>request.method==='POST').length,0);
});

await test('comments target their exact review and retain removal receipts without clearing previous ratings',async()=>{
  for(const kind of ['logo','jingle']){
    const key=`${kind}/4/2`,h=await harness({[key]:[{id:'old-rating.json',token:'old-receipt',reaction:'up'}]});
    h.run(`activeKind=${JSON.stringify(kind)};board={iterations:[{number:4,items:[{slot:2,title:'Option two'}]}]};activeIteration=4;render();showFeedback({kind:activeKind,iteration:4,slot:2,item:{title:'Option two'}},'comment')`);
    h.node('#form textarea').value='  Please hold this frame longer.  ';h.node('#form textarea').oninput();
    assert.equal(h.node('#form .send').disabled,false);
    await h.submit();
    const request=h.requests.find(request=>request.method==='POST');
    assert.deepEqual(request.body,{kind,iteration:4,slot:2,message:'Please hold this frame longer.'});
    const saved=JSON.parse(h.storage.get('review-feedback-receipts'))[key];
    assert.equal(saved.length,2);assert.equal(saved[1].token,'receipt-1');assert.equal(Object.hasOwn(saved[1],'reaction'),false);
    assert.equal(h.run(`lastReaction({kind:${JSON.stringify(kind)},iteration:4,slot:2})`),'up');
    const up=h.node('#grid').children.find(button=>button.dataset.vote==='up');
    assert.equal(up.attributes['aria-pressed'],'true');
    h.run(`selected={kind:${JSON.stringify(kind)},iteration:4,slot:2,item:{title:'Option two'}}`);await h.run('loadComments()');
    const remove=h.node('#comments').children.find(button=>button.dataset.comment==='feedback-1.json');assert.ok(remove,'Own message-only comment has a removal action');
    await remove.onclick();
    assert.deepEqual(h.requests.find(request=>request.path==='/api/comments/remove').body,{kind,iteration:4,slot:2,id:'feedback-1.json',token:'receipt-1'});
    assert.equal(h.records.length,0);assert.equal(JSON.parse(h.storage.get('review-feedback-receipts'))[key].length,1);
    assert.equal(h.run(`lastReaction({kind:${JSON.stringify(kind)},iteration:4,slot:2})`),'up');
  }
});

await test('a successful submission keeps its receipt after the dialog closes during the request',async()=>{
  const h=await harness(),resolve=h.deferPost();
  h.run("showFeedback({kind:'logo',iteration:7,slot:3,item:{title:'Pending comment'}},'comment')");
  h.node('#form textarea').value='Keep this feedback.';
  const pending=h.submit();h.node('#feedback-cancel').onclick();resolve();await pending;
  assert.equal(h.node('#feedback-dialog').open,false);
  const saved=JSON.parse(h.storage.get('review-feedback-receipts'))['logo/7/3'];
  assert.equal(saved[0].token,'receipt-1');
});
