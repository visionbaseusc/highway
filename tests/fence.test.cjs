// Run with: node --test tests/
// Construction fence: a longer image must give a longer unit, never a stretched image.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(new URL('../index.html', 'file://' + __filename), 'utf8');
function section(start, end) {
  const i = html.indexOf(start); assert.ok(i >= 0, 'missing in index.html: ' + start);
  const j = html.indexOf(end, i); assert.ok(j > i, 'missing in index.html: ' + end);
  return html.slice(i, j);
}
const source = [
  section('class Board {', 'const wallGuides'),
  section('function fenceSettings()', "for (const id of ['wallLength'"),
  section('function slotOf(name)', 'const stamp'),
  section('async function setFileImage', 'let XLSX'),
].join('\n');
const PXM = Number(/const PXM = (\d+)/.exec(html)[1]);
const H = 2.4;                                                    // fence height, m

function setup() {
  const els = {fenceW: {value: '20'}, wallMapping: {value: 'repeat'}};
  const slots = {};
  const ctx = vm.createContext({
    PXM, Math, Number, Promise,
    $: id => els[id] || (els[id] = {value: ''}),
    document: {createElement: () => ({width: 0, height: 0, getContext: () => ({})})},
    THREE: {CanvasTexture: class {constructor(i) {this.image = i; this.disposed = 0;} dispose() {this.disposed++;}}, SRGBColorSpace: 'srgb', RepeatWrapping: 1},
    renderer: {capabilities: {maxTextureSize: 16384, getMaxAnisotropy: () => 16}},
    fenceMat: {uniforms: {uFW: {value: 20}}},
    scheduleApply() {}, drawBoard() {}, updateButtons() {}, applyBoard() {},
    setSlot: (slot, state, tip) => { slots[slot] = {state, tip}; },
    loadImg: src => Promise.resolve(src),                         // tests pass {width, height} as the "src"
    fenceGuides() {}, fenceCell: (b, x) => ({x: Math.floor(x / (2 * PXM)) * 2 * PXM, y: 0, w: 2 * PXM, h: b.out.height}),
  });
  vm.runInContext(source + `
    var BOARDS = {};
    BOARDS.fence = new Board('fence', '施工圍籬', 20, ${H}, { guides: fenceGuides, cellOf: fenceCell, file: '施工圍籬.png', keepScale: true });
    BOARDS.wall = new Board('wall', '隔音牆', 60, 3, {});
    var api = { setFileImage, fenceSettings, slotOf, BOARDS };`, ctx);
  const api = vm.runInContext('api', ctx);
  const fence = api.BOARDS.fence;
  const fileLayer = () => fence.layers.find(l => l.linked === 'file');
  const setWidth = w => { els.fenceW.value = String(w); api.fenceSettings(); };
  return {api, els, slots, ctx, fence, fileLayer, setWidth};
}

// The image's horizontal scale (px of canvas per px of image) must equal its vertical scale.
function assertNotStretched(layer, img, tol = 0.003) {
  const sx = layer.w / img.width, sy = layer.h / img.height;
  assert.ok(Math.abs(sx / sy - 1) <= tol, `stretched: x scale ${sx}, y scale ${sy}`);
}
// The 3D shader repeats the texture every uFW metres; it must match the canvas span or the 3D view stretches.
function assertShaderMatches(t) {
  assert.equal(t.ctx.fenceMat.uniforms.uFW.value, t.fence.wM);
  assert.equal(t.fence.out.width, Math.round(t.fence.wM * PXM));
  assert.equal(t.fence.out.height, Math.round(H * PXM));
}

const cases = [
  // [image px, expected unit width m]
  [[2000, 240], 20], [[4000, 240], 40], [[6000, 240], 60], [[1000, 240], 10],
  [[8000, 480], 40], [[3000, 120], 60],                            // other resolutions, same proportions
  [[4130, 240], 41.3],                                             // non-even width
  [[20000, 240], 200],                                             // very long unit
  [[4133, 240], 41.3],                                             // rounds to 0.1 m: residual distortion < 0.1 %
];
for (const [[w, h], want] of cases) test(`loading a ${w}×${h} fence image gives a ${want} m unit with no stretch`, async () => {
  const t = setup();
  const img = {width: w, height: h};
  await t.api.setFileImage('fence', img, 'x.jpg');
  assert.equal(Number(t.els.fenceW.value), want);
  assert.equal(t.fence.wM, want);
  assertShaderMatches(t);
  const L = t.fileLayer();
  assert.deepEqual([L.x, L.y, L.w, L.h], [0, 0, t.fence.out.width, t.fence.out.height]);
  assertNotStretched(L, img);
  assert.equal(t.slots.fence.state, 'ok');
  assert.equal(t.fence.layers.length, 1);
});

test('an image too narrow for the 2 m minimum is flagged, not silently accepted', async () => {
  const t = setup();
  await t.api.setFileImage('fence', {width: 100, height: 240}, 'thin.jpg');   // 1 m at 2.4 m high
  assert.equal(t.fence.wM, 2);
  assert.equal(t.slots.fence.state, 'warn');
  assertShaderMatches(t);
});

test('changing the unit width by hand keeps the image size: extends or crops, never stretches', async () => {
  const t = setup();
  const img = {width: 4000, height: 240};
  await t.api.setFileImage('fence', img, 'x.jpg');
  const before = {...t.fileLayer()};
  for (const w of [20, 60, 2, 41.3, 200, 40]) {
    t.setWidth(w);
    assertShaderMatches(t);
    const L = t.fileLayer();
    assert.deepEqual([L.x, L.y, L.w, L.h], [before.x, before.y, before.w, before.h], `after ${w} m`);
    assertNotStretched(L, img);
  }
});

test('replacing the fence file with a longer then shorter one resizes the unit each time', async () => {
  const t = setup();
  for (const [w, want] of [[2000, 20], [6000, 60], [1500, 15], [4000, 40]]) {
    const img = {width: w, height: 240};
    await t.api.setFileImage('fence', img, w + '.jpg');
    assert.equal(t.fence.wM, want);
    assert.equal(t.fence.layers.length, 1, 'the file layer is replaced, not stacked');
    assert.equal(t.fileLayer().img, img);
    assertNotStretched(t.fileLayer(), img);
    assertShaderMatches(t);
  }
});

test('a manual width change before loading does not stretch the loaded file', async () => {
  const t = setup();
  t.setWidth(30);                                                  // user sets 30 m, then exports a 40 m JPG
  const img = {width: 4000, height: 240};
  await t.api.setFileImage('fence', img, 'x.jpg');
  assert.equal(t.fence.wM, 40);
  assertNotStretched(t.fileLayer(), img);
});

test('dropping a long image on the fence canvas extends the unit to fit it', () => {
  const t = setup();                                               // 20 m = 1000 px wide, 120 px high
  const img = {width: 6000, height: 240};                          // 60 m at full height
  const L = t.fence.addImage(img, 'long.jpg', {x: 0});
  assert.equal(t.fence.wM, 60);
  assert.ok(L.x + L.w <= t.fence.out.width + 1e-6, 'right edge inside the canvas');
  assertNotStretched(L, img);
  assertShaderMatches(t);
});

test('a shorter image dropped near the end extends the unit to its right edge', () => {
  const t = setup();
  const img = {width: 1000, height: 240};                          // 10 m on a 20 m unit
  const L = t.fence.addImage(img, 'a.jpg', {x: 15 * PXM});         // starts at 15 m
  assert.equal(t.fence.wM, 25);
  assert.equal(L.x, 15 * PXM);
  assert.ok(L.x + L.w <= t.fence.out.width + 1e-6);
  assertShaderMatches(t);
});

for (const x of [0, 1.6, 37, 15 * PXM]) test(`an image longer than the unit dropped at x=${x}px becomes exactly the unit (no repeating gap)`, () => {
  const t = setup();
  const img = {width: 10000, height: 240};                         // 100 m
  const L = t.fence.addImage(img, 'long.jpg', {x});
  assert.equal(t.fence.wM, 100);
  assert.deepEqual([L.x, L.y, L.w, L.h], [0, 0, t.fence.out.width, t.fence.out.height]);
  assertNotStretched(L, img);
  assertShaderMatches(t);
});

test('dropping a short image or pasting into a cell never changes the unit width', () => {
  const t = setup();
  t.fence.addImage({width: 1000, height: 240}, 'short.jpg', {x: 0});           // 10 m
  assert.equal(t.fence.wM, 20);
  t.fence.addImage({width: 1900, height: 240}, 'edge.jpg', {x: 0});            // 19 m
  assert.equal(t.fence.wM, 20);
  t.fence.addImage({width: 9000, height: 240}, 'cell.jpg', {cell: {x: 0, y: 0, w: 100, h: 120}});
  assert.equal(t.fence.wM, 20);
  assertShaderMatches(t);
});

test('existing layers keep their position and size when a drop extends the unit', () => {
  const t = setup();
  const a = t.fence.addImage({width: 1000, height: 240}, 'a', {x: 200});
  const snap = [a.x, a.y, a.w, a.h];
  t.fence.addImage({width: 8000, height: 240}, 'b', {x: 0});
  assert.equal(t.fence.wM, 80);
  assert.deepEqual([a.x, a.y, a.w, a.h], snap);
});

test('a canvas size change frees the GPU texture so it is re-allocated (else 3D shows black / stale, also in 另開視窗)', async () => {
  const t = setup();
  const tex = t.fence.tex, n0 = tex.disposed;
  t.setWidth(20); assert.equal(tex.disposed, n0, 'same size: keep the texture');
  t.setWidth(60); assert.equal(tex.disposed, n0 + 1);
  await t.api.setFileImage('fence', {width: 4000, height: 240}, 'x.jpg'); assert.equal(tex.disposed, n0 + 2);
  assert.equal(t.fence.tex, tex, 'same texture object, so the material uniform stays bound');
  const wall = t.api.BOARDS.wall, wn = wall.tex.disposed;
  wall.setSize(40, 3); assert.equal(wall.tex.disposed, wn + 1);
});

test('the noise-wall canvas still scales its layers with the wall length (unchanged)', () => {
  const t = setup();
  const wall = t.api.BOARDS.wall;
  wall.layers.push({x: 0, y: 0, w: wall.out.width, h: wall.out.height});
  wall.setSize(120, 3);
  assert.equal(wall.layers[0].w, wall.out.width);
  assert.equal(wall.layers[0].h, wall.out.height);
});

test('file names: fence accepts png / jpg / jpeg in any case; other slots unchanged', () => {
  const {api} = setup();
  for (const n of ['施工圍籬.png', '施工圍籬.jpg', '施工圍籬.jpeg', '施工圍籬.JPG', 'v2_施工圍籬.Jpeg']) assert.equal(api.slotOf(n), 'fence', n);
  for (const n of ['施工圍籬.gif', '施工圍籬.jpg.txt', '施工圍籬.webp', '圍籬.jpg']) assert.equal(api.slotOf(n), null, n);
  assert.equal(api.slotOf('隔音牆.png'), 'wall250');
  assert.equal(api.slotOf('南下_車道側.png'), 'wall250');
  for (const L of [100, 250, 700]) for (const n of [`隔音牆_${L}.png`, `隔音牆_${L}.jpg`, `隔音牆${L}.JPEG`, `v3_隔音牆-${L}.png`]) assert.equal(api.slotOf(n), 'wall' + L, n);
  for (const n of ['隔音牆_300.png', '隔音牆_1000.png', '隔音牆_100.gif']) assert.equal(api.slotOf(n), null, n);
  assert.equal(api.slotOf('方案設定.xlsx'), 'xlsx');
});

test('every place that lists accepted files includes JPG', () => {
  assert.match(html, /id="fileIn" accept="[^"]*\.jpg[^"]*\.jpeg/);
  assert.match(html, /'image\/jpeg': \['\.jpg', '\.jpeg'\]/);
  assert.match(html, /id="fenceW"[^>]*step="0\.1"/);
});
