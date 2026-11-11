#!/usr/bin/env node
// Copyright 2026 The PravahOS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

/**
 * @file build_dtb.js
 * PravahOS Hermetic Device Tree Compiler & Binary DTB (FDT v17) Validator.
 *
 * Compiles DTS (Device Tree Source) files into standard Flattened Device Tree
 * binary format (.dtb) for Qualcomm Snapdragon (SM8550/SM8650) and Google
 * Tensor (G2/G3/G4) silicon targets without requiring external dtc toolchains.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* Flattened Device Tree (FDT) v17 Constants */
export const FDT_MAGIC = 0xd00dfeed;
export const FDT_VERSION = 17;
export const FDT_LAST_COMP_VERSION = 16;
export const FDT_BOOT_CPUID_PHYS = 0;

export const FDT_BEGIN_NODE = 0x00000001;
export const FDT_END_NODE   = 0x00000002;
export const FDT_PROP       = 0x00000003;
export const FDT_NOP        = 0x00000004;
export const FDT_END        = 0x00000009;

/**
 * Align an integer offset up to a multiple of n bytes.
 */
export function alignUp(offset, alignment) {
  const rem = offset % alignment;
  return rem === 0 ? offset : offset + (alignment - rem);
}

/**
 * Strips comments from DTS text while preserving quotes and newlines.
 */
export function stripDtsComments(dtsText) {
  let result = '';
  let i = 0;
  const len = dtsText.length;
  let inString = false;

  while (i < len) {
    const ch = dtsText[i];
    const next = i + 1 < len ? dtsText[i + 1] : '';

    if (inString) {
      result += ch;
      if (ch === '\\' && i + 1 < len) {
        result += next;
        i += 2;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      i++;
    } else {
      if (ch === '"') {
        inString = true;
        result += ch;
        i++;
      } else if (ch === '/' && next === '/') {
        // Line comment
        i += 2;
        while (i < len && dtsText[i] !== '\n') {
          i++;
        }
      } else if (ch === '/' && next === '*') {
        // Block comment
        i += 2;
        while (i + 1 < len && !(dtsText[i] === '*' && dtsText[i + 1] === '/')) {
          i++;
        }
        i += 2;
      } else {
        result += ch;
        i++;
      }
    }
  }
  return result;
}

/**
 * Parses a DTS string into an Intermediate Representation (IR).
 */
export function parseDtsToAst(dtsText) {
  const clean = stripDtsComments(dtsText);
  let pos = 0;
  const len = clean.length;

  const memreserves = [];
  const labelToPhandle = new Map();
  let nextPhandle = 1;

  function skipWhitespace() {
    while (pos < len && /\s/.test(clean[pos])) {
      pos++;
    }
  }

  // Pre-scan for labels: "label: node_name {" to assign stable phandles
  const labelRegex = /([a-zA-Z0-9_]+)\s*:\s*([a-zA-Z0-9_\-@]+)\s*\{/g;
  let labelMatch;
  while ((labelMatch = labelRegex.exec(clean)) !== null) {
    const label = labelMatch[1];
    if (!labelToPhandle.has(label)) {
      labelToPhandle.set(label, nextPhandle++);
    }
  }

  // Parse header directives: /dts-v1/; and /memreserve/ <addr> <size>;
  while (pos < len) {
    skipWhitespace();
    if (pos >= len) break;

    if (clean.startsWith('/dts-v1/;', pos)) {
      pos += 9;
      continue;
    }

    if (clean.startsWith('/memreserve/', pos)) {
      pos += 12;
      skipWhitespace();
      const semi = clean.indexOf(';', pos);
      if (semi === -1) throw new Error('Unterminated /memreserve/ directive');
      const parts = clean.slice(pos, semi).trim().split(/\s+/);
      if (parts.length >= 2) {
        memreserves.push({
          address: BigInt(parts[0]),
          size: BigInt(parts[1])
        });
      }
      pos = semi + 1;
      continue;
    }

    if (clean[pos] === '/') {
      // Root node reached
      break;
    }

    // Skip any unhandled directive
    const semi = clean.indexOf(';', pos);
    if (semi !== -1) pos = semi + 1;
    else pos++;
  }

  function parsePropertyValue(rawVal) {
    const val = rawVal.trim();
    if (!val) {
      // Empty / boolean property (e.g. interrupt-controller;)
      return Buffer.alloc(0);
    }

    // Check if string list or single string: "foo", "bar"
    if (val.startsWith('"')) {
      const strings = [];
      const strRegex = /"([^"\\]*(?:\\.[^"\\]*)*)"/g;
      let m;
      while ((m = strRegex.exec(val)) !== null) {
        strings.push(m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"'));
      }
      if (strings.length > 0) {
        // Concatenated null-terminated strings
        const bufs = strings.map(s => Buffer.concat([Buffer.from(s, 'utf8'), Buffer.from([0])]));
        return Buffer.concat(bufs);
      }
    }

    // Check if cell array: <0x0 0x80000000> or <&uart12 142> or multiple <...>, <...>
    if (val.startsWith('<')) {
      const cellWords = [];
      const blockRegex = /<([^>]+)>/g;
      let bm;
      while ((bm = blockRegex.exec(val)) !== null) {
        const tokens = bm[1].trim().split(/\s+/);
        for (const tok of tokens) {
          if (!tok) continue;
          if (tok.startsWith('&')) {
            const lbl = tok.slice(1);
            const ph = labelToPhandle.get(lbl) || 0x100;
            cellWords.push(ph);
          } else {
            cellWords.push(Number(BigInt(tok) & 0xFFFFFFFFn));
          }
        }
      }
      const buf = Buffer.alloc(cellWords.length * 4);
      for (let idx = 0; idx < cellWords.length; idx++) {
        buf.writeUInt32BE(cellWords[idx], idx * 4);
      }
      return buf;
    }

    // Check if byte string: [ 01 02 03 ff ]
    if (val.startsWith('[')) {
      const closing = val.indexOf(']');
      const inner = closing !== -1 ? val.slice(1, closing) : val.slice(1);
      const hexTokens = inner.trim().split(/\s+/).filter(Boolean);
      const buf = Buffer.alloc(hexTokens.length);
      for (let idx = 0; idx < hexTokens.length; idx++) {
        buf[idx] = parseInt(hexTokens[idx], 16);
      }
      return buf;
    }

    // Fallback: reference or literal string
    if (val.startsWith('&')) {
      const ph = labelToPhandle.get(val.slice(1)) || 0x100;
      const buf = Buffer.alloc(4);
      buf.writeUInt32BE(ph, 0);
      return buf;
    }

    return Buffer.concat([Buffer.from(val, 'utf8'), Buffer.from([0])]);
  }

  function parseNode() {
    skipWhitespace();
    let label = null;
    let nodeName = '';

    // Check label prefix
    const colonIdx = clean.indexOf(':', pos);
    const braceIdx = clean.indexOf('{', pos);
    if (colonIdx !== -1 && colonIdx < braceIdx && !clean.slice(pos, colonIdx).includes(';')) {
      label = clean.slice(pos, colonIdx).trim();
      pos = colonIdx + 1;
      skipWhitespace();
    }

    // Read node name up to '{'
    const nextBrace = clean.indexOf('{', pos);
    if (nextBrace === -1) throw new Error('Expected "{" for node declaration at ' + pos);
    nodeName = clean.slice(pos, nextBrace).trim();
    if (nodeName === '/') nodeName = ''; // Root node name in FDT is empty string
    pos = nextBrace + 1;

    const node = {
      name: nodeName,
      label,
      phandle: label ? labelToPhandle.get(label) : null,
      properties: [],
      children: []
    };

    if (node.phandle) {
      const phBuf = Buffer.alloc(4);
      phBuf.writeUInt32BE(node.phandle, 0);
      node.properties.push({ name: 'phandle', value: phBuf });
    }

    while (pos < len) {
      skipWhitespace();
      if (pos >= len) break;

      if (clean[pos] === '}') {
        // Node closed
        pos++;
        skipWhitespace();
        if (clean[pos] === ';') pos++;
        break;
      }

      // Lookahead to see if next item is a child node or a property
      const pSemi = clean.indexOf(';', pos);
      const pBrace = clean.indexOf('{', pos);

      if (pBrace !== -1 && (pSemi === -1 || pBrace < pSemi)) {
        // Child node
        const child = parseNode();
        node.children.push(child);
      } else if (pSemi !== -1) {
        // Property: key = value; OR key;
        const propStmt = clean.slice(pos, pSemi).trim();
        pos = pSemi + 1;

        const eqIdx = propStmt.indexOf('=');
        if (eqIdx !== -1) {
          const pName = propStmt.slice(0, eqIdx).trim();
          const pValRaw = propStmt.slice(eqIdx + 1).trim();
          node.properties.push({
            name: pName,
            value: parsePropertyValue(pValRaw)
          });
        } else {
          // Boolean property without value
          node.properties.push({
            name: propStmt,
            value: Buffer.alloc(0)
          });
        }
      } else {
        pos++;
      }
    }

    return node;
  }

  skipWhitespace();
  const rootNode = parseNode();
  return { memreserves, rootNode };
}

/**
 * Compiles parsed DTS AST into an FDT v17 binary Buffer.
 */
export function compileAstToDtb(ast) {
  const { memreserves, rootNode } = ast;

  // Strings block builder (deduplicated)
  const stringsMap = new Map();
  let stringsBuffer = Buffer.alloc(0);

  function getStringOffset(str) {
    if (stringsMap.has(str)) {
      return stringsMap.get(str);
    }
    const offset = stringsBuffer.length;
    const strBytes = Buffer.concat([Buffer.from(str, 'utf8'), Buffer.from([0])]);
    stringsBuffer = Buffer.concat([stringsBuffer, strBytes]);
    stringsMap.set(str, offset);
    return offset;
  }

  // Struct block builder
  const structChunks = [];

  function writeU32(val) {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(val, 0);
    structChunks.push(b);
  }

  function emitNode(node) {
    writeU32(FDT_BEGIN_NODE);

    // Node name: null-terminated string, padded to 4-byte boundary
    const nameBytes = Buffer.from(node.name, 'utf8');
    const nameTotalLen = alignUp(nameBytes.length + 1, 4);
    const nameBuf = Buffer.alloc(nameTotalLen);
    nameBytes.copy(nameBuf, 0);
    structChunks.push(nameBuf);

    // Emit properties
    for (const prop of node.properties) {
      writeU32(FDT_PROP);
      writeU32(prop.value.length);
      writeU32(getStringOffset(prop.name));

      // Property value aligned to 4 bytes
      if (prop.value.length > 0) {
        const valLenPadded = alignUp(prop.value.length, 4);
        const valBuf = Buffer.alloc(valLenPadded);
        prop.value.copy(valBuf, 0);
        structChunks.push(valBuf);
      }
    }

    // Emit child nodes
    for (const child of node.children) {
      emitNode(child);
    }

    writeU32(FDT_END_NODE);
  }

  emitNode(rootNode);
  writeU32(FDT_END);

  const structBlock = Buffer.concat(structChunks);

  // Memory reservation block: 16 bytes per entry, terminated by 16 zero bytes
  const rsvEntries = [...memreserves];
  const rsvBlock = Buffer.alloc((rsvEntries.length + 1) * 16);
  let rsvOffset = 0;
  for (const rsv of rsvEntries) {
    rsvBlock.writeBigUInt64BE(rsv.address, rsvOffset);
    rsvBlock.writeBigUInt64BE(rsv.size, rsvOffset + 8);
    rsvOffset += 16;
  }

  // Calculate layout offsets
  const HEADER_SIZE = 40;
  const offMemRsv = alignUp(HEADER_SIZE, 8);
  const offDtStruct = alignUp(offMemRsv + rsvBlock.length, 4);
  const offDtStrings = alignUp(offDtStruct + structBlock.length, 4);
  const totalSize = alignUp(offDtStrings + stringsBuffer.length, 8);

  const dtb = Buffer.alloc(totalSize);

  // Write FDT v17 Header
  dtb.writeUInt32BE(FDT_MAGIC, 0);
  dtb.writeUInt32BE(totalSize, 4);
  dtb.writeUInt32BE(offDtStruct, 8);
  dtb.writeUInt32BE(offDtStrings, 12);
  dtb.writeUInt32BE(offMemRsv, 16);
  dtb.writeUInt32BE(FDT_VERSION, 20);
  dtb.writeUInt32BE(FDT_LAST_COMP_VERSION, 24);
  dtb.writeUInt32BE(FDT_BOOT_CPUID_PHYS, 28);
  dtb.writeUInt32BE(stringsBuffer.length, 32);
  dtb.writeUInt32BE(structBlock.length, 36);

  // Copy blocks into final buffer
  rsvBlock.copy(dtb, offMemRsv);
  structBlock.copy(dtb, offDtStruct);
  stringsBuffer.copy(dtb, offDtStrings);

  return dtb;
}

/**
 * Public API: Compiles DTS string to DTB Buffer.
 */
export function compileDtsToDtb(dtsContent) {
  const ast = parseDtsToAst(dtsContent);
  return compileAstToDtb(ast);
}

/**
 * Public API: Parses a binary DTB Buffer and returns validated tree representation.
 */
export function parseDtb(buffer) {
  if (buffer.length < 40) {
    throw new Error('DTB buffer smaller than minimum FDT header (40 bytes)');
  }

  const magic = buffer.readUInt32BE(0);
  if (magic !== FDT_MAGIC) {
    throw new Error(`Invalid DTB magic: 0x${magic.toString(16)} (expected 0xd00dfeed)`);
  }

  const totalsize = buffer.readUInt32BE(4);
  const offStruct = buffer.readUInt32BE(8);
  const offStrings = buffer.readUInt32BE(12);
  const offMemRsv = buffer.readUInt32BE(16);
  const version = buffer.readUInt32BE(20);
  const lastCompVersion = buffer.readUInt32BE(24);
  const bootCpuidPhys = buffer.readUInt32BE(28);
  const sizeStrings = buffer.readUInt32BE(32);
  const sizeStruct = buffer.readUInt32BE(36);

  // Parse Memory Reservations
  const memreserves = [];
  let rsvPos = offMemRsv;
  while (rsvPos + 16 <= buffer.length) {
    const addr = buffer.readBigUInt64BE(rsvPos);
    const sz = buffer.readBigUInt64BE(rsvPos + 8);
    if (addr === 0n && sz === 0n) break;
    memreserves.push({ address: addr, size: sz });
    rsvPos += 16;
  }

  // Parse Strings Block helper
  function readString(offset) {
    const start = offStrings + offset;
    let end = start;
    while (end < offStrings + sizeStrings && buffer[end] !== 0) {
      end++;
    }
    return buffer.toString('utf8', start, end);
  }

  // Parse Struct Block
  let pos = offStruct;
  const structEnd = offStruct + sizeStruct;
  const nodeStack = [];
  let rootNode = null;

  while (pos < structEnd) {
    const token = buffer.readUInt32BE(pos);
    pos += 4;

    if (token === FDT_BEGIN_NODE) {
      let endName = pos;
      while (endName < structEnd && buffer[endName] !== 0) {
        endName++;
      }
      const name = buffer.toString('utf8', pos, endName);
      pos = alignUp(endName + 1, 4);

      const newNode = {
        name,
        properties: {},
        propertyBuffers: {},
        children: []
      };

      if (nodeStack.length === 0) {
        rootNode = newNode;
      } else {
        nodeStack[nodeStack.length - 1].children.push(newNode);
      }
      nodeStack.push(newNode);
    } else if (token === FDT_PROP) {
      const propLen = buffer.readUInt32BE(pos);
      const nameOff = buffer.readUInt32BE(pos + 4);
      pos += 8;

      const propData = buffer.slice(pos, pos + propLen);
      pos = alignUp(pos + propLen, 4);

      const propName = readString(nameOff);
      const currNode = nodeStack[nodeStack.length - 1];

      currNode.propertyBuffers[propName] = propData;

      if (propLen === 0) {
        currNode.properties[propName] = true;
      } else if (propData[propData.length - 1] === 0 && isAsciiString(propData)) {
        currNode.properties[propName] = propData.slice(0, -1).toString('utf8');
      } else {
        currNode.properties[propName] = propData;
      }
    } else if (token === FDT_END_NODE) {
      nodeStack.pop();
    } else if (token === FDT_NOP) {
      continue;
    } else if (token === FDT_END) {
      break;
    }
  }

  return {
    header: {
      magic,
      totalsize,
      offStruct,
      offStrings,
      offMemRsv,
      version,
      lastCompVersion,
      bootCpuidPhys,
      sizeStrings,
      sizeStruct
    },
    memreserves,
    root: rootNode
  };
}

function isAsciiString(buf) {
  for (let i = 0; i < buf.length - 1; i++) {
    const c = buf[i];
    if (c === 0) return true;
    if (c < 32 || c > 126) return false;
  }
  return true;
}

/**
 * Validates integrity of a DTB buffer.
 */
export function validateDtb(buffer) {
  const parsed = parseDtb(buffer);
  if (!parsed.root) {
    throw new Error('DTB contains no root node');
  }
  return {
    valid: true,
    version: parsed.header.version,
    totalSize: parsed.header.totalsize,
    rootNodeName: parsed.root.name,
    rootChildrenCount: parsed.root.children.length
  };
}

// CLI Execution check
const currentFile = fileURLToPath(import.meta.url);
const invokedFile = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedFile === currentFile) {
  const args = process.argv.slice(2);
  let inputPath = null;
  let outputPath = null;
  let validateOnly = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--input' || args[i] === '-i') {
      inputPath = args[++i];
    } else if (args[i] === '--output' || args[i] === '-o') {
      outputPath = args[++i];
    } else if (args[i] === '--validate' || args[i] === '-v') {
      validateOnly = true;
    }
  }

  if (!inputPath) {
    console.error('Usage: node build_dtb.js --input <path.dts|path.dtb> [--output <path.dtb>] [--validate]');
    process.exit(1);
  }

  try {
    const fileBytes = fs.readFileSync(inputPath);
    if (validateOnly || inputPath.endsWith('.dtb')) {
      const res = validateDtb(fileBytes);
      console.log(`[PASS] Valid FDT v${res.version} binary (${res.totalSize} bytes, ${res.rootChildrenCount} root children)`);
    } else {
      const dtsText = fileBytes.toString('utf8');
      const dtbBuffer = compileDtsToDtb(dtsText);
      const targetOut = outputPath || inputPath.replace(/\.dts$/, '.dtb');
      fs.writeFileSync(targetOut, dtbBuffer);
      const val = validateDtb(dtbBuffer);
      console.log(`[PASS] Compiled ${path.basename(inputPath)} -> ${path.basename(targetOut)} (${val.totalSize} bytes, FDT v${val.version})`);
    }
  } catch (err) {
    console.error(`[FAIL] DTB compiler error: ${err.message}`);
    process.exit(1);
  }
}
