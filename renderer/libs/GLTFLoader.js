// renderer/libs/GLTFLoader.js
// Minimal adapted GLTFLoader for runtime usage in Electron renderer.
// Based on three.js r168 GLTFLoader under MIT license.

import * as THREE from './three.module.js';

class GLTFDracoMeshCompressionExtension {
  constructor(json) {
    this.name = 'KHR_draco_mesh_compression';
    this.json = json;
  }
}

// NOTE: For brevity, we're omitting optional extensions like KTX2/Basis, Lights, etc.
// For most simple .glb heads from Meshy this will still work.
// If you later load models that use advanced extensions (like Draco-compressed meshes),
// you'll need to bring in those extension helpers as well.

export class GLTFLoader {

  constructor(manager) {
    this.manager = manager !== undefined ? manager : THREE.DefaultLoadingManager;
    this.dracoLoader = null;
  }

  setDRACOLoader(dracoLoader) {
    this.dracoLoader = dracoLoader;
    return this;
  }

  // url: string to .glb
  // onLoad: function(gltf)
  // onProgress: function(event)
  // onError: function(error)
  load(url, onLoad, onProgress, onError) {
    const loader = new THREE.FileLoader(this.manager);

    // We want binary (.glb), so set responseType = 'arraybuffer'
    loader.setResponseType('arraybuffer');

    loader.load(
      url,
      (data) => {
        try {
          const gltf = this.parse(data, url);
          onLoad && onLoad(gltf);
        } catch (e) {
          if (onError) {
            onError(e);
          } else {
            console.error('[GLTFLoader] parse error:', e);
          }
        }
      },
      onProgress,
      onError
    );
  }

  // Parse ArrayBuffer of a .glb file
  parse(data /* ArrayBuffer */, path) {
    // .glb layout:
    // [ magic(4) 'glTF' ][ version(4) ][ length(4) ]
    // then chunks: [ chunkLength(4) ][ chunkType(4) ][ chunkData(chunkLength) ]...

    const GLB_HEADER_MAGIC = 0x46546c67; // 'glTF'
    const DV = new DataView(data);
    const headerMagic = DV.getUint32(0, true);

    if (headerMagic !== GLB_HEADER_MAGIC) {
      throw new Error('GLTFLoader: Unsupported file format, expected .glb');
    }

    const version = DV.getUint32(4, true);
    if (version < 2) {
      throw new Error('GLTFLoader: GLB version < 2 not supported');
    }

    const length = DV.getUint32(8, true);

    let offset = 12;
    let json = null;
    let binaryChunk = null;

    while (offset < length) {
      const chunkLength = DV.getUint32(offset, true); offset += 4;
      const chunkType = DV.getUint32(offset, true); offset += 4;

      const chunkData = new Uint8Array(data, offset, chunkLength);

      // chunkType 0x4E4F534A = JSON
      // chunkType 0x004E4942 = BIN
      if (chunkType === 0x4E4F534A) {
        const textDecoder = new TextDecoder();
        const jsonText = textDecoder.decode(chunkData);
        json = JSON.parse(jsonText);
      } else if (chunkType === 0x004E4942) {
        binaryChunk = chunkData;
      }
      offset += chunkLength;
    }

    if (!json) {
      throw new Error('GLTFLoader: No JSON content found in GLB.');
    }

    // Build a minimal scene graph out of the JSON + binaryChunk.
    // We'll handle only a single mesh with attributes and indices,
    // which is common for a head mesh export.

    const parser = new SimpleGLTFParser(json, binaryChunk, path, this.dracoLoader);

    return parser.build();
  }
}


// Very stripped-down parser that supports:
// - Accessors
// - BufferViews
// - Meshes with a single primitive
// - Node hierarchy
// - Skinning is not fully wired here (basic heads work without).
// - Morph targets are included if present (important for lipsync).
class SimpleGLTFParser {
  constructor(json, binaryChunk, path, dracoLoader) {
    this.json = json;
    this.binaryChunk = binaryChunk;
    this.path = path;
    this.dracoLoader = dracoLoader;
  }

  build() {
    const scene = new THREE.Group();
    scene.name = 'GLTFScene';

    const nodes = this.json.nodes || [];
    const meshes = this.json.meshes || [];

    // Cache of built meshes by index
    const meshCache = {};

    // Recursively build nodes
    const buildNode = (nodeIndex) => {
      const ndef = nodes[nodeIndex];
      let obj = null;

      if (ndef.mesh !== undefined) {
        if (!meshCache[ndef.mesh]) {
          meshCache[ndef.mesh] = this.buildMesh(ndef.mesh);
        }
        obj = meshCache[ndef.mesh].clone(true);
      } else {
        obj = new THREE.Object3D();
      }

      obj.name = ndef.name || `Node_${nodeIndex}`;

      if (ndef.translation) {
        obj.position.fromArray(ndef.translation);
      }
      if (ndef.rotation) {
        obj.quaternion.fromArray(ndef.rotation);
      }
      if (ndef.scale) {
        obj.scale.fromArray(ndef.scale);
      }
      if (ndef.matrix) {
        const m = new THREE.Matrix4();
        m.fromArray(ndef.matrix);
        obj.applyMatrix4(m);
      }

      if (ndef.children) {
        for (const childIndex of ndef.children) {
          const childObj = buildNode(childIndex);
          obj.add(childObj);
        }
      }

      return obj;
    };

    // The default scene is in json.scenes[ json.scene ], which references node indices.
    const sceneIndex = this.json.scene || 0;
    const sceneDef = this.json.scenes[sceneIndex];

    for (const nodeIndex of sceneDef.nodes) {
      const child = buildNode(nodeIndex);
      scene.add(child);
    }

    return {
      scene
    };
  }

  buildMesh(meshIndex) {
    const meshDef = this.json.meshes[meshIndex];
    // We'll assume first primitive only
    const prim = meshDef.primitives[0];

    // geometry
    const geometry = this.buildGeometry(prim);

    // material
    const material = this.buildMaterial(prim.material);

    // mesh
    let mesh;
    if (prim.targets && prim.targets.length > 0) {
      // morph targets exist → good for lipsync
      mesh = new THREE.Mesh(geometry, material);
      mesh.morphTargetInfluences = [];
      mesh.morphTargetDictionary = {};

      prim.targets.forEach((target, idx) => {
        const targetName = meshDef.extras && meshDef.extras.targetNames
          ? meshDef.extras.targetNames[idx]
          : `morph_${idx}`;
        mesh.morphTargetDictionary[targetName] = idx;
        mesh.morphTargetInfluences[idx] = 0;
      });
    } else {
      mesh = new THREE.Mesh(geometry, material);
    }

    if (prim.mode === 4 || prim.mode === undefined) {
      // TRIANGLES (4) is default
    } else {
      console.warn('[GLTFLoader] primitive mode not TRIANGLES, may not render right:', prim.mode);
    }

    if (meshDef.name) mesh.name = meshDef.name;

    return mesh;
  }

  buildGeometry(prim) {
    const geometry = new THREE.BufferGeometry();

    // attributes
    for (const attrName in prim.attributes) {
      const accessorIndex = prim.attributes[attrName];
      const attribute = this.buildAttribute(accessorIndex);
      geometry.setAttribute(attrName.toLowerCase(), attribute);
    }

    // indices
    if (prim.indices !== undefined) {
      const indexAccessor = this.json.accessors[prim.indices];
      const indexArray = this.readAccessorData(prim.indices);

      geometry.setIndex(
        new THREE.BufferAttribute(indexArray, 1)
      );
    }

    // morph targets
    if (prim.targets && prim.targets.length > 0) {
      const morphAttrs = {};
      prim.targets.forEach((target, morphIndex) => {
        for (const attrName in target) {
          const accessorIndex = target[attrName];
          const attribute = this.buildAttribute(accessorIndex);
          if (!morphAttrs[attrName.toLowerCase()]) morphAttrs[attrName.toLowerCase()] = [];
          morphAttrs[attrName.toLowerCase()].push(attribute);
        }
      });
      // three.js expects morphAttributes.position / normal etc.
      for (const k in morphAttrs) {
        geometry.morphAttributes[k] = morphAttrs[k];
      }
    }

    geometry.computeVertexNormals();
    return geometry;
  }

  buildMaterial(materialIndex) {
    if (materialIndex === undefined) {
      return new THREE.MeshStandardMaterial({
        color: 0xcccccc,
        metalness: 0.0,
        roughness: 0.8
      });
    }

    const matDef = this.json.materials[materialIndex] || {};

    const params = {
      color: 0xffffff,
      metalness: matDef.pbrMetallicRoughness?.metallicFactor ?? 0,
      roughness: matDef.pbrMetallicRoughness?.roughnessFactor ?? 1
    };

    if (matDef.pbrMetallicRoughness?.baseColorFactor) {
      const c = matDef.pbrMetallicRoughness.baseColorFactor;
      params.color = new THREE.Color(c[0], c[1], c[2]);
      // c[3] alpha ignored here
    }

    const material = new THREE.MeshStandardMaterial(params);
    material.name = matDef.name || "GLTFMaterial";
    return material;
  }

  buildAttribute(accessorIndex) {
    const array = this.readAccessorData(accessorIndex);
    const accessorDef = this.json.accessors[accessorIndex];
    const numComponents = this.numComponentsForType(accessorDef.type);

    return new THREE.BufferAttribute(array, numComponents);
  }

  readAccessorData(accessorIndex) {
    const accessorDef = this.json.accessors[accessorIndex];
    const bufferViewDef = this.json.bufferViews[accessorDef.bufferView];
    const byteOffset =
      (bufferViewDef.byteOffset || 0) + (accessorDef.byteOffset || 0);
    const byteLength = accessorDef.count * this.numComponentsForType(accessorDef.type) * this.bytesPerComponent(accessorDef.componentType);

    const slice = this.binaryChunk.slice(
      byteOffset,
      byteOffset + byteLength
    );

    switch (accessorDef.componentType) {
      case 5120: return new Int8Array(slice.buffer, slice.byteOffset, slice.byteLength);
      case 5121: return new Uint8Array(slice.buffer, slice.byteOffset, slice.byteLength);
      case 5122: return new Int16Array(slice.buffer, slice.byteOffset, slice.byteLength / 2);
      case 5123: return new Uint16Array(slice.buffer, slice.byteOffset, slice.byteLength / 2);
      case 5125: return new Uint32Array(slice.buffer, slice.byteOffset, slice.byteLength / 4);
      case 5126: return new Float32Array(slice.buffer, slice.byteOffset, slice.byteLength / 4);
      default:
        throw new Error("[GLTFLoader] Unsupported componentType " + accessorDef.componentType);
    }
  }

  numComponentsForType(type) {
    switch (type) {
      case 'SCALAR': return 1;
      case 'VEC2': return 2;
      case 'VEC3': return 3;
      case 'VEC4': return 4;
      case 'MAT2': return 4;
      case 'MAT3': return 9;
      case 'MAT4': return 16;
      default:
        throw new Error("[GLTFLoader] Unknown accessor type " + type);
    }
  }

  bytesPerComponent(componentType) {
    switch (componentType) {
      case 5120: // BYTE
      case 5121: // UNSIGNED_BYTE
        return 1;
      case 5122: // SHORT
      case 5123: // UNSIGNED_SHORT
        return 2;
      case 5125: // UNSIGNED_INT
      case 5126: // FLOAT
        return 4;
      default:
        throw new Error("[GLTFLoader] Unknown componentType " + componentType);
    }
  }
}
