// Loads the exported data files and texture images.
const DATA = 'data/';

async function json(path) {
  const r = await fetch(DATA + path);
  if (!r.ok) {
    throw new Error(`failed to load ${path}: ${r.status}`);
  }
  return r.json();
}

function image(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load ${src}`));
    img.src = src;
  });
}

export async function loadAssets(onProgress = () => {}) {
  const names = ['meshes', 'materials', 'clips', 'textures', 'audio', 'prefabs', 'physic', 'fonts', 'skins'];
  const out = { scenes: {}, images: {} };
  let done = 0;
  await Promise.all(names.map(async (n) => {
    out[n === 'physic' ? 'physicMaterials' : n] = await json(n + '.json').catch(() => ({}));
    onProgress(++done / (names.length + 12));
  }));
  const files = new Set(Object.values(out.textures).filter(Boolean));
  await Promise.all([...files].map(async (f) => {
    out.images[f] = await image(DATA + 'tex/' + f);
  }));
  // key -> image for textures referenced directly by scripts
  out.texture = (key) => (out.textures[key] ? out.images[out.textures[key]] : null);
  return out;
}

export async function loadScene(assets, name) {
  if (!assets.scenes[name]) {
    assets.scenes[name] = await json(`scenes/${name}.json`);
  }
  return assets.scenes[name];
}
