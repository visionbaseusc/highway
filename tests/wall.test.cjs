// Run with: node --test tests/wall.test.cjs
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(new URL('../index.html', 'file://' + __filename), 'utf8');
function section(start, end) { return html.slice(html.indexOf(start), html.indexOf(end, html.indexOf(start))); }
const source = section('function wallMat(tex)', '// ---- construction fences') + section('class Board {', 'const wallGuides');
function setup(length, maxTextureSize = 8192) {
  const meshes = [];
  class Geometry { constructor(){this.attributes={};} setAttribute(n,v){this.attributes[n]=v;} setIndex(v){this.index=v;} dispose(){} translate(){} }
  class Attribute {constructor(a,n){this.array=a;this.itemSize=n;}}
  const context = vm.createContext({
    THREE: {ShaderMaterial: class {constructor(o){Object.assign(this,o);}}, DoubleSide:2, BufferGeometry: Geometry, Float32BufferAttribute:Attribute, Mesh:class{constructor(g,m){this.geometry=g;this.material=m;}}, BoxGeometry:Geometry},
    WL:{bay_m:2,row_h:.5,rows:6}, LIGHT:'', common:()=>({}),
    $:()=>({value:0}), scene:{remove(){},add(m){meshes.push(m);}},
    WALLS:{1:[[80,80+length]],'-1':[[80,80+length]]}, Y_WALL:30.5,
    Geo:class{mesh(){return {geometry:new Geometry()};}}, fr:m=>({rx:1,rz:0,p:0,h:0}), P:(f,y,h)=>[y,h,0], gnd:()=>0,
    mtx:v=>v, sweep(){}, range:()=>[], inst:()=>({geometry:new Geometry()}), lam:()=>({}), MATS:{concrete:{}},
    renderer:{capabilities:{maxTextureSize}},PXM:50,meshes,
  });
  vm.runInContext(source+'; buildWalls();',context);
  return {context,meshes};
}
for(const length of [100,250,700,247]) test(`${length} m: exact geometry, both driving directions, local UV and 3 m height`,()=>{
  const {context,meshes}=setup(length);
  assert.equal(meshes.length,2);
  for(const mesh of meshes){
    const g=mesh.geometry;
    assert.equal(g.attributes.aBay.array.length/4,Math.ceil(length/2));
    assert.equal(mesh.userData.end-mesh.userData.start,length);
    assert.equal(mesh.material.uniforms.uLength.value,length);
    assert.equal(Math.min(...g.attributes.aAlong.array),0);
    assert.equal(Math.max(...g.attributes.aAlong.array),length);
    assert.equal(Math.max(...g.attributes.aH.array),3);
    // Last panel in travel direction always reaches the wall end, including a 1 m remainder.
    const last=g.attributes.aAlong.array.slice(-4);
    assert.equal(Math.min(...last),Math.floor((length-1)/2)*2);
    assert.equal(Math.max(...last),length);
  }
  assert.equal(vm.runInContext('WALL_GEOM.len',context),length*2);
  assert.equal(vm.runInContext('WALL_GEOM.area',context),length*2*3);
});
for(const max of [4096,8192]) test(`resize composition and cap long-wall canvas on ${max}px GPU`,()=>{
  const {context}=setup(250,max);
  vm.runInContext(`var board = Object.create(Board.prototype); board.key="wall"; board.out={width:2000,height:150}; board.layers=[{x:0,y:0,w:2000,h:150},{x:500,y:30,w:400,h:60}];`,context);
  for(const length of [100,250,700,40,250]){
    vm.runInContext(`board.setSize(${length},3)`,context);
    const result=vm.runInContext('JSON.stringify({out:board.out,layers:board.layers})',context);
    const {out,layers}=JSON.parse(result);
    assert.ok(out.width<=max && out.height<=max);
    assert.ok(Math.abs(layers[0].w-out.width)<1e-8);
    assert.ok(Math.abs(layers[0].h-out.height)<1e-8);
    assert.ok(Math.abs(layers[1].x/out.width-.25)<1e-8);
    assert.ok(Math.abs(layers[1].y/out.height-.2)<1e-8);
  }
});

for (const length of [100,250,700]) test(`${length} m: whole-wall paste and drop include both image edges`,()=>{
  const {context}=setup(length);
  vm.runInContext(`var board = Object.create(Board.prototype); board.key='wall'; board.out={width:8192,height:98}; board.layers=[]; board.changed=()=>{}; board.setSize(${length},3); $=()=>({value:'fit'});`,context);
  // Twice as wide as the intended physical wall; old height-only fitting cropped half.
  vm.runInContext(`board.addImage({width:${length*100},height:150},'wide',{x:500})`,context);
  const r=JSON.parse(vm.runInContext('JSON.stringify({layer:board.layers[0],out:board.out})',context));
  assert.equal(r.layer.x,0); assert.equal(r.layer.y,0);
  assert.equal(r.layer.w,r.out.width); assert.equal(r.layer.h,r.out.height);
  vm.runInContext(`board.addImage({width:1000,height:300},'cell',{cell:{x:12,y:4,w:24,h:10}})`,context);
  const cell=JSON.parse(vm.runInContext('JSON.stringify(board.layers[1])',context));
  assert.deepEqual([cell.x,cell.y,cell.w,cell.h],[12,4,24,10]);
});
test('overview fits the whole canvas at each preset and zoom can enlarge it',()=>{
  const context=vm.createContext({active:{out:{width:8192,height:98}},stage:{clientWidth:1246,clientHeight:120},$:()=>({value:0})});
  vm.runInContext(section('function boardScale()', 'function drawBoard()'),context);
  for(const [w,h] of [[5000,150],[8192,98],[8192,35]]){
    context.active.out={width:w,height:h};
    const scale=vm.runInContext('boardScale()',context);
    assert.ok(w*scale<=1224 && h*scale<=102);
  }
  context.$=()=>({value:100});
  assert.ok(vm.runInContext('boardScale()*active.out.width',context)>1246);
});
